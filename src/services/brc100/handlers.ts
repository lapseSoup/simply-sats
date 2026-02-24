/**
 * BRC-100 Action Handlers — individual action handlers
 *
 * Contains the core execution logic for each BRC-100 request type:
 * getPublicKey, createSignature, createAction, lockBSV, unlockBSV,
 * encrypt, decrypt, getTaggedKeys.
 */

import { PrivateKey } from '@bsv/sdk'
import { brc100Logger as _brc100Logger } from '../logger'
import type { WalletKeys, LockedUTXO } from '../wallet'
import { lockBSV as walletLockBSV, unlockBSV as walletUnlockBSV, getWifForOperation } from '../wallet'
import {
  getSpendableUTXOs,
  getLocks as getLocksFromDB,
  markLockUnlocked
} from '../database'
import { BASKETS as _BASKETS, getCurrentBlockHeight } from '../sync'
import {
  getParams,
  type BRC100Request,
  type BRC100Response,
  type SignatureRequest,
  type CreateActionRequest,
  type LockBSVParams,
  type UnlockBSVParams,
  type GetPublicKeyParams,
  type EncryptDecryptParams,
  type GetTaggedKeysParams
} from './types'
import { getRequestManager } from './RequestManager'
import { signData, verifyDataSignature } from './signing'
import { encryptECIES, decryptECIES } from './cryptography'
import { getBlockHeight } from './utils'
import { resolvePublicKey } from './outputs'
import { createLockTransaction } from './locks'
import { buildAndBroadcastAction } from './formatting'
import { deriveTaggedKey, type DerivationTag } from '../keyDerivation'

// A3: In-flight unlock operations — prevents double-spend from concurrent calls
const inflightUnlocks = new Map<string, Promise<void>>()

// ---------------------------------------------------------------------------
// RequestManager adapter
// ---------------------------------------------------------------------------

/** Single adapter over RequestManager — used by both handleBRC100Request and approveRequest */
export function getPendingRequests() {
  const requestManager = getRequestManager()
  return {
    get: (id: string) => requestManager.get(id),
    set: (id: string, value: { request: BRC100Request; resolve: (r: BRC100Response) => void; reject: (e: Error) => void }) => {
      requestManager.add(id, value.request, value.resolve, value.reject)
    },
    delete: (id: string) => requestManager.remove(id),
    values: () => {
      const all = requestManager.getAll()
      return all.map(request => ({ request }))
    }
  }
}

// ---------------------------------------------------------------------------
// Core execution logic (shared by handleBRC100Request and approveRequest)
// ---------------------------------------------------------------------------

/**
 * Execute an already-approved BRC-100 request and return the response.
 * Called either directly (autoApprove) or after user approval (approveRequest).
 */
export async function executeApprovedRequest(request: BRC100Request, keys: WalletKeys): Promise<BRC100Response> {
  const response: BRC100Response = { id: request.id }

  switch (request.type) {
    case 'getPublicKey': {
      const params = getParams<GetPublicKeyParams>(request)
      response.result = { publicKey: resolvePublicKey(keys, params) }
      break
    }

    case 'createSignature': {
      const sigRequest = getParams<SignatureRequest>(request)
      // signData uses _from_store in Tauri; keys only needed for JS fallback
      const signature = await signData(keys, sigRequest.data, 'identity')

      // Defense-in-depth: verify our own signature before returning it
      if (!await verifyDataSignature(keys.identityPubKey, sigRequest.data, signature)) {
        throw new Error('Self-verification of signature failed')
      }

      response.result = { signature: Array.from(Buffer.from(signature, 'hex')) }
      break
    }

    case 'createAction': {
      const actionRequest = getParams<CreateActionRequest>(request)

      // Check if this is a lock transaction (has wrootz_locks basket)
      const hasLockOutput = actionRequest.outputs?.some(o => o.basket === 'wrootz_locks')

      if (hasLockOutput) {
        // Handle lock transaction
        const lockOutput = actionRequest.outputs.find(o => o.basket === 'wrootz_locks')
        if (!lockOutput) {
          response.error = { code: -32000, message: 'No lock output found' }
          break
        }

        // Parse unlock block from tags (S-14: guard against NaN from malformed tags)
        const unlockTag = lockOutput.tags?.find(t => t.startsWith('unlock_'))
        const ordinalTag = lockOutput.tags?.find(t => t.startsWith('ordinal_'))
        const parsedBlock = unlockTag ? parseInt(unlockTag.replace('unlock_', ''), 10) : 0
        const unlockBlock = Number.isFinite(parsedBlock) && parsedBlock > 0 ? parsedBlock : 0
        const ordinalOrigin = ordinalTag?.replace('ordinal_', '') || undefined

        if (unlockTag && unlockBlock === 0) {
          response.error = { code: -32000, message: `Invalid unlock block in tag: ${unlockTag}` }
          break
        }

        // Get current height to calculate blocks
        const currentHeight = await getBlockHeight()
        const blocks = unlockBlock - currentHeight

        const lockResult = await createLockTransaction(keys, lockOutput.satoshis, blocks, ordinalOrigin)
        if (lockResult.ok) {
          response.result = {
            txid: lockResult.value.txid,
            log: `Lock created until block ${lockResult.value.unlockBlock}`
          }
        } else {
          response.error = {
            code: -32000,
            message: lockResult.error
          }
        }
      } else {
        // Regular transaction - build and broadcast
        const actionResult = await buildAndBroadcastAction(keys, actionRequest)
        if (actionResult.ok) {
          response.result = { txid: actionResult.value.txid }
        } else {
          response.error = {
            code: -32000,
            message: actionResult.error
          }
        }
      }
      break
    }

    case 'lockBSV': {
      // Native lock using OP_PUSH_TX timelock
      const params = getParams<LockBSVParams>(request)
      const satoshis = params.satoshis as number
      const blocks = params.blocks as number
      const lockMetadata = { ordinalOrigin: params.ordinalOrigin, app: params.app }

      try {
        const currentHeight = await getCurrentBlockHeight()
        const unlockBlock = currentHeight + blocks

        // Get spendable UTXOs from database and convert to wallet UTXO format
        const dbUtxosResult = await getSpendableUTXOs()
        if (!dbUtxosResult.ok) {
          response.error = { code: -32000, message: `Database error: ${dbUtxosResult.error.message}` }
          break
        }
        const dbUtxos = dbUtxosResult.value
        if (dbUtxos.length === 0) {
          response.error = { code: -32000, message: 'No spendable UTXOs available' }
          break
        }

        // Convert database UTXOs to wallet UTXOs (lockingScript -> script)
        const walletUtxos = dbUtxos.map(u => ({
          txid: u.txid,
          vout: u.vout,
          satoshis: u.satoshis,
          script: u.lockingScript
        }))

        // Determine basket based on app metadata or origin
        // Use wrootz_locks for wrootz app, otherwise default to 'locks'
        const isWrootzApp = lockMetadata.app === 'wrootz' || request.origin?.includes('wrootz')
        const lockBasket = isWrootzApp ? 'wrootz_locks' : 'locks'

        // Use the wallet's native lockBSV function (OP_PUSH_TX)
        // Pass ordinalOrigin so it can be included as OP_RETURN in the same transaction
        // lockBSV handles all DB writes (addUTXO + addLock) atomically inside withTransaction()
        const lockResult = await walletLockBSV(
          satoshis,
          unlockBlock,
          walletUtxos,
          lockMetadata.ordinalOrigin || undefined,
          undefined,  // lockBlock
          undefined,  // accountId
          lockBasket
        )

        if (!lockResult.ok) {
          response.error = {
            code: lockResult.error.code,
            message: lockResult.error.message
          }
          break
        }

        response.result = {
          txid: lockResult.value.txid,
          unlockBlock,
          lockedUtxo: lockResult.value.lockedUtxo
        }
      } catch (error) {
        response.error = {
          code: -32000,
          message: error instanceof Error ? error.message : 'Lock failed'
        }
      }
      break
    }

    case 'unlockBSV': {
      // Unlock a time-locked output
      const params = getParams<UnlockBSVParams>(request)
      const outpoint = params.outpoints?.[0] || ''

      // Guard against concurrent unlock calls for the same outpoint.
      // Store the actual operation promise so a second caller can await it.
      const existing = inflightUnlocks.get(outpoint)
      if (existing) {
        try {
          await existing
          response.error = { code: -32000, message: 'Unlock already completed for this outpoint' }
        } catch {
          response.error = { code: -32000, message: 'Previous unlock attempt failed for this outpoint' }
        }
        break
      }

      const unlockOperation = (async () => {
        const currentHeight = await getCurrentBlockHeight()
        const locks = await getLocksFromDB(currentHeight)

        // Find the lock by outpoint
        const [txid, voutStr] = outpoint.split('.')
        if (!txid || voutStr === undefined) {
          response.error = { code: -32602, message: 'Invalid outpoint format, expected txid.vout' }
          return
        }
        const voutParsed = parseInt(voutStr, 10)
        if (isNaN(voutParsed) || voutParsed < 0 || voutParsed > 0xFFFFFFFF) {
          response.error = { code: -32602, message: 'Invalid outpoint vout index' }
          return
        }
        const vout = voutParsed
        const lock = locks.find(l => l.utxo.txid === txid && l.utxo.vout === vout)

        if (!lock) {
          response.error = { code: -32000, message: 'Lock not found' }
          return
        }

        if (currentHeight < lock.unlockBlock) {
          response.error = {
            code: -32000,
            message: `Lock not yet spendable. ${lock.unlockBlock - currentHeight} blocks remaining`
          }
          return
        }

        // Build LockedUTXO for the unlock function
        const lockedUtxo: LockedUTXO = {
          txid: lock.utxo.txid,
          vout: lock.utxo.vout,
          satoshis: lock.utxo.satoshis,
          lockingScript: lock.utxo.lockingScript,
          unlockBlock: lock.unlockBlock,
          publicKeyHex: keys.walletPubKey,
          createdAt: Date.now()
        }

        // Use the wallet's native unlockBSV function
        // unlockBSV retrieves the WIF internally from the Rust key store
        const unlockResult = await walletUnlockBSV(
          lockedUtxo,
          currentHeight
        )

        if (!unlockResult.ok) {
          response.error = {
            code: unlockResult.error.code,
            message: unlockResult.error.message
          }
          return
        }

        // Mark lock as unlocked in database (use lock.id, not txid/vout)
        if (lock.id) {
          await markLockUnlocked(lock.id)
        }

        response.result = {
          txid: unlockResult.value,
          amount: lock.utxo.satoshis
        }
      })()

      inflightUnlocks.set(outpoint, unlockOperation)

      try {
        await unlockOperation
      } catch (error) {
        response.error = {
          code: -32000,
          message: error instanceof Error ? error.message : 'Unlock failed'
        }
      } finally {
        inflightUnlocks.delete(outpoint)
      }
      break
    }

    case 'encrypt': {
      // ECIES encryption using counterparty's public key
      // Delegates to cryptography.ts which uses Rust _from_store commands in Tauri
      const params = getParams<EncryptDecryptParams>(request)
      const plaintext = params.plaintext ? new TextDecoder().decode(new Uint8Array(params.plaintext)) : undefined
      const recipientPubKey = params.counterparty

      if (!plaintext) {
        response.error = { code: -32602, message: 'Missing plaintext parameter' }
        break
      }

      if (!recipientPubKey) {
        response.error = { code: -32602, message: 'Missing counterparty/publicKey parameter' }
        break
      }

      // Validate public key format (compressed: 66 hex chars starting with 02/03, uncompressed: 130 hex chars starting with 04)
      if (!/^(02|03)[0-9a-fA-F]{64}$/.test(recipientPubKey) && !/^04[0-9a-fA-F]{128}$/.test(recipientPubKey)) {
        response.error = { code: -32602, message: 'Invalid public key format' }
        break
      }

      try {
        const result = await encryptECIES(keys, plaintext, recipientPubKey)
        response.result = {
          ciphertext: result.ciphertext,
          senderPublicKey: result.senderPublicKey
        }
      } catch (error) {
        response.error = {
          code: -32000,
          message: error instanceof Error ? error.message : 'Encryption failed'
        }
      }
      break
    }

    case 'decrypt': {
      // ECIES decryption using counterparty's public key
      // Delegates to cryptography.ts which uses Rust _from_store commands in Tauri
      const params = getParams<EncryptDecryptParams>(request)
      const ciphertext = params.ciphertext
      const senderPubKey = params.counterparty

      if (!ciphertext) {
        response.error = { code: -32602, message: 'Missing ciphertext parameter' }
        break
      }

      if (!senderPubKey) {
        response.error = { code: -32602, message: 'Missing counterparty/senderPublicKey parameter' }
        break
      }

      try {
        const plaintext = await decryptECIES(keys, ciphertext as number[], senderPubKey)
        response.result = { plaintext }
      } catch (error) {
        response.error = {
          code: -32000,
          message: error instanceof Error ? error.message : 'Decryption failed'
        }
      }
      break
    }

    case 'getTaggedKeys': {
      // Derive tagged keys for app-specific use
      const params = getParams<GetTaggedKeysParams>(request)
      const label = params.tag
      const keyIds = ['default']

      if (!label) {
        response.error = { code: -32602, message: 'Missing label parameter' }
        break
      }

      try {
        const identityWif = await getWifForOperation('identity', 'getTaggedKeys', keys)
        const rootPrivKey = PrivateKey.fromWif(identityWif)
        const derivedKeys: Array<{
          keyId: string
          publicKey: string
          address: string
          derivationPath: string
        }> = []

        for (const keyId of keyIds) {
          const tag: DerivationTag = {
            label,
            id: keyId,
            domain: request.origin
          }

          const derived = deriveTaggedKey(rootPrivKey, tag)
          derivedKeys.push({
            keyId,
            publicKey: derived.publicKey,
            address: derived.address,
            derivationPath: derived.derivationPath
          })
        }

        response.result = {
          label,
          keys: derivedKeys
        }
      } catch (error) {
        response.error = {
          code: -32000,
          message: error instanceof Error ? error.message : 'Key derivation failed'
        }
      }
      break
    }

    default:
      response.error = { code: -32601, message: 'Method not found' }
  }

  return response
}
