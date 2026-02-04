/**
 * API Response Types
 *
 * Type definitions for external API responses (WhatsOnChain, GorillaPool, etc.)
 * These types ensure type safety when working with external data.
 */

// ============================================
// WhatsOnChain API Types
// ============================================

/**
 * WhatsOnChain balance response
 * GET /address/{address}/balance
 */
export interface WocBalanceResponse {
  confirmed: number
  unconfirmed: number
}

/**
 * WhatsOnChain UTXO response item
 * GET /address/{address}/unspent
 */
export interface WocUtxoResponse {
  tx_hash: string
  tx_pos: number
  value: number
  height: number
}

/**
 * WhatsOnChain transaction history item
 * GET /address/{address}/history
 */
export interface WocHistoryItem {
  tx_hash: string
  height: number
}

/**
 * WhatsOnChain transaction input
 */
export interface WocTransactionInput {
  txid?: string
  vout?: number
  scriptSig?: {
    asm: string
    hex: string
  }
  sequence: number
  coinbase?: string
  // Some APIs include prevout
  prevout?: {
    value: number
    scriptPubKey?: {
      addresses?: string[]
    }
  }
}

/**
 * WhatsOnChain transaction output
 */
export interface WocTransactionOutput {
  value: number
  n: number
  scriptPubKey: {
    asm: string
    hex: string
    type: string
    addresses?: string[]
    reqSigs?: number
  }
}

/**
 * WhatsOnChain transaction details
 * GET /tx/{txid}
 */
export interface WocTransactionDetails {
  txid: string
  hash: string
  version: number
  size: number
  locktime: number
  vin: WocTransactionInput[]
  vout: WocTransactionOutput[]
  blockhash?: string
  confirmations?: number
  time?: number
  blocktime?: number
  blockheight?: number
}

/**
 * WhatsOnChain chain info
 * GET /chain/info
 */
export interface WocChainInfo {
  chain: string
  blocks: number
  headers: number
  bestblockhash: string
  difficulty: number
  mediantime: number
  verificationprogress: number
  chainwork: string
  pruned: boolean
}

/**
 * WhatsOnChain broadcast response
 * POST /tx/raw
 */
export type WocBroadcastResponse = string // Returns txid

// ============================================
// GorillaPool API Types
// ============================================

/**
 * GorillaPool mAPI fee quote response
 */
export interface GorillaPoolFeeQuotePayload {
  apiVersion: string
  timestamp: string
  expiryTime: string
  minerId: string
  currentHighestBlockHash: string
  currentHighestBlockHeight: number
  fees: GorillaPoolFee[]
}

export interface GorillaPoolFee {
  feeType: 'standard' | 'data'
  miningFee: {
    satoshis: number
    bytes: number
  }
  relayFee: {
    satoshis: number
    bytes: number
  }
}

export interface GorillaPoolFeeQuoteResponse {
  payload: string | GorillaPoolFeeQuotePayload
  signature: string
  publicKey: string
  encoding: string
  mimetype: string
}

/**
 * GorillaPool ARC broadcast response
 */
export interface GorillaPoolArcResponse {
  txid?: string
  txStatus?: 'RECEIVED' | 'ACCEPTED' | 'REJECTED' | 'SEEN_ON_NETWORK' | 'SEEN_IN_ORPHAN_MEMPOOL'
  extraInfo?: string
  blockHash?: string
  blockHeight?: number
  timestamp?: string
  detail?: string
  status?: number
}

/**
 * GorillaPool mAPI broadcast response
 */
export interface GorillaPoolMapiResponse {
  payload: string | {
    apiVersion: string
    timestamp: string
    txid: string
    returnResult: 'success' | 'failure'
    resultDescription: string
    minerId: string
    currentHighestBlockHash: string
    currentHighestBlockHeight: number
    txSecondMempoolExpiry: number
  }
  signature: string
  publicKey: string
  encoding: string
  mimetype: string
}

// ============================================
// GorillaPool Ordinals API Types
// ============================================

/**
 * GorillaPool ordinal/inscription response
 */
export interface GorillaPoolOrdinal {
  txid: string
  vout: number
  outpoint: string
  origin: string
  height?: number
  idx?: number
  lock?: string
  spend?: string
  MAP?: Record<string, string>
  B?: {
    content: string
    'content-type': string
    encoding?: string
  }
  SIGMA?: Array<{
    algorithm: string
    address: string
    signature: string
    vin: number
  }>
  listing?: boolean
  price?: number
  payout?: string
  num?: number
  file?: {
    hash: string
    size: number
    type: string
  }
}

// ============================================
// GorillaPool Token API Types
// ============================================

/**
 * GorillaPool BSV-20/BSV-21 token balance response
 */
export interface GorillaPoolTokenBalance {
  tick?: string           // BSV-20 ticker
  id?: string             // BSV-21 contract txid
  sym?: string            // Symbol
  dec?: number            // Decimals
  icon?: string           // Icon URL
  all?: {
    confirmed: string     // BigInt as string
    pending: string       // BigInt as string
  }
  listed?: {
    confirmed: string
    pending: string
  }
}

/**
 * GorillaPool token UTXO response
 */
export interface GorillaPoolTokenUtxo {
  txid: string
  vout: number
  outpoint: string
  owner: string
  script: string
  satoshis: number
  height?: number
  idx?: number
  tick?: string
  id?: string
  amt: string             // Amount as string (BigInt)
  status: number          // 1 = confirmed
  listing?: boolean
  price?: number
  payout?: string
}

// ============================================
// Type Guards
// ============================================

/**
 * Type guard for WocBalanceResponse
 */
export function isWocBalanceResponse(data: unknown): data is WocBalanceResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as WocBalanceResponse).confirmed === 'number' &&
    typeof (data as WocBalanceResponse).unconfirmed === 'number'
  )
}

/**
 * Type guard for WocUtxoResponse array
 */
export function isWocUtxoArray(data: unknown): data is WocUtxoResponse[] {
  return (
    Array.isArray(data) &&
    data.every(item =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.tx_hash === 'string' &&
      typeof item.tx_pos === 'number' &&
      typeof item.value === 'number'
    )
  )
}

/**
 * Type guard for WocHistoryItem array
 */
export function isWocHistoryArray(data: unknown): data is WocHistoryItem[] {
  return (
    Array.isArray(data) &&
    data.every(item =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.tx_hash === 'string' &&
      typeof item.height === 'number'
    )
  )
}

/**
 * Type guard for WocTransactionDetails
 */
export function isWocTransactionDetails(data: unknown): data is WocTransactionDetails {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as WocTransactionDetails).txid === 'string' &&
    Array.isArray((data as WocTransactionDetails).vin) &&
    Array.isArray((data as WocTransactionDetails).vout)
  )
}

/**
 * Type guard for GorillaPoolArcResponse with valid txid
 */
export function isSuccessfulArcResponse(data: unknown): data is GorillaPoolArcResponse & { txid: string } {
  if (typeof data !== 'object' || data === null) return false
  const response = data as GorillaPoolArcResponse
  return (
    typeof response.txid === 'string' &&
    response.txid.length === 64 &&
    (response.txStatus === 'ACCEPTED' || response.txStatus === 'SEEN_ON_NETWORK')
  )
}

/**
 * Type guard for GorillaPoolTokenBalance array
 */
export function isGorillaPoolTokenBalanceArray(data: unknown): data is GorillaPoolTokenBalance[] {
  return (
    Array.isArray(data) &&
    data.every(item =>
      typeof item === 'object' &&
      item !== null &&
      (typeof item.tick === 'string' || typeof item.id === 'string')
    )
  )
}
