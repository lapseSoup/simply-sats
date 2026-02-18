/**
 * BSV20 Token Service for Simply Sats
 *
 * Provides integration with GorillaPool for BSV20/BSV21 token indexing,
 * balance tracking, and token transfers.
 */

import { Transaction, PrivateKey, P2PKH, Script } from '@bsv/sdk'

// Opcodes for inscription scripts
const OP_FALSE = 0x00
const OP_IF = 0x63
const OP_ENDIF = 0x68
const OP_0 = 0x00
const OP_1 = 0x51
import { tokenLogger } from './logger'
import { ok, err, type Result } from '../domain/types'
import { getDatabase, withTransaction } from './database'
import { broadcastTransaction, calculateTxFee, type UTXO } from './wallet'
import { gpOrdinalsApi } from '../infrastructure/api/clients'
import type { TokenRow, TokenBalanceRow, TokenTransferRow, IdCheckRow, SqlParams } from '../infrastructure/database/row-types'


// Token metadata type
export interface Token {
  id?: number
  ticker: string
  protocol: 'bsv20' | 'bsv21'
  contractTxid?: string
  name?: string
  decimals: number
  totalSupply?: string
  iconUrl?: string
  verified: boolean
  createdAt: number
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

// Token balance type
export interface TokenBalance {
  token: Token
  confirmed: bigint
  pending: bigint
  listed: bigint
  total: bigint
}

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

    // Batch all token upserts in a single transaction to avoid N+1 queries
    const tokens: Token[] = await withTransaction(async () => {
      const results: Token[] = []
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
        results.push(token)
      }
      return results
    })

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
 * Get token UTXOs for a specific token
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

// ============================================
// Database Operations
// ============================================

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

  // Batch all balance updates in a single transaction
  const balancesToUpdate = balances.filter(b => b.token.id)
  if (balancesToUpdate.length > 0) {
    await withTransaction(async () => {
      for (const balance of balancesToUpdate) {
        await updateTokenBalance(
          accountId,
          balance.token.id!,
          balance.total.toString()
        )
      }
    })
  }

  return balances
}

// ============================================
// Token Transfer Operations
// ============================================

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
 * Create a BSV-20 transfer inscription script
 *
 * Format: OP_FALSE OP_IF "ord" <1> <content-type> OP_0 <content> OP_ENDIF
 * Content: {"p":"bsv-20","op":"transfer","tick":"TOKEN","amt":"AMOUNT"}
 */
function createBsv20TransferInscription(ticker: string, amount: string): Script {
  const contentType = Array.from(new TextEncoder().encode('application/bsv-20'))
  const content = Array.from(new TextEncoder().encode(JSON.stringify({
    p: 'bsv-20',
    op: 'transfer',
    tick: ticker,
    amt: amount
  })))
  const ordMarker = Array.from(new TextEncoder().encode('ord'))

  // Build inscription script: OP_FALSE OP_IF "ord" <1> <content-type> OP_0 <content> OP_ENDIF
  const script = new Script()

  // OP_FALSE OP_IF
  script.writeOpCode(OP_FALSE)
  script.writeOpCode(OP_IF)

  // "ord" marker
  script.writeBin(ordMarker)

  // Push 1 (content-type tag)
  script.writeOpCode(OP_1)

  // Push content type
  script.writeBin(contentType)

  // OP_0 (content tag)
  script.writeOpCode(OP_0)

  // Push content
  script.writeBin(content)

  // OP_ENDIF
  script.writeOpCode(OP_ENDIF)

  return script
}

/**
 * Create a BSV-21 transfer inscription script
 *
 * Format: {"p":"bsv-20","op":"transfer","id":"CONTRACT_ID","amt":"AMOUNT"}
 */
function createBsv21TransferInscription(contractId: string, amount: string): Script {
  const contentType = Array.from(new TextEncoder().encode('application/bsv-20'))
  const content = Array.from(new TextEncoder().encode(JSON.stringify({
    p: 'bsv-20',
    op: 'transfer',
    id: contractId,
    amt: amount
  })))
  const ordMarker = Array.from(new TextEncoder().encode('ord'))

  const script = new Script()
  script.writeOpCode(OP_FALSE)
  script.writeOpCode(OP_IF)
  script.writeBin(ordMarker)
  script.writeOpCode(OP_1)
  script.writeBin(contentType)
  script.writeOpCode(OP_0)
  script.writeBin(content)
  script.writeOpCode(OP_ENDIF)

  return script
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

/**
 * Transfer BSV20/BSV21 tokens to another address
 *
 * @param tokenWif - Private key WIF for the token-holding address
 * @param tokenUtxos - Token UTXOs to spend
 * @param ticker - Token ticker (BSV20) or contract ID (BSV21)
 * @param protocol - Token protocol (bsv20 or bsv21)
 * @param amount - Amount to send (as string to handle bigint)
 * @param toAddress - Recipient address
 * @param fundingWif - Private key WIF for funding (for the fee)
 * @param fundingUtxos - UTXOs to use for paying the fee
 * @param changeAddress - Address for change (both token change and BSV change)
 * @returns Transaction ID
 */
export async function transferToken(
  tokenWif: string,
  tokenUtxos: TokenUTXO[],
  ticker: string,
  protocol: 'bsv20' | 'bsv21',
  amount: string,
  toAddress: string,
  fundingWif: string,
  fundingUtxos: UTXO[],
  changeAddress: string
): Promise<Result<{ txid: string }, string>> {
  try {
    const tokenPrivateKey = PrivateKey.fromWif(tokenWif)
    const tokenPublicKey = tokenPrivateKey.toPublicKey()
    const tokenFromAddress = tokenPublicKey.toAddress()
    const tokenSourceLockingScript = new P2PKH().lock(tokenFromAddress)

    const fundingPrivateKey = PrivateKey.fromWif(fundingWif)
    const fundingPublicKey = fundingPrivateKey.toPublicKey()
    const fundingFromAddress = fundingPublicKey.toAddress()
    const fundingSourceLockingScript = new P2PKH().lock(fundingFromAddress)

    // Calculate total tokens available
    let totalTokensAvailable = BigInt(0)
    for (const utxo of tokenUtxos) {
      totalTokensAvailable += BigInt(utxo.amt)
    }

    const amountToSend = BigInt(amount)

    if (amountToSend > totalTokensAvailable) {
      return err(`Insufficient token balance. Have ${totalTokensAvailable}, need ${amountToSend}`)
    }

    const tx = new Transaction()

    // Add token inputs
    let tokensAdded = BigInt(0)
    const tokenInputsUsed: TokenUTXO[] = []

    for (const utxo of tokenUtxos) {
      if (tokensAdded >= amountToSend) break

      tx.addInput({
        sourceTXID: utxo.txid,
        sourceOutputIndex: utxo.vout,
        unlockingScriptTemplate: new P2PKH().unlock(
          tokenPrivateKey,
          'all',
          false,
          utxo.satoshis,
          tokenSourceLockingScript
        ),
        sequence: 0xffffffff
      })

      tokensAdded += BigInt(utxo.amt)
      tokenInputsUsed.push(utxo)
    }

    // Calculate fee
    const numOutputs = (tokensAdded > amountToSend) ? 3 : 2 // recipient + (token change?) + BSV change
    const numFundingInputs = Math.min(fundingUtxos.length, 2)
    const estimatedFee = calculateTxFee(tokenInputsUsed.length + numFundingInputs, numOutputs)

    // Select funding UTXOs
    const fundingToUse: UTXO[] = []
    let totalFunding = 0

    for (const utxo of fundingUtxos) {
      fundingToUse.push(utxo)
      totalFunding += utxo.satoshis

      if (totalFunding >= estimatedFee + 100) break
    }

    if (totalFunding < estimatedFee) {
      return err(`Insufficient BSV for fee (need ~${estimatedFee} sats)`)
    }

    // Add funding inputs
    for (const utxo of fundingToUse) {
      tx.addInput({
        sourceTXID: utxo.txid,
        sourceOutputIndex: utxo.vout,
        unlockingScriptTemplate: new P2PKH().unlock(
          fundingPrivateKey,
          'all',
          false,
          utxo.satoshis,
          fundingSourceLockingScript
        ),
        sequence: 0xffffffff
      })
    }

    // Create inscription script for recipient
    const recipientInscription = protocol === 'bsv21'
      ? createBsv21TransferInscription(ticker, amount)
      : createBsv20TransferInscription(ticker, amount)

    // Build recipient output script: inscription + P2PKH
    const recipientP2PKH = new P2PKH().lock(toAddress)
    const recipientScript = Script.fromBinary([
      ...recipientInscription.toBinary(),
      ...recipientP2PKH.toBinary()
    ])

    // Add recipient output (1 sat for the inscription)
    tx.addOutput({
      lockingScript: recipientScript,
      satoshis: 1
    })

    // Add token change output if there's leftover tokens
    const tokenChange = tokensAdded - amountToSend
    if (tokenChange > 0n) {
      const changeInscription = protocol === 'bsv21'
        ? createBsv21TransferInscription(ticker, tokenChange.toString())
        : createBsv20TransferInscription(ticker, tokenChange.toString())

      const changeP2PKH = new P2PKH().lock(changeAddress)
      const changeScript = Script.fromBinary([
        ...changeInscription.toBinary(),
        ...changeP2PKH.toBinary()
      ])

      tx.addOutput({
        lockingScript: changeScript,
        satoshis: 1
      })
    }

    // Calculate BSV change
    let totalInput = totalFunding
    for (const utxo of tokenInputsUsed) {
      totalInput += utxo.satoshis
    }

    const outputSats = 1 + (tokenChange > 0n ? 1 : 0) // recipient + optional token change
    const actualFee = calculateTxFee(tokenInputsUsed.length + fundingToUse.length, numOutputs)
    const bsvChange = totalInput - outputSats - actualFee

    // Add BSV change output
    if (bsvChange > 0) {
      tx.addOutput({
        lockingScript: new P2PKH().lock(fundingFromAddress),
        satoshis: bsvChange
      })
    }

    await tx.sign()
    const txid = await broadcastTransaction(tx)

    tokenLogger.info('Token transfer completed', { amount, ticker, toAddress, txid })

    return ok({ txid })
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Token transfer failed'
    tokenLogger.error('Transfer error', e)
    return err(errorMsg)
  }
}

/**
 * Simple token send function that handles UTXO selection
 */
export async function sendToken(
  walletAddress: string,
  ordAddress: string,
  walletWif: string,
  ordWif: string,
  fundingUtxos: UTXO[],
  ticker: string,
  protocol: 'bsv20' | 'bsv21',
  amount: string,
  toAddress: string
): Promise<Result<{ txid: string }, string>> {
  try {
    // Fetch token UTXOs from both addresses
    const [walletTokenUtxos, ordTokenUtxos] = await Promise.all([
      getTokenUtxosForSend(walletAddress, protocol === 'bsv21' ? ticker : ticker, protocol),
      getTokenUtxosForSend(ordAddress, protocol === 'bsv21' ? ticker : ticker, protocol)
    ])

    // Combine and sort by amount (largest first for efficient selection)
    const allTokenUtxos = [...walletTokenUtxos, ...ordTokenUtxos]
      .sort((a, b) => Number(BigInt(b.amt) - BigInt(a.amt)))

    if (allTokenUtxos.length === 0) {
      return err('No token UTXOs found')
    }

    // Determine which WIF to use based on where tokens are
    // Use the address that has the most tokens
    const walletTotal = walletTokenUtxos.reduce((sum, u) => sum + BigInt(u.amt), 0n)
    const ordTotal = ordTokenUtxos.reduce((sum, u) => sum + BigInt(u.amt), 0n)

    const useOrdWallet = ordTotal > walletTotal
    const tokenWif = useOrdWallet ? ordWif : walletWif
    const changeAddress = useOrdWallet ? ordAddress : walletAddress

    // Filter UTXOs to match the selected wallet
    const tokenUtxos = useOrdWallet ? ordTokenUtxos : walletTokenUtxos

    if (tokenUtxos.length === 0) {
      // Fall back to other wallet if primary has no UTXOs
      const fallbackUtxos = useOrdWallet ? walletTokenUtxos : ordTokenUtxos
      const fallbackWif = useOrdWallet ? walletWif : ordWif
      const fallbackChange = useOrdWallet ? walletAddress : ordAddress

      return transferToken(
        fallbackWif,
        fallbackUtxos,
        ticker,
        protocol,
        amount,
        toAddress,
        walletWif,
        fundingUtxos,
        fallbackChange
      )
    }

    return transferToken(
      tokenWif,
      tokenUtxos,
      ticker,
      protocol,
      amount,
      toAddress,
      walletWif,
      fundingUtxos,
      changeAddress
    )
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Token send failed'
    tokenLogger.error('Send error', e)
    return err(errorMsg)
  }
}
