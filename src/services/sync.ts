/**
 * Sync Service for Simply Sats
 *
 * Fetches UTXOs from WhatsOnChain and populates the local database.
 * This bridges the gap between legacy wallet infrastructure and BRC-100
 * by maintaining a local cache of UTXOs that can be queried instantly.
 */

import { P2PKH } from '@bsv/sdk'
import {
  addUTXO,
  markUTXOSpent,
  getSpendableUTXOs,
  getLastSyncedHeight,
  updateSyncState,
  upsertTransaction,
  addTransaction,
  getDerivedAddresses as getDerivedAddressesFromDB,
  updateDerivedAddressSyncTime,
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend,
  getPendingUtxos,
  type UTXO as DBUtxo
} from './database'
import { RATE_LIMITS } from './config'
import { getWocClient, type WocTransaction } from '../infrastructure/api/wocClient'
import {
  type CancellationToken,
  startNewSync,
  cancelSync,
  isCancellationError,
  cancellableDelay,
  acquireSyncLock,
  isSyncInProgress
} from './cancellation'
import { syncLogger } from './logger'

// Re-export cancellation functions for external use
export { cancelSync, startNewSync, isSyncInProgress }

// Basket names for different address types
export const BASKETS = {
  DEFAULT: 'default',      // Main spending wallet
  ORDINALS: 'ordinals',    // Ordinal inscriptions
  IDENTITY: 'identity',    // BRC-100 identity key
  LOCKS: 'locks',          // Time-locked outputs
  WROOTZ_LOCKS: 'wrootz_locks', // Time-locked outputs created via Wrootz app
  DERIVED: 'derived'       // Received via derived addresses (BRC-42/43)
} as const

// Address info for syncing
export interface AddressInfo {
  address: string
  basket: string
  wif?: string // Optional - for signing
}


// Sync result
export interface SyncResult {
  address: string
  basket: string
  newUtxos: number
  spentUtxos: number
  totalBalance: number
}

/**
 * Fetch current blockchain height using infrastructure layer
 */
export async function getCurrentBlockHeight(): Promise<number> {
  return getWocClient().getBlockHeight()
}

/**
 * Fetch UTXOs for an address using infrastructure layer
 * Returns UTXOs in the format needed by the sync logic
 */
async function fetchUtxosFromWoc(address: string): Promise<{ txid: string; vout: number; satoshis: number }[]> {
  // WocClient handles timeout, retry, and error handling internally
  // It returns empty array on errors for backward compatibility
  const utxos = await getWocClient().getUtxos(address)
  // Map to the format needed by sync logic (already compatible)
  return utxos.map(u => ({
    txid: u.txid,
    vout: u.vout,
    satoshis: u.satoshis
  }))
}

/**
 * Generate P2PKH locking script for an address
 */
function getLockingScript(address: string): string {
  return new P2PKH().lock(address).toHex()
}

// Simple counter for debugging sync order
let syncCounter = 0

/**
 * Sync a single address - fetches UTXOs and updates the database
 * Now uses address field for precise tracking (no more locking script matching)
 */
export async function syncAddress(addressInfo: AddressInfo): Promise<SyncResult> {
  const { address, basket } = addressInfo
  const syncId = ++syncCounter

  syncLogger.debug(`[SYNC #${syncId}] START: ${address.slice(0,12)}... (basket: ${basket})`)

  // Generate locking script for this specific address
  const lockingScript = getLockingScript(address)

  // Fetch current UTXOs from WhatsOnChain
  const wocUtxos = await fetchUtxosFromWoc(address)
  syncLogger.debug(`[SYNC] Found ${wocUtxos.length} UTXOs on-chain for ${address.slice(0,12)}...`)

  // Get existing spendable UTXOs from database FOR THIS SPECIFIC ADDRESS
  const existingUtxos = await getSpendableUTXOs()
  const existingMap = new Map<string, DBUtxo>()
  for (const utxo of existingUtxos) {
    // Match by address field (new way) OR locking script (fallback for old records)
    if (utxo.address === address || utxo.lockingScript === lockingScript) {
      existingMap.set(`${utxo.txid}:${utxo.vout}`, utxo)
    }
  }

  // Build set of current UTXOs from WoC
  const currentUtxoKeys = new Set<string>()
  for (const u of wocUtxos) {
    currentUtxoKeys.add(`${u.txid}:${u.vout}`)
  }

  let newUtxos = 0
  let spentUtxos = 0
  let totalBalance = 0

  // Add new UTXOs (with address field!)
  for (const wocUtxo of wocUtxos) {
    const key = `${wocUtxo.txid}:${wocUtxo.vout}`
    totalBalance += wocUtxo.satoshis

    if (!existingMap.has(key)) {
      // New UTXO - add to database with address
      syncLogger.debug(`[SYNC] Adding UTXO: ${wocUtxo.txid.slice(0,8)}:${wocUtxo.vout} = ${wocUtxo.satoshis} sats`)
      await addUTXO({
        txid: wocUtxo.txid,
        vout: wocUtxo.vout,
        satoshis: wocUtxo.satoshis,
        lockingScript,
        address,  // Store the address!
        basket,
        spendable: true,
        createdAt: Date.now(),
        tags: basket === BASKETS.ORDINALS && wocUtxo.satoshis === 1 ? ['ordinal'] : []
      })
      newUtxos++
    }
  }

  // Mark spent UTXOs - only for UTXOs belonging to THIS address
  for (const [key, utxo] of existingMap) {
    if (!currentUtxoKeys.has(key)) {
      // UTXO no longer exists at this address - mark as spent
      syncLogger.debug(`[SYNC] Marking spent: ${key}`)
      await markUTXOSpent(utxo.txid, utxo.vout, 'unknown')
      spentUtxos++
    }
  }

  // Update sync state
  const currentHeight = await getCurrentBlockHeight()
  await updateSyncState(address, currentHeight)

  syncLogger.debug(`[SYNC #${syncId}] DONE: ${newUtxos} new, ${spentUtxos} spent, ${totalBalance} sats`)

  return {
    address,
    basket,
    newUtxos,
    spentUtxos,
    totalBalance
  }
}

/**
 * Calculate the amount change for an address from a transaction
 * Positive = received, Negative = sent
 */
function calculateTxAmount(tx: WocTransaction, address: string): number {
  const lockingScript = getLockingScript(address)
  let received = 0

  // Check outputs - did we receive any sats?
  for (const vout of tx.vout) {
    if (vout.scriptPubKey.hex === lockingScript) {
      // This output goes to our address
      received += Math.round(vout.value * 100000000) // Convert BSV to sats
    }
  }

  // Note: To calculate sent amount, we'd need to fetch parent transactions
  // to determine input values. For now, we only track received amounts.
  // The full calculation would require fetching input transactions
  // which is expensive. For received transactions, this is sufficient.
  return received
}

/**
 * Sync transaction history for an address
 * Fetches from WhatsOnChain and stores in database
 */
async function syncTransactionHistory(address: string, limit: number = 50): Promise<number> {
  const wocClient = getWocClient()

  // Fetch transaction history
  const historyResult = await wocClient.getTransactionHistorySafe(address)
  if (!historyResult.success) {
    syncLogger.warn(`Failed to fetch tx history for ${address.slice(0,12)}...`, { error: historyResult.error })
    return 0
  }

  const history = historyResult.data.slice(0, limit)
  let newTxCount = 0

  for (const txRef of history) {
    // Get transaction details to calculate amount
    const txDetails = await wocClient.getTransactionDetails(txRef.tx_hash)

    let amount: number | undefined
    if (txDetails) {
      amount = calculateTxAmount(txDetails, address)
    }

    // Store in database (addTransaction won't overwrite existing)
    try {
      await addTransaction({
        txid: txRef.tx_hash,
        createdAt: Date.now(),
        blockHeight: txRef.height > 0 ? txRef.height : undefined,
        status: txRef.height > 0 ? 'confirmed' : 'pending',
        amount
      })
      newTxCount++
    } catch (_e) {
      // Ignore duplicates
      syncLogger.debug(`Tx ${txRef.tx_hash.slice(0,8)} already exists in database`)
    }
  }

  syncLogger.debug(`[TX HISTORY] Synced ${newTxCount} transactions for ${address.slice(0,12)}...`)
  return newTxCount
}

/**
 * Sync all wallet addresses
 * @param addresses - List of addresses to sync
 * @param token - Optional cancellation token to abort the sync
 */
export async function syncAllAddresses(
  addresses: AddressInfo[],
  token?: CancellationToken
): Promise<SyncResult[]> {
  const results: SyncResult[] = []

  for (let i = 0; i < addresses.length; i++) {
    // Check for cancellation before each address
    if (token?.isCancelled) {
      syncLogger.debug('[SYNC] Cancelled - stopping address sync')
      break
    }

    const addr = addresses[i]
    try {
      // Add delay between requests to avoid rate limiting (429 errors)
      // Use configurable delay from config
      if (i > 0) {
        if (token) {
          await cancellableDelay(RATE_LIMITS.addressSyncDelay, token)
        } else {
          await new Promise(resolve => setTimeout(resolve, RATE_LIMITS.addressSyncDelay))
        }
      }
      const result = await syncAddress(addr)
      results.push(result)
      syncLogger.info(`Synced ${addr.basket}: ${result.newUtxos} new, ${result.spentUtxos} spent, ${result.totalBalance} sats`)
    } catch (error) {
      if (isCancellationError(error)) {
        syncLogger.debug('[SYNC] Cancelled during address sync')
        break
      }
      syncLogger.error(`Failed to sync ${addr.address}:`, error)
      // Continue with other addresses
    }
  }

  return results
}

/**
 * Full wallet sync - syncs all three address types plus derived addresses
 * Automatically cancels any previous sync in progress
 * @param walletAddress - Main wallet address
 * @param ordAddress - Ordinals address
 * @param identityAddress - Identity address
 * @returns Object with total balance and sync results, or undefined if cancelled
 */
export async function syncWallet(
  walletAddress: string,
  ordAddress: string,
  identityAddress: string
): Promise<{ total: number; results: SyncResult[] } | undefined> {
  // Acquire sync lock to prevent database race conditions
  // This ensures only one sync runs at a time
  const releaseLock = await acquireSyncLock()

  // Start new sync (cancels any previous sync)
  const token = startNewSync()

  try {
    // Sync derived addresses FIRST (most important for correct balance)
    const derivedAddresses = await getDerivedAddressesFromDB()
    syncLogger.debug(`[SYNC] Found ${derivedAddresses.length} derived addresses in database`)

    if (token.isCancelled) {
      syncLogger.debug('[SYNC] Cancelled before starting')
      return undefined
    }

    const addresses: AddressInfo[] = []

    // Add derived addresses first (priority)
    for (const derived of derivedAddresses) {
      syncLogger.debug(`[SYNC] Adding derived address to sync (priority): ${derived.address}`)
      addresses.push({
        address: derived.address,
        basket: BASKETS.DERIVED,
        wif: derived.privateKeyWif
      })
    }

    // Then add main addresses
    addresses.push(
      { address: walletAddress, basket: BASKETS.DEFAULT },
      { address: ordAddress, basket: BASKETS.ORDINALS },
      { address: identityAddress, basket: BASKETS.IDENTITY }
    )

    syncLogger.debug(`[SYNC] Total addresses to sync: ${addresses.length}`)
    const results = await syncAllAddresses(addresses, token)

    if (token.isCancelled) {
      syncLogger.debug('[SYNC] Cancelled during sync')
      return undefined
    }

    // Sync transaction history for main addresses (not ordinals/identity to reduce API calls)
    // Include derived addresses since they receive payments
    const txHistoryAddresses = [walletAddress, ...derivedAddresses.map(d => d.address)]
    syncLogger.debug(`[SYNC] Syncing transaction history for ${txHistoryAddresses.length} addresses`)

    for (const addr of txHistoryAddresses) {
      if (token.isCancelled) break
      try {
        await syncTransactionHistory(addr, 30)
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, RATE_LIMITS.addressSyncDelay))
      } catch (e) {
        syncLogger.warn(`Failed to sync tx history for ${addr.slice(0,12)}...`, { error: String(e) })
      }
    }

    // Update sync timestamps for derived addresses
    for (const derived of derivedAddresses) {
      const result = results.find(r => r.address === derived.address)
      if (result) {
        await updateDerivedAddressSyncTime(derived.address)
      }
    }

    const total = results.reduce((sum, r) => sum + r.totalBalance, 0)

    return { total, results }
  } catch (error) {
    if (isCancellationError(error)) {
      syncLogger.debug('[SYNC] Wallet sync cancelled')
      return undefined
    }
    throw error
  } finally {
    // Always release the lock when done
    releaseLock()
  }
}

/**
 * Quick balance check - just sums current spendable UTXOs from database
 * Much faster than fetching from blockchain
 */
export async function getBalanceFromDatabase(basket?: string): Promise<number> {
  const utxos = await getSpendableUTXOs()

  if (basket) {
    const filtered = utxos.filter(u => u.basket === basket)
    const balance = filtered.reduce((sum, u) => sum + u.satoshis, 0)
    syncLogger.debug(`[BALANCE] getBalanceFromDatabase('${basket}'): ${filtered.length} UTXOs, ${balance} sats`)
    if (basket === 'derived' && filtered.length > 0) {
      syncLogger.debug('[BALANCE] Derived UTXOs', { utxos: filtered.map(u => ({ txid: u.txid.slice(0, 8), vout: u.vout, sats: u.satoshis, basket: u.basket })) })
    }
    return balance
  }

  return utxos.reduce((sum, u) => sum + u.satoshis, 0)
}

/**
 * Get UTXOs for spending from database
 * Returns UTXOs from the specified basket, sorted by value (smallest first for coin selection)
 */
export async function getSpendableUtxosFromDatabase(basket: string = BASKETS.DEFAULT): Promise<DBUtxo[]> {
  const allUtxos = await getSpendableUTXOs()
  return allUtxos
    .filter(u => u.basket === basket)
    .sort((a, b) => a.satoshis - b.satoshis)
}

/**
 * Get ordinals from the database (ordinals basket)
 * Returns ordinals that are stored in the database from syncing
 */
export async function getOrdinalsFromDatabase(): Promise<{ txid: string; vout: number; satoshis: number; origin: string }[]> {
  const allUtxos = await getSpendableUTXOs()
  const ordinalUtxos = allUtxos.filter(u => u.basket === BASKETS.ORDINALS)
  syncLogger.debug(`[Ordinals] Found ${ordinalUtxos.length} ordinals in database`)
  return ordinalUtxos.map(u => ({
    txid: u.txid,
    vout: u.vout,
    satoshis: u.satoshis,
    origin: `${u.txid}_${u.vout}`
  }))
}

/**
 * Record a transaction we sent
 */
export async function recordSentTransaction(
  txid: string,
  rawTx: string,
  description: string,
  labels: string[] = [],
  amount?: number
): Promise<void> {
  await upsertTransaction({
    txid,
    rawTx,
    description,
    createdAt: Date.now(),
    status: 'pending',
    labels,
    amount
  })
}

/**
 * Mark UTXOs as spent after sending a transaction
 */
export async function markUtxosSpent(
  utxos: { txid: string; vout: number }[],
  spendingTxid: string
): Promise<void> {
  for (const utxo of utxos) {
    await markUTXOSpent(utxo.txid, utxo.vout, spendingTxid)
  }
}

// Re-export pending spend functions from database for race condition prevention
export {
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend,
  getPendingUtxos
}

/**
 * Check if initial sync is needed
 */
export async function needsInitialSync(addresses: string[]): Promise<boolean> {
  for (const addr of addresses) {
    const lastHeight = await getLastSyncedHeight(addr)
    if (lastHeight === 0) {
      return true
    }
  }
  return false
}

/**
 * Restore wallet - full sync that rebuilds the database from blockchain
 * This is what happens when you restore from 12 words
 */
export async function restoreFromBlockchain(
  walletAddress: string,
  ordAddress: string,
  identityAddress: string
): Promise<{ total: number; results: SyncResult[] }> {
  syncLogger.info('Starting wallet restore from blockchain...')

  // Perform full sync
  const result = await syncWallet(walletAddress, ordAddress, identityAddress)

  syncLogger.info(`Restore complete: ${result?.total ?? 0} total satoshis found`)
  if (result) {
    syncLogger.debug('Results', { results: result.results })
  }

  return result!
}
