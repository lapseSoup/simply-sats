/**
 * BRC-100 Protocol Types
 *
 * Type definitions for BRC-100 wallet interface requests and responses.
 */

// Valid BRC-100 request types - used for validation
export const BRC100_REQUEST_TYPES = [
  'getPublicKey',
  'createSignature',
  'createAction',
  'getNetwork',
  'getVersion',
  'isAuthenticated',
  'getHeight',
  'listOutputs',
  'lockBSV',
  'unlockBSV',
  'listLocks',
  'encrypt',
  'decrypt',
  'getTaggedKeys'
] as const

export type BRC100RequestType = typeof BRC100_REQUEST_TYPES[number]

/**
 * Validate that a string is a valid BRC-100 request type
 */
export function isValidBRC100RequestType(type: string): type is BRC100RequestType {
  return BRC100_REQUEST_TYPES.includes(type as BRC100RequestType)
}

export interface BRC100Request {
  id: string
  type: BRC100RequestType
  params?: Record<string, unknown>
  origin?: string // The app requesting (e.g., "wrootz.com")
}

export interface BRC100Response {
  id: string
  result?: unknown
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

// Parameter interfaces for various request types
export interface ListOutputsParams {
  basket?: string
  includeSpent?: boolean
  includeTags?: string[]
  limit?: number
  offset?: number
}

export interface LockBSVParams {
  satoshis?: number
  blocks?: number
  ordinalOrigin?: string
  app?: string
}

export interface UnlockBSVParams {
  outpoints?: string[]
}

export interface GetPublicKeyParams {
  identityKey?: boolean
  forOrdinals?: boolean
  protocolID?: [number, string]
  keyID?: string
  counterparty?: string
  privileged?: boolean
}

export interface EncryptDecryptParams {
  plaintext?: number[]
  ciphertext?: number[]
  protocolID?: [number, string]
  keyID?: string
  counterparty?: string
}

export interface GetTaggedKeysParams {
  tag?: string
  limit?: number
  offset?: number
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

// Discovered output from BRC-100 discovery methods
export interface DiscoveredOutput {
  outpoint: string
  satoshis: number
  lockingScript?: string
  tags: string[]
}

/**
 * Extract typed params from a BRC-100 request.
 * WARNING: This provides compile-time safety only. Callers MUST validate
 * params at runtime before use — request.params comes from external input.
 */
export function getParams<T>(request: BRC100Request): T {
  return (request.params || {}) as T
}

/** Output item returned by resolveListOutputs (listOutputs response) */
export interface ListedOutput {
  outpoint: string
  satoshis: number
  lockingScript: string
  tags: string[]
  spendable: boolean
  /** Present only for lock outputs — JSON-encoded unlock metadata */
  customInstructions?: string
}

/** Q-55: Centralized BRC-100 JSON-RPC error codes */
export const BRC100_ERRORS = {
  /** Standard JSON-RPC: method not found */
  METHOD_NOT_FOUND: -32601,
  /** Standard JSON-RPC: invalid params */
  INVALID_PARAMS: -32602,
  /** Application: general server error */
  SERVER_ERROR: -32000,
  /** Application: wallet not loaded */
  WALLET_NOT_LOADED: -32002,
  /** Application: request rejected by user */
  USER_REJECTED: -32003,
} as const
