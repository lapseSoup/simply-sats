/**
 * BRC-100 Action Handlers — individual action handlers
 *
 * Contains the core execution logic for each BRC-100 request type:
 * getPublicKey, createSignature, createAction, lockBSV, unlockBSV,
 * encrypt, decrypt, getTaggedKeys.
 */

import { brc100Logger as _brc100Logger } from '../logger'
import type { WalletKeys, LockedUTXO } from '../wallet'
import { lockBSV as walletLockBSV, unlockBSV as walletUnlockBSV } from '../wallet'
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
import { getActiveAccount } from '../accounts'
import { getRequestManager } from './RequestManager'
import { signData, verifyDataSignature } from './signing'
import { encryptECIES, decryptECIES } from './cryptography'
import { getBlockHeight } from './utils'
import { toWalletUtxo } from '../../domain/types'
import { resolvePublicKey } from './outputs'
import { createLockTransaction } from './locks'
import { buildAndBroadcastAction } from './formatting'
import { deriveTaggedKeyFromStore, type DerivationTag } from '../keyDerivation'
import { isValidPublicKey } from '../../domain/wallet/validation'

// A3: In-flight unlock operations — prevents double-spend from concurrent calls
const inflightUnlocks = new Map<string, Promise<void>>()
// S-92: Maximum concurrent in-flight unlocks to prevent unbounded memory growth
const MAX_INFLIGHT_UNLOCKS = 100

// S-63: Maximum payload sizes for BRC-100 byte array parameters
const MAX_SIGNATURE_DATA_SIZE = 10 * 1024       // 10KB for signature data
const MAX_ENCRYPT_PAYLOAD_SIZE = 1024 * 1024     // 1MB for encryption plaintext
const MAX_DECRYPT_PAYLOAD_SIZE = 1024 * 1024     // 1MB for decryption ciphertext
const MAX_OUTPUTS_ARRAY_SIZE = 100               // S-67: Max outputs in createAction
const MAX_TAG_LENGTH = 256                        // S-69: Max tag string length

// Q-55: JSON-RPC 2.0 standard error codes
const RPC_INVALID_PARAMS = -32602
const RPC_INTERNAL_ERROR = -32000
const RPC_METHOD_NOT_FOUND = -32601

/** A-35: Helper to reduce response mutation boilerplate across switch cases */
function setError(response: BRC100Response, code: number, message: string): void {
  response.error = { code, message }
}

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
      // S-43: Runtime validation for getPublicKey params
      if (params.identityKey !== undefined && typeof params.identityKey !== 'boolean') {
        response.error = { code: RPC_INVALID_PARAMS, message: 'identityKey must be a boolean' }
        break
      }
      response.result = { publicKey: resolvePublicKey(keys, params) }
      break
    }

    case 'createSignature': {
      const sigRequest = getParams<SignatureRequest>(request)
      // S-43: Runtime validation for createSignature params
      if (!Array.isArray(sigRequest.data) || !sigRequest.data.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 255)) {
        response.error = { code: RPC_INVALID_PARAMS, message: 'data must be an array of bytes (0-255)' }
        break
      }
      // S-63: Prevent memory exhaustion from oversized payloads
      if (sigRequest.data.length > MAX_SIGNATURE_DATA_SIZE) {
        setError(response, RPC_INVALID_PARAMS, `data exceeds maximum size (${MAX_SIGNATURE_DATA_SIZE} bytes)`)
        break
      }
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

      // S-67: Limit outputs array size to prevent DoS
      if (actionRequest.outputs && actionRequest.outputs.length > MAX_OUTPUTS_ARRAY_SIZE) {
        setError(response, RPC_INVALID_PARAMS, `outputs array exceeds maximum size (${MAX_OUTPUTS_ARRAY_SIZE})`)
        break
      }

      // Check if this is a lock transaction (has wrootz_locks basket)
      const hasLockOutput = actionRequest.outputs?.some(o => o.basket === 'wrootz_locks')

      if (hasLockOutput) {
        // Handle lock transaction
        const lockOutput = actionRequest.outputs.find(o => o.basket === 'wrootz_locks')
        if (!lockOutput) {
          response.error = { code: RPC_INTERNAL_ERROR, message: 'No lock output found' }
          break
        }

        // Parse unlock block from tags (S-14: guard against NaN from malformed tags)
        // S-90: Bound to uint32 range — Bitcoin block heights are uint32
        const unlockTag = lockOutput.tags?.find(t => t.startsWith('unlock_'))
        const ordinalTag = lockOutput.tags?.find(t => t.startsWith('ordinal_'))
        const parsedBlock = unlockTag ? parseInt(unlockTag.replace('unlock_', ''), 10) : 0
        const unlockBlock = Number.isFinite(parsedBlock) && parsedBlock > 0 && parsedBlock <= 0xFFFFFFFF ? parsedBlock : 0
        const ordinalOrigin = ordinalTag?.replace('ordinal_', '') || undefined

        if (unlockTag && unlockBlock === 0) {
          response.error = { code: RPC_INTERNAL_ERROR, message: `Invalid unlock block in tag: ${unlockTag}` }
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
            code: RPC_INTERNAL_ERROR,
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
            code: RPC_INTERNAL_ERROR,
            message: actionResult.error
          }
        }
      }
      break
    }

    case 'lockBSV': {
      // Native lock using OP_PUSH_TX timelock
      const params = getParams<LockBSVParams>(request)
      // S-31: Runtime validation for BRC-100 lock params
      const rawSatoshis = params.satoshis
      const rawBlocks = params.blocks
      // S-71: BSV max supply is 21M BTC = 2.1e15 satoshis
      const MAX_BSV_SATOSHIS = 21_000_000_00_000_000
      if (typeof rawSatoshis !== 'number' || !Number.isFinite(rawSatoshis) || rawSatoshis <= 0 || !Number.isInteger(rawSatoshis) || rawSatoshis > MAX_BSV_SATOSHIS) {
        setError(response, RPC_INVALID_PARAMS, `Invalid satoshis parameter: ${rawSatoshis}`)
        break
      }
      if (typeof rawBlocks !== 'number' || !Number.isFinite(rawBlocks) || rawBlocks <= 0 || !Number.isInteger(rawBlocks)) {
        response.error = { code: RPC_INVALID_PARAMS, message: `Invalid blocks parameter: ${rawBlocks}` }
        break
      }
      const satoshis = rawSatoshis
      const blocks = rawBlocks
      const lockMetadata = { ordinalOrigin: params.ordinalOrigin, app: params.app }

      try {
        // S-29: Scope to active account to prevent cross-account fund leaks
        const activeAccount = await getActiveAccount()
        const activeAccountId = activeAccount?.id ?? undefined

        const currentHeight = await getCurrentBlockHeight()
        const unlockBlock = currentHeight + blocks

        // Get spendable UTXOs from database and convert to wallet UTXO format
        const dbUtxosResult = await getSpendableUTXOs(activeAccountId)
        if (!dbUtxosResult.ok) {
          response.error = { code: RPC_INTERNAL_ERROR, message: `Database error: ${dbUtxosResult.error.message}` }
          break
        }
        const dbUtxos = dbUtxosResult.value
        if (dbUtxos.length === 0) {
          response.error = { code: RPC_INTERNAL_ERROR, message: 'No spendable UTXOs available' }
          break
        }

        // Convert database UTXOs to wallet UTXOs (lockingScript -> script)
        const walletUtxos = dbUtxos.map(toWalletUtxo)

        // Determine basket based on app metadata or origin
        // Use wrootz_locks for wrootz app, otherwise default to 'locks'
        // S-45/S-88: Exact hostname match — endsWith('wrootz.com') would match evilwrootz.com
        const isWrootzApp = lockMetadata.app === 'wrootz' || (() => {
          try {
            if (!request.origin) return false
            const hostname = new URL(request.origin).hostname
            return hostname === 'wrootz.com' || hostname.endsWith('.wrootz.com')
          } catch { return false }
        })()
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
          activeAccountId,
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
          code: RPC_INTERNAL_ERROR,
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
          response.error = { code: RPC_INTERNAL_ERROR, message: 'Unlock already completed for this outpoint' }
        } catch {
          response.error = { code: RPC_INTERNAL_ERROR, message: 'Previous unlock attempt failed for this outpoint' }
        }
        break
      }

      // S-92: Prevent unbounded memory growth from inflight unlock map
      if (inflightUnlocks.size >= MAX_INFLIGHT_UNLOCKS) {
        setError(response, RPC_INTERNAL_ERROR, 'Too many concurrent unlock operations — please wait and retry')
        break
      }

      const unlockOperation = (async () => {
        // S-29: Scope to active account to prevent cross-account fund leaks
        const activeAccount = await getActiveAccount()
        const activeAccountId = activeAccount?.id ?? undefined

        const currentHeight = await getCurrentBlockHeight()
        const locks = await getLocksFromDB(currentHeight, activeAccountId)

        // Q-53: Strict outpoint format validation — must be exactly txid(64 hex chars).vout(digits)
        const outpointMatch = outpoint.match(/^([a-f0-9]{64})\.(\d+)$/)
        if (!outpointMatch) {
          setError(response, RPC_INVALID_PARAMS, 'Invalid outpoint format, expected 64-char-hex-txid.vout')
          return
        }
        const txid = outpointMatch[1]!
        const vout = parseInt(outpointMatch[2]!, 10)
        if (vout > 0xFFFFFFFF) {
          setError(response, RPC_INVALID_PARAMS, 'Invalid outpoint vout index (exceeds uint32 max)')
          return
        }
        const lock = locks.find(l => l.utxo.txid === txid && l.utxo.vout === vout)

        if (!lock) {
          response.error = { code: RPC_INTERNAL_ERROR, message: 'Lock not found' }
          return
        }

        if (currentHeight < lock.unlockBlock) {
          response.error = {
            code: RPC_INTERNAL_ERROR,
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
          currentHeight,
          activeAccountId
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
          code: RPC_INTERNAL_ERROR,
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
      // S-43: Validate plaintext is a byte array before processing
      if (params.plaintext && (!Array.isArray(params.plaintext) || !params.plaintext.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 255))) {
        response.error = { code: RPC_INVALID_PARAMS, message: 'plaintext must be an array of bytes (0-255)' }
        break
      }
      // S-63: Prevent memory exhaustion from oversized payloads
      if (params.plaintext && params.plaintext.length > MAX_ENCRYPT_PAYLOAD_SIZE) {
        setError(response, RPC_INVALID_PARAMS, `plaintext exceeds maximum size (${MAX_ENCRYPT_PAYLOAD_SIZE} bytes)`)
        break
      }
      const plaintext = params.plaintext ? new TextDecoder().decode(new Uint8Array(params.plaintext)) : undefined
      const recipientPubKey = params.counterparty

      if (!plaintext) {
        response.error = { code: RPC_INVALID_PARAMS, message: 'Missing plaintext parameter' }
        break
      }

      if (!recipientPubKey) {
        response.error = { code: RPC_INVALID_PARAMS, message: 'Missing counterparty/publicKey parameter' }
        break
      }

      // S-66: Validate public key format before ECIES encrypt
      if (!isValidPublicKey(recipientPubKey)) {
        response.error = { code: RPC_INVALID_PARAMS, message: 'Invalid public key format' }
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
          code: RPC_INTERNAL_ERROR,
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
        response.error = { code: RPC_INVALID_PARAMS, message: 'Missing ciphertext parameter' }
        break
      }

      // S-42: Validate ciphertext is a byte array before ECIES decrypt
      if (!Array.isArray(ciphertext) || !ciphertext.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 255)) {
        response.error = { code: RPC_INVALID_PARAMS, message: 'ciphertext must be an array of bytes (0-255)' }
        break
      }
      // S-63: Prevent memory exhaustion from oversized payloads
      if (ciphertext.length > MAX_DECRYPT_PAYLOAD_SIZE) {
        setError(response, RPC_INVALID_PARAMS, `ciphertext exceeds maximum size (${MAX_DECRYPT_PAYLOAD_SIZE} bytes)`)
        break
      }
      // S-68: Minimum ciphertext size — must have at least salt(16) + IV(12) = 28 bytes
      if (ciphertext.length < 28) {
        setError(response, RPC_INVALID_PARAMS, 'ciphertext too short (minimum 28 bytes for salt + IV)')
        break
      }

      if (!senderPubKey) {
        response.error = { code: RPC_INVALID_PARAMS, message: 'Missing counterparty/senderPublicKey parameter' }
        break
      }

      // S-66: Validate sender public key format before ECIES decrypt
      if (!isValidPublicKey(senderPubKey)) {
        response.error = { code: RPC_INVALID_PARAMS, message: 'Invalid sender public key format' }
        break
      }

      try {
        const plaintext = await decryptECIES(keys, ciphertext as number[], senderPubKey)
        response.result = { plaintext }
      } catch (error) {
        response.error = {
          code: RPC_INTERNAL_ERROR,
          message: error instanceof Error ? error.message : 'Decryption failed'
        }
      }
      break
    }

    case 'getTaggedKeys': {
      // Derive tagged keys for app-specific use
      const params = getParams<GetTaggedKeysParams>(request)
      // S-43: Runtime validation for getTaggedKeys params
      if (!params.tag || typeof params.tag !== 'string') {
        response.error = { code: RPC_INVALID_PARAMS, message: 'tag must be a non-empty string' }
        break
      }
      // S-69: Prevent DoS from excessively long tag strings in key derivation
      if (params.tag.length > MAX_TAG_LENGTH) {
        setError(response, RPC_INVALID_PARAMS, `tag exceeds maximum length (${MAX_TAG_LENGTH} chars)`)
        break
      }
      const label = params.tag
      const keyIds = ['default']

      // S-89: Validate and sanitize request.origin before using as domain in key derivation
      const origin = request.origin
      if (origin && (typeof origin !== 'string' || origin.length > 256)) {
        setError(response, RPC_INVALID_PARAMS, 'origin must be a string of 256 chars or fewer')
        break
      }

      try {
        // S-84: Use deriveTaggedKeyFromStore so identity WIF never enters JS heap
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
            domain: origin
          }

          const derived = await deriveTaggedKeyFromStore('identity', tag)
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
          code: RPC_INTERNAL_ERROR,
          message: error instanceof Error ? error.message : 'Key derivation failed'
        }
      }
      break
    }

    default:
      response.error = { code: RPC_METHOD_NOT_FOUND, message: 'Method not found' }
  }

  return response
}
