import { PrivateKey } from '@bsv/sdk'
import type { WalletKeys } from './wallet'

// BRC-100 Protocol Types
export interface BRC100Request {
  id: string
  type: 'getPublicKey' | 'createSignature' | 'createAction' | 'getNetwork' | 'getVersion' | 'isAuthenticated'
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
  }>
  lockTime?: number
  labels?: string[]
  options?: {
    signAndProcess?: boolean
    noSend?: boolean
    randomizeOutputs?: boolean
  }
}

// Pending request queue for user approval
let pendingRequests: Map<string, {
  request: BRC100Request
  resolve: (response: BRC100Response) => void
  reject: (error: any) => void
}> = new Map()

// Callbacks for UI to handle requests
let onRequestCallback: ((request: BRC100Request) => void) | null = null

export function setRequestHandler(callback: (request: BRC100Request) => void) {
  onRequestCallback = callback
}

export function getPendingRequests(): BRC100Request[] {
  return Array.from(pendingRequests.values()).map(p => p.request)
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
export function approveRequest(requestId: string, keys: WalletKeys): void {
  const pending = pendingRequests.get(requestId)
  if (!pending) return

  const { request, resolve } = pending

  try {
    let response: BRC100Response = { id: requestId }

    switch (request.type) {
      case 'createSignature': {
        const sigRequest = request.params as SignatureRequest
        const signature = signData(keys, sigRequest.data, 'identity')
        response.result = { signature: Array.from(Buffer.from(signature, 'hex')) }
        break
      }

      case 'createAction': {
        // For now, return an error - full tx creation would need more implementation
        response.error = { code: -32000, message: 'Transaction creation not yet implemented' }
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
