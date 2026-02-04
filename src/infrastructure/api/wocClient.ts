/**
 * WhatsOnChain API Client
 * Handles all WoC API interactions with proper error handling
 */

import { P2PKH } from '@bsv/sdk'
import type { UTXO } from '../../domain/types'

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

export interface WocClient {
  getBlockHeight(): Promise<number>
  getBalance(address: string): Promise<number>
  getUtxos(address: string): Promise<UTXO[]>
  getTransactionHistory(address: string): Promise<{ tx_hash: string; height: number }[]>
  getTransactionDetails(txid: string): Promise<WocTransaction | null>
  broadcastTransaction(txHex: string): Promise<string>
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

  return {
    async getBlockHeight(): Promise<number> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/chain/info`)
        if (!response.ok) return 0
        const data = await response.json()
        return data.blocks ?? 0
      } catch {
        return 0
      }
    },

    async getBalance(address: string): Promise<number> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/address/${address}/balance`)
        if (!response.ok) return 0
        const data = await response.json()
        if (typeof data.confirmed !== 'number' || typeof data.unconfirmed !== 'number') {
          return 0
        }
        return data.confirmed + data.unconfirmed
      } catch {
        return 0
      }
    },

    async getUtxos(address: string): Promise<UTXO[]> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/address/${address}/unspent`)
        if (!response.ok) return []
        const data = await response.json()
        if (!Array.isArray(data)) return []

        // Generate the P2PKH locking script for this address
        const lockingScript = new P2PKH().lock(address)

        return data.map((utxo: any) => ({
          txid: utxo.tx_hash,
          vout: utxo.tx_pos,
          satoshis: utxo.value,
          script: lockingScript.toHex()
        }))
      } catch {
        return []
      }
    },

    async getTransactionHistory(address: string): Promise<{ tx_hash: string; height: number }[]> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/address/${address}/history`)
        if (!response.ok) return []
        const data = await response.json()
        if (!Array.isArray(data)) return []
        return data
      } catch {
        return []
      }
    },

    async getTransactionDetails(txid: string): Promise<WocTransaction | null> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/tx/${txid}`)
        if (!response.ok) return null
        return await response.json()
      } catch {
        return null
      }
    },

    async broadcastTransaction(txHex: string): Promise<string> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/tx/raw`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txhex: txHex })
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Broadcast failed: ${errorText}`)
        }

        // WoC returns the txid as plain text, sometimes wrapped in quotes
        const txid = await response.text()
        return txid.replace(/"/g, '')
      } catch (error) {
        // Re-throw with consistent error format
        if (error instanceof Error) {
          throw error
        }
        throw new Error('Broadcast failed: Unknown error')
      }
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
