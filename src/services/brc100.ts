import { PrivateKey, P2PKH, Transaction } from '@bsv/sdk'
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
  getBalanceFromDB
} from './database'
import { BASKETS, getCurrentBlockHeight } from './sync'
import {
  broadcastWithOverlay,
  lookupByTopic,
  getOverlayStatus,
  TOPICS
} from './overlay'

// BRC-100 Protocol Types
export interface BRC100Request {
  id: string
  type: 'getPublicKey' | 'createSignature' | 'createAction' | 'getNetwork' | 'getVersion' | 'isAuthenticated' | 'getHeight' | 'listOutputs' | 'lockBSV' | 'unlockBSV' | 'listLocks'
  params?: any
  origin?: string // The app requesting (e.g., "wrootz.com")
}

export interface BRC100Response {
  id: string
  result?: any
  error?: { code: number; message: string }
}

export interface SignatureRequest {
  data: number[] // Message as byte array
  protocolID: [number, string] // [securityLevel, protocolName]
  keyID: string
  counterparty?: string
}

export interface CreateActionRequest {
  description: string
  outputs: Array<{
    lockingScript: string
    satoshis: number
    outputDescription?: string
    basket?: string
    tags?: string[]
  }>
  inputs?: Array<{
    outpoint: string
    inputDescription?: string
    unlockingScript?: string
    sequenceNumber?: number
    unlockingScriptLength?: number
  }>
  lockTime?: number
  labels?: string[]
  options?: {
    signAndProcess?: boolean
    noSend?: boolean
    randomizeOutputs?: boolean
  }
}

// Lock tracking
export interface LockedOutput {
  outpoint: string
  txid: string
  vout: number
  satoshis: number
  unlockBlock: number
  tags: string[]
  spendable: boolean
  blocksRemaining: number
}

// Pending request queue for user approval
let pendingRequests: Map<string, {
  request: BRC100Request
  resolve: (response: BRC100Response) => void
  reject: (error: any) => void
}> = new Map()

// Callbacks for UI to handle requests
let onRequestCallback: ((request: BRC100Request) => void) | null = null

// Current wallet keys (set by App component for HTTP server requests)
let currentWalletKeys: WalletKeys | null = null

export function setWalletKeys(keys: WalletKeys | null) {
  currentWalletKeys = keys
}

export function getWalletKeys(): WalletKeys | null {
  return currentWalletKeys
}

export function setRequestHandler(callback: (request: BRC100Request) => void) {
  onRequestCallback = callback
}

export function getPendingRequests(): BRC100Request[] {
  return Array.from(pendingRequests.values()).map(p => p.request)
}

// Set up listener for HTTP server requests via Tauri events
export async function setupHttpServerListener(): Promise<() => void> {
  try {
    const unlisten = await listen<{
      id: string
      method: string
      params: any
      origin?: string
    }>('brc100-request', async (event) => {
      try {
        const request: BRC100Request = {
          id: event.payload.id,
          type: event.payload.method as any,
          params: event.payload.params,
          origin: event.payload.origin
        }

      // If no wallet is loaded, return error for requests that need it
      if (!currentWalletKeys) {
        if (request.type === 'getPublicKey' || request.type === 'createSignature' ||
            request.type === 'createAction' || request.type === 'listOutputs' ||
            request.type === 'lockBSV' || request.type === 'unlockBSV' || request.type === 'listLocks') {
          try {
            await invoke('respond_to_brc100', {
              requestId: request.id,
              response: { error: { code: -32002, message: 'No wallet loaded' } }
            })
          } catch (e) {
            console.error('Failed to send error response:', e)
          }
          return
        }
      }

      if (request.type === 'getPublicKey' && currentWalletKeys) {
        const params = request.params || {}
        let publicKey: string
        if (params.identityKey) {
          publicKey = currentWalletKeys.identityPubKey
        } else if (params.forOrdinals) {
          publicKey = currentWalletKeys.ordPubKey
        } else {
          publicKey = currentWalletKeys.walletPubKey
        }

        try {
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { result: { publicKey } }
          })
        } catch (e) {
          console.error('Failed to send auto-response:', e)
        }
        return
      }

      // Auto-respond to listOutputs using database
      if (request.type === 'listOutputs' && currentWalletKeys) {
        const params = request.params || {}
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
          let dbBasket = basket
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
          console.error('Failed to list outputs:', e)
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { error: { code: -32000, message: 'Failed to list outputs' } }
          })
          return
        }
      }

      // Handle listLocks - returns all time-locked outputs
      if (request.type === 'listLocks' && currentWalletKeys) {
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
          console.error('Failed to list locks:', e)
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { error: { code: -32000, message: 'Failed to list locks' } }
          })
          return
        }
      }

      // Handle lockBSV - creates time-locked output using OP_PUSH_TX
      // This requires user approval as it spends funds
      if (request.type === 'lockBSV' && currentWalletKeys) {
        const params = request.params || {}
        const satoshis = params.satoshis
        const blocks = params.blocks
        const metadata = params.metadata || {}

        if (!satoshis || satoshis <= 0) {
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { error: { code: -32602, message: 'Invalid satoshis amount' } }
          })
          return
        }

        if (!blocks || blocks <= 0) {
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { error: { code: -32602, message: 'Invalid blocks duration' } }
          })
          return
        }

        // This will be handled by the pending request flow for user approval
        // Don't auto-process - let it fall through to be queued for approval
      }

      // Handle unlockBSV - spends time-locked output back to wallet
      // This requires user approval as it spends funds
      if (request.type === 'unlockBSV' && currentWalletKeys) {
        const params = request.params || {}
        const outpoint = params.outpoint

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
            console.error('Failed to send BRC-100 response:', e)
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
            console.error('Failed to send BRC-100 error:', e)
          }
        }
      })

      if (onRequestCallback) {
        onRequestCallback(request)
      }
      } catch (err) {
        console.error('BRC-100: Error in event handler:', err)
      }
    })

    return unlisten
  } catch {
    return () => {}
  }
}

// Sign a message with the identity key
export function signMessage(keys: WalletKeys, message: string): string {
  const privateKey = PrivateKey.fromWif(keys.identityWif)
  const messageBytes = new TextEncoder().encode(message)
  const signature = privateKey.sign(Array.from(messageBytes))
  // Convert signature to hex string
  const sigBytes = signature as unknown as number[]
  return Buffer.from(sigBytes).toString('hex')
}

// Sign arbitrary data with specified key
export function signData(keys: WalletKeys, data: number[], keyType: 'identity' | 'wallet' | 'ordinals' = 'identity'): string {
  let wif: string
  switch (keyType) {
    case 'wallet':
      wif = keys.walletWif
      break
    case 'ordinals':
      wif = keys.ordWif
      break
    default:
      wif = keys.identityWif
  }

  const privateKey = PrivateKey.fromWif(wif)
  const signature = privateKey.sign(data)
  // Convert signature to hex string
  const sigBytes = signature as unknown as number[]
  return Buffer.from(sigBytes).toString('hex')
}

// Verify a signature
export function verifySignature(_publicKeyHex: string, _message: string, signatureHex: string): boolean {
  try {
    // This would need proper implementation with @bsv/sdk verification
    // For now, return true if signature exists
    return signatureHex.length > 0
  } catch {
    return false
  }
}

// Get current block height from WhatsOnChain
export async function getBlockHeight(): Promise<number> {
  try {
    const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/chain/info')
    const data = await response.json()
    return data.blocks
  } catch {
    return 0
  }
}

// Create a CLTV time-locked locking script
export function createCLTVLockingScript(pubKeyHex: string, lockTime: number): string {
  const lockTimeHex = encodeScriptNum(lockTime)
  return lockTimeHex + 'b175' + pushData(pubKeyHex) + 'ac'
}

// Encode number for script
function encodeScriptNum(num: number): string {
  if (num === 0) return '00'
  if (num >= 1 && num <= 16) return (0x50 + num).toString(16)

  const bytes: number[] = []
  let n = Math.abs(num)
  while (n > 0) {
    bytes.push(n & 0xff)
    n >>= 8
  }

  // Add sign bit if needed
  if (bytes[bytes.length - 1] & 0x80) {
    bytes.push(num < 0 ? 0x80 : 0x00)
  } else if (num < 0) {
    bytes[bytes.length - 1] |= 0x80
  }

  const len = bytes.length
  const lenHex = len.toString(16).padStart(2, '0')
  const dataHex = bytes.map(b => b.toString(16).padStart(2, '0')).join('')

  return lenHex + dataHex
}

// Create push data opcode
function pushData(hexData: string): string {
  const len = hexData.length / 2
  if (len < 0x4c) {
    return len.toString(16).padStart(2, '0') + hexData
  } else if (len <= 0xff) {
    return '4c' + len.toString(16).padStart(2, '0') + hexData
  } else if (len <= 0xffff) {
    return '4d' + len.toString(16).padStart(4, '0').match(/.{2}/g)!.reverse().join('') + hexData
  } else {
    return '4e' + len.toString(16).padStart(8, '0').match(/.{2}/g)!.reverse().join('') + hexData
  }
}

// Create OP_RETURN script for Wrootz protocol data
function createWrootzOpReturn(action: string, data: string): string {
  let script = '6a00' // OP_RETURN OP_FALSE
  script += pushData(Buffer.from('wrootz').toString('hex'))
  script += pushData(Buffer.from(action).toString('hex'))
  script += pushData(Buffer.from(data).toString('hex'))
  return script
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
    console.error('Failed to get locks from database:', error)
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
  let numOutputs = ordinalOrigin ? 3 : 2 // lock + opreturn + change, or just lock + change
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
    lockingScript: {
      toHex: () => lockingScript
    } as any,
    satoshis
  })

  // Add OP_RETURN for ordinal reference if provided
  if (ordinalOrigin) {
    const opReturnScript = createWrootzOpReturn('lock', ordinalOrigin)
    tx.addOutput({
      lockingScript: {
        toHex: () => opReturnScript
      } as any,
      satoshis: 0
    })
  }

  // Add change output
  if (change > 546) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(fromAddress),
      satoshis: change
    })
  }

  await tx.sign()

  // Broadcast
  const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: tx.toHex() })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to broadcast: ${errorText}`)
  }

  const txid = tx.id('hex')

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

    console.log('Lock saved to database:', { txid, utxoId, unlockBlock })
  } catch (error) {
    console.error('Failed to save lock to database:', error)
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
        const params = request.params || {}
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
        const params = request.params || {}
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
            let dbBasket = basket
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
          console.error('listOutputs error:', error)
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
        const sigRequest = request.params as SignatureRequest

        // If not auto-approve, queue for user approval
        if (!autoApprove) {
          return new Promise((resolve, reject) => {
            pendingRequests.set(request.id, { request, resolve, reject })
            if (onRequestCallback) {
              onRequestCallback(request)
            }
          })
        }

        // Sign with identity key by default
        const signature = signData(keys, sigRequest.data, 'identity')
        response.result = { signature: Array.from(Buffer.from(signature, 'hex')) }
        break
      }

      case 'createAction': {
        // Queue for user approval - transactions always need approval
        return new Promise((resolve, reject) => {
          pendingRequests.set(request.id, { request, resolve, reject })
          if (onRequestCallback) {
            onRequestCallback(request)
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

  try {
    let response: BRC100Response = { id: requestId }

    switch (request.type) {
      case 'getPublicKey': {
        const params = request.params || {}
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
        const sigRequest = request.params as SignatureRequest
        const signature = signData(keys, sigRequest.data, 'identity')
        response.result = { signature: Array.from(Buffer.from(signature, 'hex')) }
        break
      }

      case 'createAction': {
        const actionRequest = request.params as CreateActionRequest

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
        const params = request.params || {}
        const satoshis = params.satoshis
        const blocks = params.blocks
        const metadata = params.metadata || {}

        try {
          const currentHeight = await getCurrentBlockHeight()
          const unlockBlock = currentHeight + blocks

          // Get spendable UTXOs
          const utxos = await getSpendableUTXOs()
          if (utxos.length === 0) {
            response.error = { code: -32000, message: 'No spendable UTXOs available' }
            break
          }

          // Use the wallet's native lockBSV function (OP_PUSH_TX)
          const result = await walletLockBSV(
            keys.walletWif,
            satoshis,
            unlockBlock,
            utxos
          )

          // Track the lock in database
          await addLock({
            utxo: {
              txid: result.txid,
              vout: 0,
              satoshis,
              lockingScript: result.lockedUtxo.lockingScript
            },
            unlockBlock,
            ordinalOrigin: metadata.ordinalOrigin || null,
            app: metadata.app || 'wrootz'
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
        const params = request.params || {}
        const outpoint = params.outpoint

        try {
          const currentHeight = await getCurrentBlockHeight()
          const locks = await getLocksFromDB(currentHeight)

          // Find the lock by outpoint
          const [txid, voutStr] = outpoint.split('.')
          const vout = parseInt(voutStr) || 0
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

          // Mark lock as unlocked in database
          await markLockUnlocked(lock.utxo.txid, lock.utxo.vout, unlockTxid)

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

      default:
        response.error = { code: -32601, message: 'Method not found' }
    }

    resolve(response)
  } catch (error) {
    resolve({
      id: requestId,
      error: { code: -32000, message: error instanceof Error ? error.message : 'Unknown error' }
    })
  }

  pendingRequests.delete(requestId)
}

// Check if this is an inscription transaction (1Sat Ordinals)
function isInscriptionTransaction(actionRequest: CreateActionRequest): boolean {
  // Check for inscription markers in outputs
  return actionRequest.outputs.some(o => {
    // Check basket name
    if (o.basket?.includes('ordinal') || o.basket?.includes('inscription')) return true
    // Check tags
    if (o.tags?.some(t => t.includes('inscription') || t.includes('ordinal'))) return true
    // Check for 1-sat outputs with long locking scripts (inscription envelope)
    // Inscription scripts start with OP_FALSE OP_IF "ord" ... OP_ENDIF
    if (o.satoshis === 1 && o.lockingScript.length > 100) {
      // Check for inscription envelope marker: 0063 (OP_FALSE OP_IF) followed by "ord" push
      if (o.lockingScript.startsWith('0063') && o.lockingScript.includes('036f7264')) {
        return true
      }
    }
    return false
  })
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
    console.log('Detected inscription transaction, using ordinals address')
  }

  // Get UTXOs - for inscriptions, we still use wallet UTXOs as funding
  const utxos = await getUTXOs(fromAddress)
  if (utxos.length === 0) {
    throw new Error('No UTXOs available')
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
    tx.addOutput({
      lockingScript: {
        toHex: () => output.lockingScript
      } as any,
      satoshis: output.satoshis
    })
  }

  // Add change output
  if (change > 546) {
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
  console.log('Overlay broadcast results:', {
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
    // For inscriptions, add the ordinal output
    if (isInscription) {
      for (let i = 0; i < actionRequest.outputs.length; i++) {
        const output = actionRequest.outputs[i]
        // Inscription outputs are typically 1 sat
        if (output.satoshis === 1 && output.lockingScript.length > 100) {
          await addUTXO({
            txid,
            vout: i,
            satoshis: output.satoshis,
            lockingScript: output.lockingScript,
            basket: BASKETS.ORDINALS,
            spendable: true,
            createdAt: Date.now(),
            tags: output.tags || ['inscription', 'ordinal', 'wrootz']
          })
          console.log(`Inscription output added to ordinals basket: ${txid}:${i}`)
        }
      }
    }

    // Add change output
    if (change > 546) {
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

    console.log('Transaction tracked in database:', txid)
  } catch (error) {
    console.error('Failed to track transaction in database:', error)
    // Transaction is already broadcast, continue
  }

  return { txid }
}

// Reject a pending request
export function rejectRequest(requestId: string): void {
  const pending = pendingRequests.get(requestId)
  if (!pending) return

  pending.resolve({
    id: requestId,
    error: { code: -32003, message: 'User rejected request' }
  })

  pendingRequests.delete(requestId)
}

// Generate a unique request ID
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// BRC-100 acquireCertificate - placeholder for future implementation
export interface AcquireCertificateArgs {
  type: string
  certifier: string
  acquisitionProtocol: 'direct' | 'issuance'
  fields?: Record<string, string>
  serialNumber?: string
}

export async function acquireCertificate(_args: AcquireCertificateArgs): Promise<{
  type: string
  subject: string
  certifier: string
  serialNumber: string
  fields: Record<string, string>
  signature: string
}> {
  // TODO: Implement certificate acquisition
  throw new Error('Certificate acquisition not yet implemented')
}

// BRC-100 listCertificates - placeholder for future implementation
export async function listCertificates(_args: {
  certifiers?: string[]
  types?: string[]
  limit?: number
  offset?: number
}): Promise<{
  certificates: any[]
  totalCertificates: number
}> {
  // TODO: Query certificates from database
  return { certificates: [], totalCertificates: 0 }
}

// BRC-100 discoverByIdentityKey - find outputs belonging to an identity
export async function discoverByIdentityKey(args: {
  identityKey: string
  limit?: number
  offset?: number
}): Promise<{
  outputs: any[]
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
      console.warn('Overlay lookup failed:', overlayError)
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
  outputs: any[]
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

// Format identity key for display (similar to Yours Wallet)
export function formatIdentityKey(pubKey: string): string {
  if (pubKey.length <= 16) return pubKey
  return `${pubKey.slice(0, 8)}...${pubKey.slice(-8)}`
}

// Get the identity key in the format apps expect
export function getIdentityKeyForApp(keys: WalletKeys): {
  identityKey: string
  identityAddress: string
} {
  return {
    identityKey: keys.identityPubKey,
    identityAddress: keys.identityAddress
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
