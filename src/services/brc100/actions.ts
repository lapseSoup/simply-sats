/**
 * BRC-100 Actions
 *
 * Request handling, approval/rejection, and transaction building.
 * This module handles the core BRC-100 request lifecycle:
 * - handleBRC100Request: processes incoming requests
 * - approveRequest: approves pending requests and executes them
 * - buildAndBroadcastAction: builds and broadcasts transactions
 * - rejectRequest: rejects pending requests
 */

import { PrivateKey, P2PKH, Transaction, PublicKey, Hash, SymmetricKey } from '@bsv/sdk'
import { brc100Logger } from '../logger'
import type { WalletKeys, LockedUTXO, UTXO } from '../wallet'
import { getUTXOs, calculateTxFee, lockBSV as walletLockBSV, unlockBSV as walletUnlockBSV, getWifForOperation } from '../wallet'
import {
  getSpendableUTXOs,
  addUTXO,
  markUTXOSpent,
  addLock,
  getLocks as getLocksFromDB,
  markLockUnlocked,
  addTransaction,
  getBalanceFromDB,
  recordActionRequest,
  updateActionResult
} from '../database'
import { BASKETS, getCurrentBlockHeight } from '../sync'
import {
  broadcastWithOverlay,
  TOPICS
} from '../overlay'
import { parseInscription, isInscriptionScript } from '../inscription'
import { deriveTaggedKey, type DerivationTag } from '../keyDerivation'
import {
  getParams,
  type BRC100Request,
  type BRC100Response,
  type SignatureRequest,
  type CreateActionRequest,
  type ListOutputsParams,
  type LockBSVParams,
  type UnlockBSVParams,
  type GetPublicKeyParams,
  type EncryptDecryptParams,
  type GetTaggedKeysParams
} from './types'
import { getRequestManager } from './RequestManager'
import { signData, verifyDataSignature } from './signing'
import { convertToLockingScript } from './script'
import { getBlockHeight, isInscriptionTransaction } from './utils'
import { resolvePublicKey, resolveListOutputs } from './outputs'
import { createLockTransaction } from './locks'

// Get references needed by this module
function getPendingRequests() {
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

// Handle incoming BRC-100 request
export async function handleBRC100Request(
  request: BRC100Request,
  keys: WalletKeys,
  autoApprove: boolean = false
): Promise<BRC100Response> {
  const pendingRequests = getPendingRequests()
  const requestManager = getRequestManager()
  const response: BRC100Response = { id: request.id }

  try {
    switch (request.type) {
      case 'getPublicKey': {
        const params = getParams<GetPublicKeyParams>(request)
        response.result = { publicKey: resolvePublicKey(keys, params) }
        break
      }

      case 'getHeight': {
        const height = await getBlockHeight()
        response.result = { height }
        break
      }

      case 'listOutputs': {
        const params = getParams<ListOutputsParams>(request)
        try {
          response.result = await resolveListOutputs(params)
        } catch (error) {
          brc100Logger.error('listOutputs error', error)
          // Fallback to balance from database
          try {
            const balance = await getBalanceFromDB(params.basket || undefined)
            response.result = {
              outputs: [{ satoshis: balance, spendable: true }],
              totalOutputs: balance > 0 ? 1 : 0
            }
          } catch (dbError) {
            brc100Logger.error('getBalanceFromDB fallback also failed', dbError)
            response.result = { outputs: [], totalOutputs: 0 }
          }
        }
        break
      }

      case 'createSignature': {
        const sigRequest = request.params as unknown as SignatureRequest

        // If not auto-approve, queue for user approval
        if (!autoApprove) {
          return new Promise((resolve, reject) => {
            pendingRequests.set(request.id, { request, resolve, reject })
            const handler = requestManager.getRequestHandler()
            if (handler) {
              handler(request)
            }
          })
        }

        // Sign with identity key by default
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
        // Queue for user approval - transactions always need approval
        return new Promise((resolve, reject) => {
          pendingRequests.set(request.id, { request, resolve, reject })
          const handler = requestManager.getRequestHandler()
          if (handler) {
            handler(request)
          }
        })
      }

      case 'getNetwork': {
        response.result = { network: 'mainnet' }
        break
      }

      case 'getVersion': {
        response.result = { version: '0.1.0' }
        break
      }

      case 'isAuthenticated': {
        response.result = { authenticated: true }
        break
      }

      default:
        response.error = { code: -32601, message: 'Method not found' }
    }
  } catch (error) {
    response.error = {
      code: -32000,
      message: error instanceof Error ? error.message : 'Unknown error'
    }
  }

  return response
}

// Approve a pending request
export async function approveRequest(requestId: string, keys: WalletKeys): Promise<void> {
  const pendingRequests = getPendingRequests()
  const pending = pendingRequests.get(requestId)
  if (!pending) return

  const { request, resolve } = pending

  // Record the action request
  try {
    await recordActionRequest({
      requestId: request.id,
      actionType: request.type,
      description: (request.params as Record<string, unknown>)?.description as string || `${request.type} request`,
      origin: request.origin,
      approved: true,
      inputParams: JSON.stringify(request.params),
      requestedAt: Date.now()
    })
  } catch (e) {
    brc100Logger.warn('Failed to record action request', undefined, e instanceof Error ? e : undefined)
  }

  try {
    const response: BRC100Response = { id: requestId }

    switch (request.type) {
      case 'getPublicKey': {
        const params = getParams<GetPublicKeyParams>(request)
        response.result = { publicKey: resolvePublicKey(keys, params) }
        break
      }

      case 'createSignature': {
        const sigRequest = request.params as unknown as SignatureRequest
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
        const actionRequest = request.params as unknown as CreateActionRequest

        // Check if this is a lock transaction (has wrootz_locks basket)
        const hasLockOutput = actionRequest.outputs?.some(o => o.basket === 'wrootz_locks')

        if (hasLockOutput) {
          // Handle lock transaction
          const lockOutput = actionRequest.outputs.find(o => o.basket === 'wrootz_locks')
          if (!lockOutput) {
            response.error = { code: -32000, message: 'No lock output found' }
            break
          }

          // Parse unlock block from tags
          const unlockTag = lockOutput.tags?.find(t => t.startsWith('unlock_'))
          const ordinalTag = lockOutput.tags?.find(t => t.startsWith('ordinal_'))
          const unlockBlock = unlockTag ? parseInt(unlockTag.replace('unlock_', '')) : 0
          const ordinalOrigin = ordinalTag?.replace('ordinal_', '')

          // Get current height to calculate blocks
          const currentHeight = await getBlockHeight()
          const blocks = unlockBlock - currentHeight

          try {
            const result = await createLockTransaction(keys, lockOutput.satoshis, blocks, ordinalOrigin)
            response.result = {
              txid: result.txid,
              log: `Lock created until block ${result.unlockBlock}`
            }
          } catch (error) {
            response.error = {
              code: -32000,
              message: error instanceof Error ? error.message : 'Lock failed'
            }
          }
        } else {
          // Regular transaction - build and broadcast
          try {
            const result = await buildAndBroadcastAction(keys, actionRequest)
            response.result = { txid: result.txid }
          } catch (error) {
            response.error = {
              code: -32000,
              message: error instanceof Error ? error.message : 'Transaction failed'
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
          const dbUtxos = await getSpendableUTXOs()
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

          // Use the wallet's native lockBSV function (OP_PUSH_TX)
          // Pass ordinalOrigin so it can be included as OP_RETURN in the same transaction
          // lockBSV retrieves the WIF internally from the Rust key store
          const result = await walletLockBSV(
            satoshis,
            unlockBlock,
            walletUtxos,
            lockMetadata.ordinalOrigin || undefined
          )

          // Determine basket based on app metadata or origin
          // Use wrootz_locks for wrootz app, otherwise default to 'locks'
          const isWrootzApp = lockMetadata.app === 'wrootz' || request.origin?.includes('wrootz')
          const lockBasket = isWrootzApp ? 'wrootz_locks' : 'locks'

          // First add the locked UTXO to the database
          const utxoId = await addUTXO({
            txid: result.txid,
            vout: 0,
            satoshis,
            lockingScript: result.lockedUtxo.lockingScript,
            basket: lockBasket,
            spendable: false,
            createdAt: Date.now()
          })

          // Then track the lock referencing that UTXO
          await addLock({
            utxoId,
            unlockBlock,
            ordinalOrigin: lockMetadata.ordinalOrigin || undefined,
            createdAt: Date.now()
          })

          response.result = {
            txid: result.txid,
            unlockBlock,
            lockedUtxo: result.lockedUtxo
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

        try {
          const currentHeight = await getCurrentBlockHeight()
          const locks = await getLocksFromDB(currentHeight)

          // Find the lock by outpoint
          const [txid, voutStr] = outpoint.split('.')
          const vout = parseInt(voutStr!) || 0
          const lock = locks.find(l => l.utxo.txid === txid && l.utxo.vout === vout)

          if (!lock) {
            response.error = { code: -32000, message: 'Lock not found' }
            break
          }

          if (currentHeight < lock.unlockBlock) {
            response.error = {
              code: -32000,
              message: `Lock not yet spendable. ${lock.unlockBlock - currentHeight} blocks remaining`
            }
            break
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
          const unlockTxid = await walletUnlockBSV(
            lockedUtxo,
            currentHeight
          )

          // Mark lock as unlocked in database (use lock.id, not txid/vout)
          if (lock.id) {
            await markLockUnlocked(lock.id)
          }

          response.result = {
            txid: unlockTxid,
            amount: lock.utxo.satoshis
          }
        } catch (error) {
          response.error = {
            code: -32000,
            message: error instanceof Error ? error.message : 'Unlock failed'
          }
        }
        break
      }

      case 'encrypt': {
        // ECIES encryption using counterparty's public key
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
          // Derive shared secret using ECDH
          const identityWif = await getWifForOperation('identity', 'encrypt', keys)
          const senderPrivKey = PrivateKey.fromWif(identityWif)
          const recipientPublicKey = PublicKey.fromString(recipientPubKey)

          // Use ECDH to derive shared secret
          const sharedSecret = senderPrivKey.deriveSharedSecret(recipientPublicKey)
          const sharedSecretHash = Hash.sha256(sharedSecret.encode(true))

          // Encrypt using AES with the shared secret
          const plaintextBytes = new TextEncoder().encode(plaintext)
          const symmetricKey = new SymmetricKey(Array.from(sharedSecretHash))
          const encrypted = symmetricKey.encrypt(Array.from(plaintextBytes))

          // Convert encrypted bytes to hex string
          const encryptedHex = Array.from(encrypted as number[])
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')

          // Return as hex string along with sender's public key for decryption
          response.result = {
            ciphertext: encryptedHex,
            senderPublicKey: keys.identityPubKey
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
          // Derive shared secret using ECDH
          const identityWif = await getWifForOperation('identity', 'decrypt', keys)
          const recipientPrivKey = PrivateKey.fromWif(identityWif)
          const senderPublicKey = PublicKey.fromString(senderPubKey)

          // Use ECDH to derive shared secret
          const sharedSecret = recipientPrivKey.deriveSharedSecret(senderPublicKey)
          const sharedSecretHash = Hash.sha256(sharedSecret.encode(true))

          // Convert ciphertext bytes to actual bytes for decryption
          const ciphertextBytes = ciphertext as number[]

          // Decrypt using AES with the shared secret
          const symmetricKey = new SymmetricKey(Array.from(sharedSecretHash))
          const decrypted = symmetricKey.decrypt(ciphertextBytes)

          // Return plaintext
          const decryptedBytes = decrypted instanceof Uint8Array ? decrypted : new Uint8Array(decrypted as number[])
          response.result = {
            plaintext: new TextDecoder().decode(decryptedBytes)
          }
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

    // Update action result with outcome
    try {
      const resultObj = response.result as Record<string, unknown> | undefined
      await updateActionResult(requestId, {
        txid: resultObj?.txid as string | undefined,
        approved: !response.error,
        error: response.error?.message,
        outputResult: JSON.stringify(response.result || response.error),
        completedAt: Date.now()
      })
    } catch (e) {
      brc100Logger.warn('Failed to update action result', undefined, e instanceof Error ? e : undefined)
    }

    resolve(response)
  } catch (error) {
    // Update action result with error
    try {
      await updateActionResult(requestId, {
        approved: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        completedAt: Date.now()
      })
    } catch (e) {
      brc100Logger.warn('Failed to update action result', undefined, e instanceof Error ? e : undefined)
    }

    resolve({
      id: requestId,
      error: { code: -32000, message: error instanceof Error ? error.message : 'Unknown error' }
    })
  }

  pendingRequests.delete(requestId)
}

// Build and broadcast a transaction from createAction request
async function buildAndBroadcastAction(
  keys: WalletKeys,
  actionRequest: CreateActionRequest
): Promise<{ txid: string }> {
  const walletWif = await getWifForOperation('wallet', 'buildAndBroadcastAction', keys)
  const privateKey = PrivateKey.fromWif(walletWif)
  const publicKey = privateKey.toPublicKey()
  const fromAddress = publicKey.toAddress()
  const sourceLockingScript = new P2PKH().lock(fromAddress)

  // Check if this is an inscription
  const isInscription = isInscriptionTransaction(actionRequest)
  if (isInscription) {
    brc100Logger.debug('Detected inscription transaction, using ordinals address')
  }

  // Get UTXOs - for inscriptions, we still use wallet UTXOs as funding
  const utxos = await getUTXOs(fromAddress)
  if (utxos.length === 0) {
    throw new Error('No UTXOs available')
  }

  // Validate output count to prevent excessive transaction size
  if (actionRequest.outputs.length === 0 || actionRequest.outputs.length > 100) {
    throw new Error(`Invalid output count: ${actionRequest.outputs.length} (must be 1-100)`)
  }

  // Calculate total output amount
  const totalOutput = actionRequest.outputs.reduce((sum, o) => sum + o.satoshis, 0)

  const tx = new Transaction()

  // Collect inputs
  const inputsToUse: UTXO[] = []
  let totalInput = 0

  for (const utxo of utxos) {
    inputsToUse.push(utxo)
    totalInput += utxo.satoshis

    if (totalInput >= totalOutput + 200) break
  }

  if (totalInput < totalOutput) {
    throw new Error('Insufficient funds')
  }

  // Calculate fee
  const numOutputs = actionRequest.outputs.length + 1 // outputs + change
  const fee = calculateTxFee(inputsToUse.length, numOutputs)
  const change = totalInput - totalOutput - fee

  if (change < 0) {
    throw new Error(`Insufficient funds (need ${fee} sats for fee)`)
  }

  // Add inputs
  for (const utxo of inputsToUse) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(
        privateKey,
        'all',
        false,
        utxo.satoshis,
        sourceLockingScript
      ),
      sequence: 0xffffffff
    })
  }

  // Add outputs from request
  for (const output of actionRequest.outputs) {
    // Convert hex string to proper Script object
    const lockingScript = convertToLockingScript(output.lockingScript)
    tx.addOutput({
      lockingScript,
      satoshis: output.satoshis
    })
  }

  // Add change output if there is any change
  // Note: BSV has no dust limit - all change amounts are valid
  if (change > 0) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(fromAddress),
      satoshis: change
    })
  }

  // Set locktime if specified
  if (actionRequest.lockTime) {
    tx.lockTime = actionRequest.lockTime
  }

  await tx.sign()

  // Determine topic based on output baskets and transaction type
  let topic: string = TOPICS.DEFAULT
  const hasLocksBasket = actionRequest.outputs.some(o => o.basket === 'locks' || o.basket === 'wrootz_locks')
  const hasOrdinalsBasket = actionRequest.outputs.some(o =>
    o.basket === 'ordinals' ||
    o.basket?.includes('ordinal') ||
    o.basket?.includes('inscription')
  )
  if (hasLocksBasket) topic = TOPICS.WROOTZ_LOCKS
  else if (hasOrdinalsBasket || isInscription) topic = TOPICS.ORDINALS

  // Broadcast via overlay network AND WhatsOnChain
  const broadcastResult = await broadcastWithOverlay(tx.toHex(), topic)

  // Check if broadcast succeeded
  const overlaySuccess = broadcastResult.overlayResults.some(r => r.accepted)
  const minerSuccess = broadcastResult.minerBroadcast.ok

  if (!overlaySuccess && !minerSuccess) {
    throw new Error(`Failed to broadcast: ${(!broadcastResult.minerBroadcast.ok ? broadcastResult.minerBroadcast.error : undefined) || 'No nodes accepted'}`)
  }

  const txid = broadcastResult.txid || tx.id('hex')

  // Log overlay results
  brc100Logger.info('Overlay broadcast results', {
    txid,
    overlayAccepted: overlaySuccess,
    minerAccepted: minerSuccess,
    overlayResults: broadcastResult.overlayResults
  })

  // Track transaction in database
  try {
    // Record the transaction
    await addTransaction({
      txid,
      rawTx: tx.toHex(),
      description: actionRequest.description,
      createdAt: Date.now(),
      status: 'pending',
      labels: actionRequest.labels || ['createAction']
    })

    // Mark spent UTXOs
    for (const utxo of inputsToUse) {
      await markUTXOSpent(utxo.txid, utxo.vout, txid)
    }

    // Add new outputs to database if they belong to us
    // For inscriptions, add the ordinal output with parsed content-type
    if (isInscription) {
      for (let i = 0; i < actionRequest.outputs.length; i++) {
        const output = actionRequest.outputs[i]!
        // Inscription outputs are typically 1 sat with envelope script
        if (output.satoshis === 1 && isInscriptionScript(output.lockingScript)) {
          // Parse the inscription to extract content-type
          const parsed = parseInscription(output.lockingScript)
          const contentType = parsed.isValid ? parsed.contentType : 'application/octet-stream'

          // Build tags including content-type
          const tags = output.tags || []
          if (!tags.includes('inscription')) tags.push('inscription')
          if (!tags.includes('ordinal')) tags.push('ordinal')
          tags.push(`content-type:${contentType}`)

          await addUTXO({
            txid,
            vout: i,
            satoshis: output.satoshis,
            lockingScript: output.lockingScript,
            basket: BASKETS.ORDINALS,
            spendable: true,
            createdAt: Date.now(),
            tags
          })
          brc100Logger.info('Inscription added to ordinals basket', { outpoint: `${txid}:${i}`, contentType })
        }
      }
    }

    // Add change output if there is any change
    // Note: BSV has no dust limit - all change amounts are valid
    if (change > 0) {
      const changeVout = actionRequest.outputs.length
      await addUTXO({
        txid,
        vout: changeVout,
        satoshis: change,
        lockingScript: new P2PKH().lock(fromAddress).toHex(),
        basket: BASKETS.DEFAULT,
        spendable: true,
        createdAt: Date.now(),
        tags: ['change']
      })
    }

    brc100Logger.info('Transaction tracked in database', { txid })
  } catch (error) {
    brc100Logger.error('Failed to track transaction in database', error)
    // Transaction is already broadcast, continue
  }

  return { txid }
}

// Reject a pending request
export async function rejectRequest(requestId: string): Promise<void> {
  const pendingRequests = getPendingRequests()
  const pending = pendingRequests.get(requestId)
  if (!pending) return

  const { request } = pending

  // Record the rejected action
  try {
    await recordActionRequest({
      requestId: request.id,
      actionType: request.type,
      description: (request.params as Record<string, unknown>)?.description as string || `${request.type} request`,
      origin: request.origin,
      approved: false,
      error: 'User rejected request',
      inputParams: JSON.stringify(request.params),
      requestedAt: Date.now(),
      completedAt: Date.now()
    })
  } catch (e) {
    brc100Logger.warn('Failed to record rejected action', undefined, e instanceof Error ? e : undefined)
  }

  pending.resolve({
    id: requestId,
    error: { code: -32003, message: 'User rejected request' }
  })

  pendingRequests.delete(requestId)
}
