/**
 * Token Fetching — API calls to fetch token balances/data
 *
 * Handles all HTTP interactions with GorillaPool for BSV20/BSV21
 * token indexing, balance retrieval, and UTXO discovery.
 */

import { tokenLogger } from '../logger'
import { gpOrdinalsApi } from '../../infrastructure/api/clients'
import { upsertToken } from './state'
import type { Token, TokenBalance } from './index'

// GorillaPool API response types
interface GPTokenBalance {
  tick?: string
  id?: string
  sym?: string
  icon?: string
  dec: number
  all: {
    confirmed: string
    pending: string
  }
  listed?: {
    confirmed: string
    pending: string
  }
}

interface GPTokenDetails {
  tick: string
  max: string
  lim: string
  dec: number
  supply?: string
  available?: string
  pctMinted?: number
  accounts?: number
  pending?: number
  pendingOps?: number
  mintTxid?: string
  fundAddress?: string
  fundBalance?: string
  icon?: string
}

// Token UTXO from GorillaPool API
interface TokenUtxoResponse {
  status: number
  txid: string
  vout: number
  amt: string
  tick?: string
  id?: string
}

/**
 * Token UTXO type (from GorillaPool API)
 */
export interface TokenUTXO {
  txid: string
  vout: number
  satoshis: number
  script: string
  height: number
  idx: number
  tick: string
  id?: string // BSV21 contract ID
  amt: string
  status: number // 1 = confirmed
}

/**
 * Set the network for API calls
 * Note: Currently a no-op; gpOrdinalsApi client is configured for mainnet.
 */
export function setTokenNetwork(_network: 'mainnet' | 'testnet'): void {
  // No-op: API calls now route through the pre-configured gpOrdinalsApi client
}

/**
 * Fetch token balances for an address from GorillaPool
 */
export async function fetchTokenBalances(address: string): Promise<TokenBalance[]> {
  try {
    tokenLogger.debug('Fetching token balances', { address })
    const result = await gpOrdinalsApi.get<GPTokenBalance[]>(`/api/bsv20/${address}/balance`)

    if (!result.ok) {
      tokenLogger.error('Failed to fetch balances', undefined, { address, error: result.error.message })
      return []
    }

    const data: GPTokenBalance[] = result.value
    tokenLogger.debug('Token balance API response', { address, count: data.length })
    const balances: TokenBalance[] = []

    // Upsert token metadata for each item (INSERT OR REPLACE — idempotent, no transaction needed)
    const tokens: Token[] = []
    for (const item of data) {
      const ticker = item.tick || item.id || ''
      const protocol = item.id ? 'bsv21' : 'bsv20'

      const token = await upsertToken({
        ticker,
        protocol,
        contractTxid: item.id,
        name: item.sym || ticker,
        decimals: item.dec || 0,
        iconUrl: item.icon,
        verified: false,
        createdAt: Date.now()
      })
      tokens.push(token)
    }

    for (let i = 0; i < data.length; i++) {
      const item = data[i]!
      const token = tokens[i]!

      const confirmed = BigInt(item.all?.confirmed || '0')
      const pending = BigInt(item.all?.pending || '0')
      const listedConfirmed = BigInt(item.listed?.confirmed || '0')
      const listedPending = BigInt(item.listed?.pending || '0')

      balances.push({
        token,
        confirmed,
        pending,
        listed: listedConfirmed + listedPending,
        total: confirmed + pending
      })
    }

    return balances
  } catch (e) {
    tokenLogger.error('Error fetching balances', e)
    return []
  }
}

/**
 * Fetch token metadata by ticker
 */
export async function fetchTokenDetails(ticker: string): Promise<Token | null> {
  try {
    const result = await gpOrdinalsApi.get<GPTokenDetails>(`/api/bsv20/tick/${ticker}`)

    if (!result.ok) {
      return null
    }

    const data: GPTokenDetails = result.value

    return {
      ticker: data.tick,
      protocol: 'bsv20',
      name: data.tick,
      decimals: data.dec || 0,
      totalSupply: data.max,
      iconUrl: data.icon,
      verified: false,
      createdAt: Date.now()
    }
  } catch (e) {
    tokenLogger.error('Error fetching token details', e)
    return null
  }
}

/**
 * Fetch BSV21 token details by contract ID
 */
export async function fetchBsv21Details(contractId: string): Promise<Token | null> {
  try {
    const result = await gpOrdinalsApi.get<{ sym?: string; id?: string; dec?: number; max?: string; icon?: string }>(`/api/bsv20/id/${contractId}`)

    if (!result.ok) {
      return null
    }

    const data = result.value

    return {
      ticker: data.sym || data.id || contractId,
      protocol: 'bsv21',
      contractTxid: contractId,
      name: data.sym,
      decimals: data.dec || 0,
      totalSupply: data.max,
      iconUrl: data.icon,
      verified: false,
      createdAt: Date.now()
    }
  } catch (e) {
    tokenLogger.error('Error fetching BSV21 details', e)
    return null
  }
}

/**
 * Fetch token UTXOs for a specific token
 */
export async function fetchTokenUtxos(
  ticker: string,
  address: string
): Promise<TokenUtxoResponse[]> {
  try {
    const result = await gpOrdinalsApi.get<TokenUtxoResponse[]>(
      `/api/bsv20/${address}/tick/${ticker}`
    )

    if (!result.ok) {
      return []
    }

    const data = result.value
    return data.filter((item: TokenUtxoResponse) => item.status === 1) // Only confirmed
  } catch (e) {
    tokenLogger.error('Error fetching token UTXOs', e)
    return []
  }
}

/**
 * Fetch token UTXOs for sending
 */
export async function getTokenUtxosForSend(
  address: string,
  ticker: string,
  protocol: 'bsv20' | 'bsv21' = 'bsv20'
): Promise<TokenUTXO[]> {
  try {
    const path = protocol === 'bsv21'
      ? `/api/bsv20/${address}/id/${ticker}`
      : `/api/bsv20/${address}/tick/${ticker}`

    const result = await gpOrdinalsApi.get<TokenUTXO[]>(path)

    if (!result.ok) {
      tokenLogger.error('Failed to fetch token UTXOs', undefined, { error: result.error.message })
      return []
    }

    // Filter for confirmed UTXOs (status === 1)
    return result.value.filter((item: TokenUTXO) => item.status === 1)
  } catch (e) {
    tokenLogger.error('Error fetching token UTXOs for send', e)
    return []
  }
}
