/**
 * WhatsOnChain API Client
 * Handles all WoC API interactions with proper error handling
 */

import { P2PKH } from '@bsv/sdk'
import type { UTXO } from '../../domain/types'
import { type Result, ok, err } from '../../services/errors'

/**
 * API error with additional context
 */
export interface ApiError {
  code: string
  message: string
  status?: number
}

export interface WocConfig {
  baseUrl: string
  timeout: number
}

/**
 * Transaction details returned by WhatsOnChain
 * Captures core fields from the WoC API response
 */
export interface WocTransaction {
  txid: string
  hash: string
  version: number
  size: number
  locktime: number
  vin: Array<{
    txid?: string
    vout?: number
    scriptSig?: { asm: string; hex: string }
    sequence: number
    coinbase?: string
  }>
  vout: Array<{
    value: number
    n: number
    scriptPubKey: {
      asm: string
      hex: string
      type: string
      addresses?: string[]
    }
  }>
  blockhash?: string
  confirmations?: number
  time?: number
  blocktime?: number
}

export const DEFAULT_WOC_CONFIG: WocConfig = {
  baseUrl: 'https://api.whatsonchain.com/v1/bsv/main',
  timeout: 30000
}

/**
 * WocClient interface with Result-based error handling
 * Methods ending with 'Safe' return Result types for explicit error handling
 */
export interface WocClient {
  // Legacy methods that return defaults on error (for backwards compatibility)
  getBlockHeight(): Promise<number>
  getBalance(address: string): Promise<number>
  getUtxos(address: string): Promise<UTXO[]>
  getTransactionHistory(address: string): Promise<{ tx_hash: string; height: number }[]>
  getTransactionDetails(txid: string): Promise<WocTransaction | null>
  broadcastTransaction(txHex: string): Promise<string>

  // Safe methods that return Result types for explicit error handling
  getBlockHeightSafe(): Promise<Result<number, ApiError>>
  getBalanceSafe(address: string): Promise<Result<number, ApiError>>
  getUtxosSafe(address: string): Promise<Result<UTXO[], ApiError>>
  getTransactionHistorySafe(address: string): Promise<Result<{ tx_hash: string; height: number }[], ApiError>>
  getTransactionDetailsSafe(txid: string): Promise<Result<WocTransaction, ApiError>>
  broadcastTransactionSafe(txHex: string): Promise<Result<string, ApiError>>
}

/**
 * Create a WhatsOnChain API client
 * Returns an object with methods - allows dependency injection
 */
export function createWocClient(config: Partial<WocConfig> = {}): WocClient {
  const cfg: WocConfig = { ...DEFAULT_WOC_CONFIG, ...config }

  const fetchWithTimeout = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), cfg.timeout)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      })
      return response
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // Helper to create API errors
  const createApiError = (code: string, message: string, status?: number): ApiError => ({
    code,
    message,
    status
  })

  return {
    // ========================================
    // Safe methods with Result types
    // ========================================

    async getBlockHeightSafe(): Promise<Result<number, ApiError>> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/chain/info`)
        if (!response.ok) {
          return err(createApiError('NETWORK_ERROR', `HTTP ${response.status}: ${response.statusText}`, response.status))
        }
        const data = await response.json()
        return ok(data.blocks ?? 0)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error'
        return err(createApiError('FETCH_ERROR', message))
      }
    },

    async getBalanceSafe(address: string): Promise<Result<number, ApiError>> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/address/${address}/balance`)
        if (!response.ok) {
          return err(createApiError('NETWORK_ERROR', `HTTP ${response.status}: ${response.statusText}`, response.status))
        }
        const data = await response.json()
        if (typeof data.confirmed !== 'number' || typeof data.unconfirmed !== 'number') {
          return err(createApiError('INVALID_RESPONSE', 'Invalid balance response format'))
        }
        return ok(data.confirmed + data.unconfirmed)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error'
        return err(createApiError('FETCH_ERROR', message))
      }
    },

    async getUtxosSafe(address: string): Promise<Result<UTXO[], ApiError>> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/address/${address}/unspent`)
        if (!response.ok) {
          return err(createApiError('NETWORK_ERROR', `HTTP ${response.status}: ${response.statusText}`, response.status))
        }
        const data = await response.json()
        if (!Array.isArray(data)) {
          return err(createApiError('INVALID_RESPONSE', 'Expected array of UTXOs'))
        }

        // Generate the P2PKH locking script for this address
        const lockingScript = new P2PKH().lock(address)

        const utxos = data
          .filter((utxo: { tx_hash: string; tx_pos: number; value: number }) => {
            // Validate UTXO fields: reject malformed entries from API
            return (
              typeof utxo.tx_hash === 'string' && utxo.tx_hash.length === 64 &&
              Number.isInteger(utxo.tx_pos) && utxo.tx_pos >= 0 &&
              Number.isInteger(utxo.value) && utxo.value > 0
            )
          })
          .map((utxo: { tx_hash: string; tx_pos: number; value: number }) => ({
            txid: utxo.tx_hash,
            vout: utxo.tx_pos,
            satoshis: utxo.value,
            script: lockingScript.toHex()
          }))
        return ok(utxos)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error'
        return err(createApiError('FETCH_ERROR', message))
      }
    },

    async getTransactionHistorySafe(address: string): Promise<Result<{ tx_hash: string; height: number }[], ApiError>> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/address/${address}/history`)
        if (!response.ok) {
          return err(createApiError('NETWORK_ERROR', `HTTP ${response.status}: ${response.statusText}`, response.status))
        }
        const data = await response.json()
        if (!Array.isArray(data)) {
          return err(createApiError('INVALID_RESPONSE', 'Expected array of transactions'))
        }
        return ok(data)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error'
        return err(createApiError('FETCH_ERROR', message))
      }
    },

    async getTransactionDetailsSafe(txid: string): Promise<Result<WocTransaction, ApiError>> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/tx/${txid}`)
        if (!response.ok) {
          return err(createApiError('NETWORK_ERROR', `HTTP ${response.status}: ${response.statusText}`, response.status))
        }
        const data = await response.json()
        return ok(data)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error'
        return err(createApiError('FETCH_ERROR', message))
      }
    },

    async broadcastTransactionSafe(txHex: string): Promise<Result<string, ApiError>> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/tx/raw`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txhex: txHex })
        })

        if (!response.ok) {
          const errorText = await response.text()
          return err(createApiError('BROADCAST_ERROR', `Broadcast failed: ${errorText}`, response.status))
        }

        // WoC returns the txid as plain text, sometimes wrapped in quotes
        const txid = await response.text()
        return ok(txid.replace(/"/g, ''))
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error'
        return err(createApiError('BROADCAST_ERROR', message))
      }
    },

    // ========================================
    // Legacy methods (backwards compatible)
    // These use the safe methods internally
    // ========================================

    async getBlockHeight(): Promise<number> {
      const result = await this.getBlockHeightSafe()
      return result.success ? result.data : 0
    },

    async getBalance(address: string): Promise<number> {
      const result = await this.getBalanceSafe(address)
      return result.success ? result.data : 0
    },

    async getUtxos(address: string): Promise<UTXO[]> {
      const result = await this.getUtxosSafe(address)
      return result.success ? result.data : []
    },

    async getTransactionHistory(address: string): Promise<{ tx_hash: string; height: number }[]> {
      const result = await this.getTransactionHistorySafe(address)
      return result.success ? result.data : []
    },

    async getTransactionDetails(txid: string): Promise<WocTransaction | null> {
      const result = await this.getTransactionDetailsSafe(txid)
      return result.success ? result.data : null
    },

    async broadcastTransaction(txHex: string): Promise<string> {
      const result = await this.broadcastTransactionSafe(txHex)
      if (result.success) {
        return result.data
      }
      throw new Error(result.error.message)
    }
  }
}

// Default client instance for convenience
let defaultClient: WocClient | null = null

export function getWocClient(): WocClient {
  if (!defaultClient) {
    defaultClient = createWocClient()
  }
  return defaultClient
}
