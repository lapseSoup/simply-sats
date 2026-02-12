import { PrivateKey, P2PKH, Transaction, PublicKey, Hash, SymmetricKey } from '@bsv/sdk'
import { broadcastTransaction as infraBroadcast } from '../infrastructure/api/broadcastService'
import { brc100Logger } from './logger'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import type { WalletKeys, UTXO, LockedUTXO } from './wallet'
import { getUTXOs, calculateTxFee, lockBSV as walletLockBSV, unlockBSV as walletUnlockBSV } from './wallet'
import {
  getSpendableUTXOs,
  getUTXOsByBasket,
  addUTXO,
  markUTXOSpent,
  addLock,
  getLocks as getLocksFromDB,
  markLockUnlocked,
  addTransaction,
  getBalanceFromDB,
  recordActionRequest,
  updateActionResult
} from './database'
import { BASKETS, getCurrentBlockHeight } from './sync'
import {
  broadcastWithOverlay,
  lookupByTopic,
  getOverlayStatus,
  TOPICS
} from './overlay'
import { parseInscription, isInscriptionScript } from './inscription'
import {
  acquireCertificate as acquireCertificateService,
  listCertificates as listCertificatesService,
  proveCertificate as proveCertificateService,
  type Certificate,
  type CertificateType,
  type AcquireCertificateArgs
} from './certificates'
import { deriveTaggedKey, type DerivationTag } from './keyDerivation'

// Import from modular brc100 files
import {
  BRC100_REQUEST_TYPES,
  isValidBRC100RequestType,
  getParams,
  type BRC100Request,
  type BRC100Response,
  type BRC100RequestType,
  type SignatureRequest,
  type CreateActionRequest,
  type ListOutputsParams,
  type LockBSVParams,
  type UnlockBSVParams,
  type GetPublicKeyParams,
  type EncryptDecryptParams,
  type GetTaggedKeysParams,
  type LockedOutput,
  type DiscoveredOutput
} from './brc100/types'
import { getRequestManager } from './brc100/RequestManager'
import { setWalletKeys, getWalletKeys } from './brc100/state'
import { signMessage, signData, verifySignature, verifyDataSignature } from './brc100/signing'
// Note: encryptECIES/decryptECIES available in './brc100/cryptography' for future use
import {
  createCLTVLockingScript,
  createWrootzOpReturn,
  convertToLockingScript,
  createScriptFromHex
} from './brc100/script'
import {
  getBlockHeight,
  generateRequestId,
  formatIdentityKey,
  getIdentityKeyForApp,
  isInscriptionTransaction
} from './brc100/utils'

// Re-export types for backward compatibility
export {
  BRC100_REQUEST_TYPES,
  isValidBRC100RequestType,
  setWalletKeys,
  getWalletKeys,
  signMessage,
  signData,
  verifySignature,
  verifyDataSignature,
  getBlockHeight,
  generateRequestId,
  formatIdentityKey,
  getIdentityKeyForApp,
  createCLTVLockingScript
}
export type {
  BRC100Request,
  BRC100Response,
  BRC100RequestType,
  SignatureRequest,
  CreateActionRequest,
  ListOutputsParams,
  LockBSVParams,
  UnlockBSVParams,
  GetPublicKeyParams,
  EncryptDecryptParams,
  GetTaggedKeysParams,
  LockedOutput,
  DiscoveredOutput
}

// Get request manager instance
const requestManager = getRequestManager()

// Legacy pendingRequests map - redirects to RequestManager
const pendingRequests = {
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

export function setRequestHandler(callback: (request: BRC100Request) => void) {
  requestManager.setRequestHandler(callback)
}

export function getPendingRequests(): BRC100Request[] {
  return requestManager.getAll()
}

// Set up listener for HTTP server requests via Tauri events
export async function setupHttpServerListener(): Promise<() => void> {
  try {
    const unlisten = await listen<{
      id: string
      method: string
      params: Record<string, unknown>
      origin?: string
    }>('brc100-request', async (event) => {
      try {
        // Validate the request type before processing
        const requestMethod = event.payload.method
        if (!isValidBRC100RequestType(requestMethod)) {
          brc100Logger.error(`Invalid request type: ${requestMethod}`)
          try {
            await invoke('respond_to_brc100', {
              requestId: event.payload.id,
              response: { error: { code: -32601, message: `Invalid method: ${requestMethod}` } }
            })
          } catch (e) {
            brc100Logger.error('Failed to send error response for invalid method', e)
          }
          return
        }

        const request: BRC100Request = {
          id: event.payload.id,
          type: requestMethod,
          params: event.payload.params,
          origin: event.payload.origin
        }

      // If no wallet is loaded, return error for requests that need it
      if (!getWalletKeys()) {
        if (request.type === 'getPublicKey' || request.type === 'createSignature' ||
            request.type === 'createAction' || request.type === 'listOutputs' ||
            request.type === 'lockBSV' || request.type === 'unlockBSV' || request.type === 'listLocks') {
          try {
            await invoke('respond_to_brc100', {
              requestId: request.id,
              response: { error: { code: -32002, message: 'No wallet loaded' } }
            })
          } catch (e) {
            brc100Logger.error('Failed to send error response', e)
          }
          return
        }
      }

      const walletKeys = getWalletKeys()
      if (request.type === 'getPublicKey' && walletKeys) {
        const params = request.params || {}
        let publicKey: string
        if (params.identityKey) {
          publicKey = walletKeys.identityPubKey
        } else if (params.forOrdinals) {
          publicKey = walletKeys.ordPubKey
        } else {
          publicKey = walletKeys.walletPubKey
        }

        try {
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { result: { publicKey } }
          })
        } catch (e) {
          brc100Logger.error('Failed to send auto-response', e)
        }
        return
      }

      // Auto-respond to listOutputs using database
      if (request.type === 'listOutputs' && getWalletKeys()) {
        const params = getParams<ListOutputsParams>(request)
        const basket = params.basket
        const includeSpent = params.includeSpent || false
        const includeTags = params.includeTags || []
        const limit = params.limit || 100
        const offset = params.offset || 0

        try {
          const currentHeight = await getCurrentBlockHeight()

          if (basket === 'wrootz_locks' || basket === 'locks') {
            // Return locks from database
            const locks = await getLocksFromDB(currentHeight)
            const outputs = locks.map(lock => ({
              outpoint: `${lock.utxo.txid}.${lock.utxo.vout}`,
              satoshis: lock.utxo.satoshis,
              lockingScript: lock.utxo.lockingScript,
              tags: [`unlock_${lock.unlockBlock}`, ...(lock.ordinalOrigin ? [`ordinal_${lock.ordinalOrigin}`] : [])],
              spendable: currentHeight >= lock.unlockBlock,
              customInstructions: JSON.stringify({
                unlockBlock: lock.unlockBlock,
                blocksRemaining: Math.max(0, lock.unlockBlock - currentHeight)
              })
            }))

            await invoke('respond_to_brc100', {
              requestId: request.id,
              response: { result: { outputs, totalOutputs: outputs.length } }
            })
            return
          }

          // Map basket names
          let dbBasket: string = basket || BASKETS.DEFAULT
          if (basket === 'ordinals') dbBasket = BASKETS.ORDINALS
          else if (basket === 'identity') dbBasket = BASKETS.IDENTITY
          else if (!basket || basket === 'default') dbBasket = BASKETS.DEFAULT

          // Get UTXOs from database
          const utxos = await getUTXOsByBasket(dbBasket, !includeSpent)

          // Filter by tags if specified
          let filteredUtxos = utxos
          if (includeTags.length > 0) {
            filteredUtxos = utxos.filter(u =>
              u.tags && includeTags.some((tag: string) => u.tags!.includes(tag))
            )
          }

          // Apply pagination
          const paginatedUtxos = filteredUtxos.slice(offset, offset + limit)

          const outputs = paginatedUtxos.map(u => ({
            outpoint: `${u.txid}.${u.vout}`,
            satoshis: u.satoshis,
            lockingScript: u.lockingScript,
            tags: u.tags || [],
            spendable: u.spendable
          }))

          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: {
              result: {
                outputs,
                totalOutputs: filteredUtxos.length,
                BEEF: undefined // We don't have BEEF yet
              }
            }
          })
          return
        } catch (e) {
          brc100Logger.error('Failed to list outputs', e)
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { error: { code: -32000, message: 'Failed to list outputs' } }
          })
          return
        }
      }

      // Handle listLocks - returns all time-locked outputs
      if (request.type === 'listLocks' && getWalletKeys()) {
        try {
          const currentHeight = await getCurrentBlockHeight()
          const locks = await getLocksFromDB(currentHeight)

          const lockOutputs: LockedOutput[] = locks.map(lock => ({
            outpoint: `${lock.utxo.txid}.${lock.utxo.vout}`,
            txid: lock.utxo.txid,
            vout: lock.utxo.vout,
            satoshis: lock.utxo.satoshis,
            unlockBlock: lock.unlockBlock,
            tags: [`unlock_${lock.unlockBlock}`, ...(lock.ordinalOrigin ? [`ordinal_${lock.ordinalOrigin}`] : [])],
            spendable: currentHeight >= lock.unlockBlock,
            blocksRemaining: Math.max(0, lock.unlockBlock - currentHeight)
          }))

          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { result: { locks: lockOutputs, currentHeight } }
          })
          return
        } catch (e) {
          brc100Logger.error('Failed to list locks', e)
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { error: { code: -32000, message: 'Failed to list locks' } }
          })
          return
        }
      }

      // Handle lockBSV - creates time-locked output using OP_PUSH_TX
      // This requires user approval as it spends funds
      if (request.type === 'lockBSV' && getWalletKeys()) {
        const params = getParams<LockBSVParams>(request)
        const satoshis = params.satoshis
        const blocks = params.blocks

        if (!satoshis || satoshis <= 0 || !Number.isFinite(satoshis) || satoshis > 21_000_000_00_000_000) {
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { error: { code: -32602, message: 'Invalid satoshis amount' } }
          })
          return
        }

        if (!blocks || blocks <= 0 || !Number.isInteger(blocks) || blocks > 210_000) {
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { error: { code: -32602, message: 'Invalid blocks duration (must be 1-210000)' } }
          })
          return
        }

        // This will be handled by the pending request flow for user approval
        // Don't auto-process - let it fall through to be queued for approval
      }

      // Handle unlockBSV - spends time-locked output back to wallet
      // This requires user approval as it spends funds
      if (request.type === 'unlockBSV' && getWalletKeys()) {
        const params = getParams<UnlockBSVParams>(request)
        const outpoint = params.outpoints?.[0]

        if (!outpoint) {
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { error: { code: -32602, message: 'Missing outpoint parameter' } }
          })
          return
        }

        // This will be handled by the pending request flow for user approval
        // Don't auto-process - let it fall through to be queued for approval
      }

      // Store as pending and notify UI for requests that need approval
      pendingRequests.set(request.id, {
        request,
        resolve: async (response) => {
          // Send response back to Tauri backend
          try {
            await invoke('respond_to_brc100', {
              requestId: request.id,
              response
            })
          } catch (e) {
            brc100Logger.error('Failed to send BRC-100 response', e)
          }
        },
        reject: async (error) => {
          try {
            await invoke('respond_to_brc100', {
              requestId: request.id,
              response: {
                id: request.id,
                error: { code: -32000, message: error.message || 'Unknown error' }
              }
            })
          } catch (e) {
            brc100Logger.error('Failed to send BRC-100 error', e)
          }
        }
      })

      const requestHandler = requestManager.getRequestHandler()
      if (requestHandler) {
        requestHandler(request)
      }
      } catch (err) {
        brc100Logger.error('Error in event handler', err)
      }
    })

    return unlisten
  } catch {
    return () => {}
  }
}

// Lock management - now uses database
export async function getLocks(): Promise<LockedOutput[]> {
  try {
    const currentHeight = await getCurrentBlockHeight()
    const dbLocks = await getLocksFromDB(currentHeight)

    return dbLocks.map(lock => ({
      outpoint: `${lock.utxo.txid}.${lock.utxo.vout}`,
      txid: lock.utxo.txid,
      vout: lock.utxo.vout,
      satoshis: lock.utxo.satoshis,
      unlockBlock: lock.unlockBlock,
      tags: [`unlock_${lock.unlockBlock}`, ...(lock.ordinalOrigin ? [`ordinal_${lock.ordinalOrigin}`] : [])],
      spendable: currentHeight >= lock.unlockBlock,
      blocksRemaining: Math.max(0, lock.unlockBlock - currentHeight)
    }))
  } catch (error) {
    brc100Logger.error('Failed to get locks from database', error)
    return []
  }
}

export async function saveLockToDatabase(
  utxoId: number,
  unlockBlock: number,
  ordinalOrigin?: string
): Promise<void> {
  await addLock({
    utxoId,
    unlockBlock,
    ordinalOrigin,
    createdAt: Date.now()
  })
}

export async function removeLockFromDatabase(lockId: number): Promise<void> {
  await markLockUnlocked(lockId)
}

// Create a time-locked transaction
export async function createLockTransaction(
  keys: WalletKeys,
  satoshis: number,
  blocks: number,
  ordinalOrigin?: string
): Promise<{ txid: string; unlockBlock: number }> {
  const privateKey = PrivateKey.fromWif(keys.walletWif)
  const publicKey = privateKey.toPublicKey()
  const fromAddress = publicKey.toAddress()

  // Get UTXOs
  const utxos = await getUTXOs(fromAddress)
  if (utxos.length === 0) {
    throw new Error('No UTXOs available')
  }

  // Get current block height
  const currentHeight = await getBlockHeight()
  const unlockBlock = currentHeight + blocks

  // Create CLTV locking script
  const lockingScript = createCLTVLockingScript(keys.identityPubKey, unlockBlock)

  const tx = new Transaction()

  // Collect inputs
  const inputsToUse: UTXO[] = []
  let totalInput = 0
  const sourceLockingScript = new P2PKH().lock(fromAddress)

  for (const utxo of utxos) {
    inputsToUse.push(utxo)
    totalInput += utxo.satoshis

    if (totalInput >= satoshis + 200) break
  }

  if (totalInput < satoshis) {
    throw new Error('Insufficient funds')
  }

  // Calculate outputs (lock output + optional OP_RETURN + change)
  const numOutputs = ordinalOrigin ? 3 : 2 // lock + opreturn + change, or just lock + change
  const fee = calculateTxFee(inputsToUse.length, numOutputs)
  const change = totalInput - satoshis - fee

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

  // Add lock output
  tx.addOutput({
    lockingScript: createScriptFromHex(lockingScript),
    satoshis
  })

  // Add OP_RETURN for ordinal reference if provided
  if (ordinalOrigin) {
    const opReturnScript = createWrootzOpReturn('lock', ordinalOrigin)
    tx.addOutput({
      lockingScript: createScriptFromHex(opReturnScript),
      satoshis: 0
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

  await tx.sign()

  // Broadcast via infrastructure service (cascade: WoC → ARC → mAPI)
  const txid = await infraBroadcast(tx.toHex(), tx.id('hex'))

  // Save UTXO and lock to database
  try {
    const utxoId = await addUTXO({
      txid,
      vout: 0,
      satoshis,
      lockingScript,
      basket: BASKETS.LOCKS,
      spendable: false,
      createdAt: Date.now(),
      tags: ['lock', 'wrootz']
    })

    await saveLockToDatabase(utxoId, unlockBlock, ordinalOrigin)

    // Also record the transaction
    await addTransaction({
      txid,
      rawTx: tx.toHex(),
      description: `Lock ${satoshis} sats until block ${unlockBlock}`,
      createdAt: Date.now(),
      status: 'pending',
      labels: ['lock', 'wrootz']
    })

    brc100Logger.info('Lock saved to database', { txid, utxoId, unlockBlock })
  } catch (error) {
    brc100Logger.error('Failed to save lock to database', error)
    // Transaction is already broadcast, so we continue
  }

  return { txid, unlockBlock }
}

// Handle incoming BRC-100 request
export async function handleBRC100Request(
  request: BRC100Request,
  keys: WalletKeys,
  autoApprove: boolean = false
): Promise<BRC100Response> {
  const response: BRC100Response = { id: request.id }

  try {
    switch (request.type) {
      case 'getPublicKey': {
        const params = getParams<GetPublicKeyParams>(request)
        if (params.identityKey) {
          response.result = { publicKey: keys.identityPubKey }
        } else if (params.forOrdinals) {
          response.result = { publicKey: keys.ordPubKey }
        } else {
          response.result = { publicKey: keys.walletPubKey }
        }
        break
      }

      case 'getHeight': {
        const height = await getBlockHeight()
        response.result = { height }
        break
      }

      case 'listOutputs': {
        const params = getParams<ListOutputsParams>(request)
        const basket = params.basket
        const includeSpent = params.includeSpent || false
        const includeTags = params.includeTags || []
        const limit = params.limit || 100
        const offset = params.offset || 0

        try {
          const currentHeight = await getCurrentBlockHeight()

          if (basket === 'wrootz_locks' || basket === 'locks') {
            // Return locks from database
            const locks = await getLocksFromDB(currentHeight)
            response.result = {
              outputs: locks.map(lock => ({
                outpoint: `${lock.utxo.txid}.${lock.utxo.vout}`,
                satoshis: lock.utxo.satoshis,
                lockingScript: lock.utxo.lockingScript,
                tags: [`unlock_${lock.unlockBlock}`, ...(lock.ordinalOrigin ? [`ordinal_${lock.ordinalOrigin}`] : [])],
                spendable: currentHeight >= lock.unlockBlock,
                customInstructions: JSON.stringify({
                  unlockBlock: lock.unlockBlock,
                  blocksRemaining: Math.max(0, lock.unlockBlock - currentHeight)
                })
              })),
              totalOutputs: locks.length
            }
          } else {
            // Map basket name
            let dbBasket: string = basket || BASKETS.DEFAULT
            if (basket === 'ordinals') dbBasket = BASKETS.ORDINALS
            else if (basket === 'identity') dbBasket = BASKETS.IDENTITY
            else if (!basket || basket === 'default') dbBasket = BASKETS.DEFAULT

            // Get UTXOs from database
            const utxos = await getUTXOsByBasket(dbBasket, !includeSpent)

            // Filter by tags if specified
            let filteredUtxos = utxos
            if (includeTags.length > 0) {
              filteredUtxos = utxos.filter(u =>
                u.tags && includeTags.some((tag: string) => u.tags!.includes(tag))
              )
            }

            // Apply pagination
            const paginatedUtxos = filteredUtxos.slice(offset, offset + limit)

            response.result = {
              outputs: paginatedUtxos.map(u => ({
                outpoint: `${u.txid}.${u.vout}`,
                satoshis: u.satoshis,
                lockingScript: u.lockingScript,
                tags: u.tags || [],
                spendable: u.spendable
              })),
              totalOutputs: filteredUtxos.length
            }
          }
        } catch (error) {
          brc100Logger.error('listOutputs error', error)
          // Fallback to balance from database
          const balance = await getBalanceFromDB(basket || undefined)
          response.result = {
            outputs: [{ satoshis: balance, spendable: true }],
            totalOutputs: balance > 0 ? 1 : 0
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
        if (params.identityKey) {
          response.result = { publicKey: keys.identityPubKey }
        } else if (params.forOrdinals) {
          response.result = { publicKey: keys.ordPubKey }
        } else {
          response.result = { publicKey: keys.walletPubKey }
        }
        break
      }

      case 'createSignature': {
        const sigRequest = request.params as unknown as SignatureRequest
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
          const result = await walletLockBSV(
            keys.walletWif,
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
          const unlockTxid = await walletUnlockBSV(
            keys.walletWif,
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
          const senderPrivKey = PrivateKey.fromWif(keys.identityWif)
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
          const recipientPrivKey = PrivateKey.fromWif(keys.identityWif)
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
          const rootPrivKey = PrivateKey.fromWif(keys.identityWif)
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
  const privateKey = PrivateKey.fromWif(keys.walletWif)
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
  const wocSuccess = broadcastResult.wocResult.success

  if (!overlaySuccess && !wocSuccess) {
    throw new Error(`Failed to broadcast: ${broadcastResult.wocResult.error || 'No nodes accepted'}`)
  }

  const txid = broadcastResult.txid || tx.id('hex')

  // Log overlay results
  brc100Logger.info('Overlay broadcast results', {
    txid,
    overlayAccepted: overlaySuccess,
    wocAccepted: wocSuccess,
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

// BRC-100 acquireCertificate - delegates to certificate service
export async function acquireCertificate(args: AcquireCertificateArgs): Promise<Certificate> {
  const keys = getWalletKeys()
  if (!keys) {
    throw new Error('No wallet loaded')
  }
  return acquireCertificateService(args, keys)
}

// BRC-100 listCertificates - delegates to certificate service
export async function listCertificates(args: {
  certifiers?: string[]
  types?: CertificateType[]
  limit?: number
  offset?: number
}): Promise<{
  certificates: Certificate[]
  totalCertificates: number
}> {
  const keys = getWalletKeys()
  if (!keys) {
    return { certificates: [], totalCertificates: 0 }
  }
  return listCertificatesService(args, keys)
}

// BRC-100 proveCertificate - creates a proof of certificate ownership
export async function proveCertificate(args: {
  certificate: Certificate
  fieldsToReveal: string[]
  verifier: string
}): Promise<{
  certificate: Certificate
  revealedFields: Record<string, string>
  verifier: string
}> {
  const keys = getWalletKeys()
  if (!keys) {
    throw new Error('No wallet loaded')
  }
  return proveCertificateService(args, keys)
}

// BRC-100 discoverByIdentityKey - find outputs belonging to an identity
export async function discoverByIdentityKey(args: {
  identityKey: string
  limit?: number
  offset?: number
}): Promise<{
  outputs: DiscoveredOutput[]
  totalOutputs: number
}> {
  // First check local database
  try {
    const utxos = await getUTXOsByBasket(BASKETS.IDENTITY, true)
    const localOutputs = utxos.map(u => ({
      outpoint: `${u.txid}.${u.vout}`,
      satoshis: u.satoshis,
      lockingScript: u.lockingScript,
      tags: u.tags || []
    }))

    // Also try overlay network for discovery
    try {
      const overlayResult = await lookupByTopic(TOPICS.DEFAULT, args.limit || 100, args.offset || 0)
      if (overlayResult && overlayResult.outputs.length > 0) {
        // Merge with local, avoiding duplicates
        const existingOutpoints = new Set(localOutputs.map(o => o.outpoint))
        for (const output of overlayResult.outputs) {
          const outpoint = `${output.txid}.${output.vout}`
          if (!existingOutpoints.has(outpoint)) {
            localOutputs.push({
              outpoint,
              satoshis: output.satoshis,
              lockingScript: output.lockingScript,
              tags: []
            })
          }
        }
      }
    } catch (overlayError) {
      brc100Logger.warn('Overlay lookup failed', undefined, overlayError instanceof Error ? overlayError : undefined)
    }

    return {
      outputs: localOutputs,
      totalOutputs: localOutputs.length
    }
  } catch {
    return { outputs: [], totalOutputs: 0 }
  }
}

// BRC-100 discoverByAttributes - find outputs by tags/attributes
export async function discoverByAttributes(args: {
  attributes: Record<string, string>
  limit?: number
  offset?: number
}): Promise<{
  outputs: DiscoveredOutput[]
  totalOutputs: number
}> {
  // Search across all baskets for matching tags
  try {
    const allUtxos = await getSpendableUTXOs()
    const matchingUtxos = allUtxos.filter(u => {
      if (!u.tags) return false
      // Check if any attribute matches a tag
      return Object.values(args.attributes).some(value =>
        u.tags!.includes(value)
      )
    })

    const limit = args.limit || 100
    const offset = args.offset || 0

    return {
      outputs: matchingUtxos.slice(offset, offset + limit).map(u => ({
        outpoint: `${u.txid}.${u.vout}`,
        satoshis: u.satoshis,
        lockingScript: u.lockingScript,
        tags: u.tags || []
      })),
      totalOutputs: matchingUtxos.length
    }
  } catch {
    return { outputs: [], totalOutputs: 0 }
  }
}

// Re-export overlay functions for convenience
export {
  getOverlayStatus,
  lookupByTopic,
  lookupByAddress,
  TOPICS
} from './overlay'

// Get network status including overlay
export async function getNetworkStatus(): Promise<{
  network: string
  blockHeight: number
  overlayHealthy: boolean
  overlayNodeCount: number
}> {
  const [height, overlayStatus] = await Promise.all([
    getCurrentBlockHeight(),
    getOverlayStatus()
  ])

  return {
    network: 'mainnet',
    blockHeight: height,
    overlayHealthy: overlayStatus.healthy,
    overlayNodeCount: overlayStatus.nodeCount
  }
}
