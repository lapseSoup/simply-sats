/**
 * Token State — token state management, caching, and DB operations
 *
 * Handles all database operations for tokens: CRUD operations on token metadata,
 * balance tracking, transfer history, favorites, and formatting utilities.
 */

import { tokenLogger } from '../logger'
import { getDatabase } from '../database'
import type { TokenRow, TokenBalanceRow, TokenTransferRow, IdCheckRow, SqlParams } from '../../infrastructure/database/row-types'
import type { Token, TokenBalance } from './index'
import { fetchTokenBalances } from './fetching'

/**
 * Ensure tokens tables exist
 */
export async function ensureTokensTables(): Promise<void> {
  const database = getDatabase()

  try {
    await database.select<IdCheckRow[]>('SELECT id FROM tokens LIMIT 1')
  } catch {
    tokenLogger.info('Tables will be created by migration')
  }
}

/**
 * Upsert a token (insert or update)
 */
export async function upsertToken(token: Omit<Token, 'id'>): Promise<Token> {
  const database = getDatabase()

  // Try to find existing token
  const existing = await getTokenByTicker(token.ticker, token.protocol)

  if (existing) {
    // Update existing token
    await database.execute(
      `UPDATE tokens SET
        name = COALESCE($1, name),
        decimals = $2,
        total_supply = COALESCE($3, total_supply),
        icon_url = COALESCE($4, icon_url),
        contract_txid = COALESCE($5, contract_txid)
       WHERE id = $6`,
      [
        token.name,
        token.decimals,
        token.totalSupply,
        token.iconUrl,
        token.contractTxid,
        existing.id
      ]
    )
    return { ...existing, ...token }
  }

  // Insert new token
  const result = await database.execute(
    `INSERT INTO tokens (ticker, protocol, contract_txid, name, decimals, total_supply, icon_url, verified, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      token.ticker,
      token.protocol,
      token.contractTxid,
      token.name,
      token.decimals,
      token.totalSupply,
      token.iconUrl,
      token.verified ? 1 : 0,
      token.createdAt
    ]
  )

  return { ...token, id: result.lastInsertId as number }
}

/**
 * Get token by ticker and protocol
 */
export async function getTokenByTicker(
  ticker: string,
  protocol: 'bsv20' | 'bsv21' = 'bsv20'
): Promise<Token | null> {
  const database = getDatabase()

  try {
    const rows = await database.select<TokenRow[]>(
      'SELECT * FROM tokens WHERE ticker = $1 AND protocol = $2',
      [ticker, protocol]
    )

    if (rows.length === 0) return null

    const row = rows[0]!
    return {
      id: row.id,
      ticker: row.ticker,
      protocol: row.protocol as 'bsv20' | 'bsv21',
      contractTxid: row.contract_txid ?? undefined,
      name: row.name ?? undefined,
      decimals: row.decimals,
      totalSupply: row.total_supply ?? undefined,
      iconUrl: row.icon_url ?? undefined,
      verified: row.verified === 1,
      createdAt: row.created_at
    }
  } catch (e) {
    tokenLogger.warn('Failed to get token by ticker', { ticker, protocol, error: e })
    return null
  }
}

/**
 * Get token by ID
 */
export async function getTokenById(tokenId: number): Promise<Token | null> {
  const database = getDatabase()

  try {
    const rows = await database.select<TokenRow[]>(
      'SELECT * FROM tokens WHERE id = $1',
      [tokenId]
    )

    if (rows.length === 0) return null

    const row = rows[0]!
    return {
      id: row.id,
      ticker: row.ticker,
      protocol: row.protocol as 'bsv20' | 'bsv21',
      contractTxid: row.contract_txid ?? undefined,
      name: row.name ?? undefined,
      decimals: row.decimals,
      totalSupply: row.total_supply ?? undefined,
      iconUrl: row.icon_url ?? undefined,
      verified: row.verified === 1,
      createdAt: row.created_at
    }
  } catch (e) {
    tokenLogger.warn('Failed to get token by ID', { tokenId, error: e })
    return null
  }
}

/**
 * Get all known tokens
 */
export async function getAllTokens(): Promise<Token[]> {
  const database = getDatabase()

  try {
    const rows = await database.select<TokenRow[]>(
      'SELECT * FROM tokens ORDER BY ticker ASC'
    )

    return rows.map(row => ({
      id: row.id,
      ticker: row.ticker,
      protocol: row.protocol as 'bsv20' | 'bsv21',
      contractTxid: row.contract_txid ?? undefined,
      name: row.name ?? undefined,
      decimals: row.decimals,
      totalSupply: row.total_supply ?? undefined,
      iconUrl: row.icon_url ?? undefined,
      verified: row.verified === 1,
      createdAt: row.created_at
    }))
  } catch (e) {
    tokenLogger.warn('Failed to get all tokens', { error: e })
    return []
  }
}

/**
 * Add/update token balance record
 */
export async function updateTokenBalance(
  accountId: number,
  tokenId: number,
  amount: string,
  utxoId?: number
): Promise<void> {
  const database = getDatabase()

  await database.execute(
    `INSERT OR REPLACE INTO token_balances (account_id, token_id, utxo_id, amount, status, created_at)
     VALUES ($1, $2, $3, $4, 'confirmed', $5)`,
    [accountId, tokenId, utxoId, amount, Date.now()]
  )
}

/**
 * Get token balances for an account from database
 */
export async function getTokenBalancesFromDb(accountId: number): Promise<TokenBalance[]> {
  const database = getDatabase()

  try {
    const rows = await database.select<TokenBalanceRow[]>(
      `SELECT tb.*, t.*
       FROM token_balances tb
       INNER JOIN tokens t ON tb.token_id = t.id
       WHERE tb.account_id = $1`,
      [accountId]
    )

    const balanceMap = new Map<number, TokenBalance>()

    for (const row of rows) {
      const tokenId = row.token_id
      const amount = BigInt(row.amount || '0')

      if (!balanceMap.has(tokenId)) {
        balanceMap.set(tokenId, {
          token: {
            id: row.token_id,
            ticker: row.ticker,
            protocol: row.protocol as 'bsv20' | 'bsv21',
            contractTxid: row.contract_txid ?? undefined,
            name: row.name ?? undefined,
            decimals: row.decimals,
            totalSupply: row.total_supply ?? undefined,
            iconUrl: row.icon_url ?? undefined,
            verified: row.verified === 1,
            createdAt: row.created_at
          },
          confirmed: 0n,
          pending: 0n,
          listed: 0n,
          total: 0n
        })
      }

      const balance = balanceMap.get(tokenId)!
      if (row.status === 'confirmed') {
        balance.confirmed += amount
      } else if (row.status === 'pending') {
        balance.pending += amount
      } else if (row.status === 'listed') {
        balance.listed += amount
      }
      balance.total = balance.confirmed + balance.pending
    }

    return Array.from(balanceMap.values())
  } catch (e) {
    tokenLogger.warn('Failed to get token balances from DB', { accountId, error: e })
    return []
  }
}

/**
 * Record a token transfer
 */
export async function recordTokenTransfer(
  accountId: number,
  tokenId: number,
  txid: string,
  amount: string,
  direction: 'in' | 'out',
  counterparty?: string
): Promise<void> {
  const database = getDatabase()

  await database.execute(
    `INSERT INTO token_transfers (account_id, token_id, txid, amount, direction, counterparty, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [accountId, tokenId, txid, amount, direction, counterparty, Date.now()]
  )
}

/**
 * Get token transfer history
 */
export async function getTokenTransfers(
  accountId: number,
  tokenId?: number,
  limit = 50
): Promise<TokenTransferRow[]> {
  const database = getDatabase()

  try {
    let query = `
      SELECT tt.*, t.ticker, t.decimals, t.icon_url
      FROM token_transfers tt
      INNER JOIN tokens t ON tt.token_id = t.id
      WHERE tt.account_id = $1
    `
    const params: SqlParams = [accountId]

    if (tokenId) {
      query += ' AND tt.token_id = $2'
      params.push(tokenId)
    }

    query += ' ORDER BY tt.created_at DESC LIMIT $' + (params.length + 1)
    params.push(limit)

    return await database.select<TokenTransferRow[]>(query, params)
  } catch (e) {
    tokenLogger.warn('Failed to get token transfers', { accountId, tokenId, error: e })
    return []
  }
}

/**
 * Format token amount with decimals
 */
export function formatTokenAmount(amount: bigint, decimals: number): string {
  if (decimals === 0) {
    return amount.toString()
  }

  const str = amount.toString().padStart(decimals + 1, '0')
  const intPart = str.slice(0, -decimals) || '0'
  const decPart = str.slice(-decimals)

  // Remove trailing zeros
  const trimmedDec = decPart.replace(/0+$/, '')

  return trimmedDec ? `${intPart}.${trimmedDec}` : intPart
}

/**
 * Parse token amount from string
 */
export function parseTokenAmount(amountStr: string, decimals: number): bigint {
  const [intPart, decPart = ''] = amountStr.split('.')
  const paddedDec = decPart.padEnd(decimals, '0').slice(0, decimals)
  return BigInt(intPart + paddedDec)
}

/**
 * Add/remove token from favorites
 */
export async function toggleFavoriteToken(
  accountId: number,
  tokenId: number
): Promise<boolean> {
  const database = getDatabase()

  try {
    // Check if already favorite
    const existing = await database.select<IdCheckRow[]>(
      'SELECT id FROM favorite_tokens WHERE account_id = $1 AND token_id = $2',
      [accountId, tokenId]
    )

    if (existing.length > 0) {
      await database.execute(
        'DELETE FROM favorite_tokens WHERE account_id = $1 AND token_id = $2',
        [accountId, tokenId]
      )
      return false // Removed from favorites
    } else {
      await database.execute(
        'INSERT INTO favorite_tokens (account_id, token_id, created_at) VALUES ($1, $2, $3)',
        [accountId, tokenId, Date.now()]
      )
      return true // Added to favorites
    }
  } catch (e) {
    tokenLogger.warn('Failed to toggle favorite token', { accountId, tokenId, error: e })
    return false
  }
}

/**
 * Get favorite tokens for an account
 */
export async function getFavoriteTokens(accountId: number): Promise<Token[]> {
  const database = getDatabase()

  try {
    const rows = await database.select<TokenRow[]>(
      `SELECT t.*
       FROM favorite_tokens ft
       INNER JOIN tokens t ON ft.token_id = t.id
       WHERE ft.account_id = $1
       ORDER BY t.ticker ASC`,
      [accountId]
    )

    return rows.map(row => ({
      id: row.id,
      ticker: row.ticker,
      protocol: row.protocol as 'bsv20' | 'bsv21',
      contractTxid: row.contract_txid ?? undefined,
      name: row.name ?? undefined,
      decimals: row.decimals,
      totalSupply: row.total_supply ?? undefined,
      iconUrl: row.icon_url ?? undefined,
      verified: row.verified === 1,
      createdAt: row.created_at
    }))
  } catch (e) {
    tokenLogger.warn('Failed to get favorite tokens', { accountId, error: e })
    return []
  }
}

/**
 * Sync token balances for an account
 */
export async function syncTokenBalances(
  accountId: number,
  walletAddress: string,
  ordAddress: string
): Promise<TokenBalance[]> {
  // Fetch from both addresses
  const [walletBalances, ordBalances] = await Promise.all([
    fetchTokenBalances(walletAddress),
    fetchTokenBalances(ordAddress)
  ])

  // Combine balances
  const balanceMap = new Map<string, TokenBalance>()

  for (const balance of [...walletBalances, ...ordBalances]) {
    const key = `${balance.token.ticker}-${balance.token.protocol}`

    if (balanceMap.has(key)) {
      const existing = balanceMap.get(key)!
      existing.confirmed += balance.confirmed
      existing.pending += balance.pending
      existing.listed += balance.listed
      existing.total += balance.total
    } else {
      balanceMap.set(key, balance)
    }
  }

  const balances = Array.from(balanceMap.values())

  // Update token balances (INSERT OR REPLACE — idempotent, no transaction needed)
  const balancesToUpdate = balances.filter(b => b.token.id)
  for (const balance of balancesToUpdate) {
    await updateTokenBalance(
      accountId,
      balance.token.id!,
      balance.total.toString()
    )
  }

  return balances
}
