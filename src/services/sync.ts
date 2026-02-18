/**
 * Sync Service for Simply Sats
 *
 * Fetches UTXOs from WhatsOnChain and populates the local database.
 * This bridges the gap between legacy wallet infrastructure and BRC-100
 * by maintaining a local cache of UTXOs that can be queried instantly.
 */

import { P2PKH } from '@bsv/sdk'
import { BASKETS } from '../domain/types'
import type { LockedUTXO } from './wallet/types'
import type { DerivedAddress } from './database'
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
  getUtxoByOutpoint,
  getPendingTransactionTxids,
  type UTXO as DBUtxo,
  getTransactionLabels,
  updateTransactionLabels,
  getKnownTxids,
  updateTransactionStatus,
  addLockIfNotExists,
  markLockUnlockedByTxid,
  getAllTransactions,
  updateTransactionAmount
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
import { btcToSatoshis } from '../utils/satoshiConversion'
import { parseTimelockScript } from './wallet/locks'
import { publicKeyToHash } from '../domain/locks'

// Re-export cancellation functions for external use
export { cancelSync, startNewSync, isSyncInProgress }

/**
 * Sync health diagnostic results
 */
export interface SyncHealthResult {
  dbConnected: boolean
  apiReachable: boolean
  derivedAddressQuery: boolean
  utxoQuery: boolean
  errors: string[]
  timings: Record<string, number>
}

/**
 * Diagnose sync health by testing each component independently.
 * Useful for identifying the exact failure point on Windows.
 */
export async function diagnoseSyncHealth(accountId?: number): Promise<SyncHealthResult> {
  const errors: string[] = []
  const timings: Record<string, number> = {}
  let dbConnected = false
  let apiReachable = false
  let derivedAddressQuery = false
  let utxoQuery = false

  // Test 1: Database connectivity
  const dbStart = Date.now()
  try {
    const { getDatabase } = await import('./database')
    const db = getDatabase()
    await db.select('SELECT 1 as test')
    dbConnected = true
  } catch (e) {
    errors.push(`DB: ${e instanceof Error ? e.message : String(e)}`)
  }
  timings.db = Date.now() - dbStart

  // Test 2: WoC API reachability
  const apiStart = Date.now()
  try {
    const result = await getWocClient().getBlockHeightSafe()
    apiReachable = result.ok
    if (!result.ok) errors.push(`API: ${result.error.message}`)
  } catch (e) {
    errors.push(`API: ${e instanceof Error ? e.message : String(e)}`)
  }
  timings.api = Date.now() - apiStart

  // Test 3: Derived address query
  const derivedStart = Date.now()
  try {
    await getDerivedAddressesFromDB(accountId)
    derivedAddressQuery = true
  } catch (e) {
    errors.push(`DerivedAddr: ${e instanceof Error ? e.message : String(e)}`)
  }
  timings.derived = Date.now() - derivedStart

  // Test 4: UTXO query
  const utxoStart = Date.now()
  {
    const utxoResult = await getSpendableUTXOs(accountId)
    if (utxoResult.ok) {
      utxoQuery = true
    } else {
      errors.push(`UTXO: ${utxoResult.error.message}`)
    }
  }
  timings.utxo = Date.now() - utxoStart

  syncLogger.info('[DIAG] Sync health check', {
    dbConnected, apiReachable, derivedAddressQuery, utxoQuery,
    errors, timings
  })

  return { dbConnected, apiReachable, derivedAddressQuery, utxoQuery, errors, timings }
}

// Re-export BASKETS from domain/types (single source of truth)
export { BASKETS } from '../domain/types'

// Address info for syncing
export interface AddressInfo {
  address: string
  basket: string
  wif?: string // Optional - for signing
  accountId?: number // Account ID for scoping data
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
async function fetchUtxosFromWoc(address: string): Promise<{ txid: string; vout: number; satoshis: number }[] | null> {
  // Use Safe variant to distinguish "zero UTXOs" from "API error"
  // Returns null on error so callers can skip destructive operations (marking UTXOs spent)
  const result = await getWocClient().getUtxosSafe(address)
  if (!result.ok) {
    syncLogger.error(`[SYNC] WoC UTXO fetch failed for ${address.slice(0,12)}...: ${result.error.message}`)
    return null
  }
  return result.value.map(u => ({
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

// ---------------------------------------------------------------------------
// Batched concurrency helper
// ---------------------------------------------------------------------------

/**
 * Execute an async function over a list of items in batches with controlled
 * concurrency.  Uses `Promise.allSettled` so a single failure never aborts the
 * remaining items.
 *
 * @param items - Items to process
 * @param fn - Async function to apply to each item
 * @param concurrency - Maximum number of items processed at once
 * @param isCancelled - Optional cancellation predicate checked between batches
 */
async function batchWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
  isCancelled?: () => boolean
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = []
  const totalBatches = Math.ceil(items.length / concurrency)
  for (let i = 0; i < items.length; i += concurrency) {
    if (isCancelled?.()) break
    const batchNum = Math.floor(i / concurrency) + 1
    syncLogger.debug(`[SYNC] Batch ${batchNum}/${totalBatches} (items ${i + 1}–${Math.min(i + concurrency, items.length)})`)
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(batch.map(fn))
    results.push(...batchResults)
  }
  return results
}

// ---------------------------------------------------------------------------
// Transaction detail cache — prevents redundant API calls for the same parent
// tx across multiple addresses within a single sync cycle.
// Cleared at the end of every syncWallet() call.
// ---------------------------------------------------------------------------
const txDetailCache = new Map<string, WocTransaction>()

/** Clear the per-sync tx detail cache (call after each sync cycle). */
function clearTxDetailCache(): void {
  txDetailCache.clear()
}

// Simple counter for debugging sync order
let syncCounter = 0

/**
 * Sync a single address - fetches UTXOs and updates the database
 * Now uses address field for precise tracking (no more locking script matching)
 */
export async function syncAddress(addressInfo: AddressInfo): Promise<SyncResult> {
  const { address, basket, accountId } = addressInfo
  const syncId = ++syncCounter

  syncLogger.debug(`[SYNC #${syncId}] START: ${address.slice(0,12)}... (basket: ${basket})`)

  // Generate locking script for this specific address
  const lockingScript = getLockingScript(address)

  // Fetch current UTXOs from WhatsOnChain
  const wocUtxos = await fetchUtxosFromWoc(address)

  // If API call failed, skip this address entirely to avoid marking UTXOs as spent
  if (wocUtxos === null) {
    syncLogger.warn(`[SYNC #${syncId}] SKIPPED: ${address.slice(0,12)}... (API error — preserving existing UTXOs)`)
    return {
      address,
      basket,
      newUtxos: 0,
      spentUtxos: 0,
      totalBalance: 0
    }
  }

  syncLogger.debug(`[SYNC] Found ${wocUtxos.length} UTXOs on-chain for ${address.slice(0,12)}...`)

  // Get existing spendable UTXOs from database FOR THIS SPECIFIC ADDRESS AND ACCOUNT
  const spendableResult = await getSpendableUTXOs(accountId)
  if (!spendableResult.ok) {
    syncLogger.error(`[SYNC #${syncId}] Failed to query existing UTXOs from DB`, { error: spendableResult.error.message })
    throw spendableResult.error.toAppError()
  }
  const existingUtxos = spendableResult.value
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

  // Guard: If WoC returns zero UTXOs but we have local UTXOs for this address,
  // this could be an API issue (rate limit, temporary outage) OR a legitimate
  // sweep where all UTXOs were spent. Distinguish by checking tx history:
  // - If the address has transaction history → sweep is legitimate, allow spend-marking
  // - If history check fails or returns empty → assume API issue, preserve UTXOs
  if (wocUtxos.length === 0 && existingMap.size > 0) {
    const wocClient = getWocClient()
    const historyResult = await wocClient.getTransactionHistorySafe(address)

    if (!historyResult.ok || historyResult.value.length === 0) {
      // History check failed or returned empty — likely an API outage, keep existing UTXOs
      syncLogger.warn(
        `[SYNC #${syncId}] WoC returned 0 UTXOs but ${existingMap.size} exist locally for ${address.slice(0, 12)}... — skipping spend-marking (no tx history to confirm sweep)`
      )
      return { address, basket, newUtxos: 0, spentUtxos: 0, totalBalance: 0 }
    }

    // History returned successfully with entries — the address was genuinely swept
    syncLogger.info(
      `[SYNC #${syncId}] WoC returned 0 UTXOs for ${address.slice(0, 12)}... with ${historyResult.value.length} tx history entries — address was swept, proceeding with spend-marking`
    )
  }

  let newUtxos = 0
  let spentUtxos = 0
  let totalBalance = 0

  // Add new UTXOs (with address field!)
  for (const wocUtxo of wocUtxos) {
    const key = `${wocUtxo.txid}:${wocUtxo.vout}`
    totalBalance += wocUtxo.satoshis

    if (!existingMap.has(key)) {
      // New UTXO - add to database with address and account ID
      syncLogger.debug(`[SYNC] Adding UTXO: ${wocUtxo.txid.slice(0,8)}:${wocUtxo.vout} = ${wocUtxo.satoshis} sats (account=${accountId ?? 1})`)
      {
        const addResult = await addUTXO({
          txid: wocUtxo.txid,
          vout: wocUtxo.vout,
          satoshis: wocUtxo.satoshis,
          lockingScript,
          address,  // Store the address!
          basket,
          spendable: true,
          createdAt: Date.now(),
          tags: basket === BASKETS.ORDINALS && wocUtxo.satoshis === 1 ? ['ordinal'] : []
        }, accountId)
        if (!addResult.ok) {
          syncLogger.error(`[SYNC] Failed to add UTXO:`, { error: addResult.error.message })
        }
      }
      newUtxos++
    }
  }

  // Mark spent UTXOs - only for UTXOs belonging to THIS address
  // Protect change outputs from recently broadcast transactions: skip UTXOs whose
  // txid matches a pending (unconfirmed) transaction we recorded locally.
  // This replaces the old time-based grace period which was fragile.
  const pendingTxidsResult = await getPendingTransactionTxids(accountId)
  const pendingTxids = pendingTxidsResult.ok ? pendingTxidsResult.value : new Set<string>()
  if (!pendingTxidsResult.ok) {
    syncLogger.warn('[SYNC] Failed to get pending txids', { error: pendingTxidsResult.error.message })
  }
  for (const [key, utxo] of existingMap) {
    if (!currentUtxoKeys.has(key)) {
      // Skip UTXOs that are outputs of our own pending (unconfirmed) transactions —
      // the blockchain API hasn't indexed them yet but we know they exist
      if (pendingTxids.has(utxo.txid)) {
        syncLogger.debug(`[SYNC] Skipping UTXO from pending tx (${utxo.txid.slice(0, 8)}...): ${key}`)
        continue
      }
      // UTXO no longer exists at this address - mark as spent
      syncLogger.debug(`[SYNC] Marking spent: ${key}`)
      const markSpentResult = await markUTXOSpent(utxo.txid, utxo.vout, 'unknown', accountId)
      if (!markSpentResult.ok) {
        syncLogger.warn(`[SYNC] Failed to mark UTXO spent: ${key}`, { error: markSpentResult.error.message })
      }
      spentUtxos++
    }
  }

  // Update sync state
  const currentHeight = await getCurrentBlockHeight()
  const syncStateResult = await updateSyncState(address, currentHeight)
  if (!syncStateResult.ok) {
    syncLogger.warn(`[SYNC #${syncId}] Failed to update sync state`, { error: syncStateResult.error })
  }

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
 * Check if a transaction output belongs to a specific address.
 * Prefers the `addresses` array from WoC (faster, clearer), falls back to script hex comparison.
 */
function isOurOutput(
  vout: { scriptPubKey: { hex: string; addresses?: string[] } },
  address: string,
  lockingScriptHex: string
): boolean {
  if (vout.scriptPubKey.addresses?.length) {
    return vout.scriptPubKey.addresses.includes(address)
  }
  return vout.scriptPubKey.hex === lockingScriptHex
}

/**
 * Check if a transaction output belongs to any of our wallet addresses.
 * Prefers the `addresses` array, falls back to script hex comparison.
 */
function isOurOutputMulti(
  vout: { scriptPubKey: { hex: string; addresses?: string[] } },
  addressSet: Set<string>,
  lockingScriptSet: Set<string>
): boolean {
  if (vout.scriptPubKey.addresses?.length) {
    return vout.scriptPubKey.addresses.some(a => addressSet.has(a))
  }
  return lockingScriptSet.has(vout.scriptPubKey.hex)
}

/**
 * Calculate the net amount change for an address from a transaction
 * Positive = received, Negative = sent (including fee)
 *
 * Strategy: First try local UTXO DB (cheap), then fetch parent tx from API (reliable).
 * Spent UTXOs may not exist in the local DB after a fresh sync (only current UTXOs
 * are fetched from blockchain), so the API fallback is essential for accuracy.
 *
 * @param tx - Transaction details from WoC
 * @param primaryAddress - The address whose history we're syncing (used for received calculation)
 * @param allWalletAddresses - ALL wallet addresses (wallet, ord, identity, derived) to identify our inputs
 * @param accountId - Account ID for DB lookups
 */
async function calculateTxAmount(
  tx: WocTransaction,
  primaryAddress: string,
  allWalletAddresses: string[],
  accountId?: number
): Promise<number> {
  const primaryLockingScript = getLockingScript(primaryAddress)
  const allLockingScripts = new Set(allWalletAddresses.map(a => getLockingScript(a)))
  const wocClient = getWocClient()
  const allAddressSet = new Set(allWalletAddresses)
  let received = 0

  // Sum outputs going TO the primary address (the one whose history we're viewing)
  // Prefer address matching (faster, clearer) with script hex fallback
  for (const vout of tx.vout) {
    if (isOurOutput(vout, primaryAddress, primaryLockingScript)) {
      received += btcToSatoshis(vout.value)
    }
  }

  // Check if we spent any of our UTXOs in this transaction's inputs
  // Match against ALL wallet addresses (not just primary) to catch cross-address spends
  let spent = 0
  for (const vin of tx.vin) {
    if (vin.txid && vin.vout !== undefined) {
      // Try 1: Local UTXO DB lookup (fast, works for UTXOs we've seen before)
      const outpointResult = await getUtxoByOutpoint(vin.txid, vin.vout, accountId)
      if (outpointResult.ok && outpointResult.value !== null) {
        spent += outpointResult.value.satoshis
        continue
      } else if (!outpointResult.ok) {
        syncLogger.warn('[SYNC] DB error looking up outpoint', { txid: vin.txid, vout: vin.vout, error: outpointResult.error.message })
      }

      // Try 2: Fetch parent transaction from API (reliable, works after fresh sync)
      //         Use txDetailCache to avoid refetching the same parent tx
      try {
        let prevTx = txDetailCache.get(vin.txid) ?? null
        if (!prevTx) {
          prevTx = await wocClient.getTransactionDetails(vin.txid)
          if (prevTx) txDetailCache.set(vin.txid, prevTx)
        }
        if (prevTx?.vout?.[vin.vout]) {
          const prevOutput = prevTx.vout[vin.vout]!
          if (isOurOutputMulti(prevOutput, allAddressSet, allLockingScripts)) {
            spent += btcToSatoshis(prevOutput.value)
          }
        }
      } catch (e) {
        syncLogger.warn('Failed to fetch parent tx for amount calculation', {
          txid: vin.txid,
          error: String(e)
        })
      }
    }
  }

  return received - spent
}

/**
 * Sync transaction history for an address
 * Fetches from WhatsOnChain and stores in database
 * @param address - The address to sync
 * @param limit - Maximum transactions to sync
 * @param accountId - Account ID for scoping data
 */
async function syncTransactionHistory(address: string, limit: number = 50, accountId?: number, allWalletAddresses?: string[], walletPubKey?: string): Promise<number> {
  const wocClient = getWocClient()

  // Fetch transaction history
  const historyResult = await wocClient.getTransactionHistorySafe(address)
  if (!historyResult.ok) {
    syncLogger.warn(`Failed to fetch tx history for ${address.slice(0,12)}...`, { error: historyResult.error })
    return 0
  }

  const history = historyResult.value.slice(0, limit)
  let newTxCount = 0

  // Skip already-known transactions to avoid wasteful API calls
  const knownTxidsResult = await getKnownTxids(accountId)
  const knownTxids = knownTxidsResult.ok ? knownTxidsResult.value : new Set<string>()
  if (!knownTxidsResult.ok) {
    syncLogger.warn('[SYNC] Failed to get known txids', { error: knownTxidsResult.error.message })
  }
  const newHistory = history.filter(txRef => !knownTxids.has(txRef.tx_hash))
  syncLogger.debug('Incremental tx sync', {
    total: history.length,
    new: newHistory.length,
    skipped: history.length - newHistory.length
  })

  for (const txRef of newHistory) {
    // Get transaction details to calculate amount
    const txDetails = await wocClient.getTransactionDetails(txRef.tx_hash)

    let amount: number | undefined
    if (txDetails) {
      amount = await calculateTxAmount(txDetails, address, allWalletAddresses || [address], accountId)
    }

    // Check if this is a lock transaction (works for both active and spent locks)
    let txLabel: 'lock' | 'unlock' | undefined
    let txDescription: string | undefined
    let lockSats: number | undefined
    if (txDetails) {
      // Check outputs for timelock scripts (lock creation)
      for (const vout of txDetails.vout) {
        const parsed = parseTimelockScript(vout.scriptPubKey.hex)
        if (parsed) {
          lockSats = btcToSatoshis(vout.value)
          txDescription = `Locked ${lockSats.toLocaleString()} sats until block ${parsed.unlockBlock.toLocaleString()}`
          txLabel = 'lock'
          break
        }
      }

      // Persist detected lock to database (idempotent — safe for re-runs)
      if (txLabel === 'lock' && walletPubKey) {
        try {
          const expectedPkh = publicKeyToHash(walletPubKey)
          for (let i = 0; i < txDetails.vout.length; i++) {
            const lockVout = txDetails.vout[i]!
            const parsed = parseTimelockScript(lockVout.scriptPubKey.hex)
            if (!parsed || parsed.publicKeyHash !== expectedPkh) continue

            const addLockUtxoResult = await addUTXO({
              txid: txRef.tx_hash,
              vout: i,
              satoshis: btcToSatoshis(lockVout.value),
              lockingScript: lockVout.scriptPubKey.hex,
              basket: 'locks',
              spendable: false,
              createdAt: Date.now()
            }, accountId)
            if (!addLockUtxoResult.ok) {
              syncLogger.warn('[SYNC] Failed to persist lock UTXO', { txid: txRef.tx_hash, vout: i, error: addLockUtxoResult.error.message })
              continue
            }
            const utxoId = addLockUtxoResult.value

            await addLockIfNotExists({
              utxoId,
              unlockBlock: parsed.unlockBlock,
              lockBlock: txRef.height > 0 ? txRef.height : undefined,
              createdAt: Date.now()
            }, accountId)

            syncLogger.info('Persisted lock during sync', {
              txid: txRef.tx_hash, vout: i, unlockBlock: parsed.unlockBlock
            })

            // Check if this lock's UTXO has already been spent (i.e. already unlocked).
            // After a 12-word restore, we may detect lock creation before we see the unlock tx.
            // If the UTXO is spent, mark the lock as unlocked immediately.
            try {
              const spentResult = await wocClient.isOutputSpentSafe(txRef.tx_hash, i)
              if (spentResult.ok && spentResult.value !== null) {
                await markLockUnlockedByTxid(txRef.tx_hash, i, accountId)
                syncLogger.info('Lock already spent on-chain — marked as unlocked', {
                  txid: txRef.tx_hash, vout: i, spendingTxid: spentResult.value
                })
              }
            } catch (_spentErr) {
              // Best-effort — detectLockedUtxos will also check later
            }
            break
          }
        } catch (lockErr) {
          syncLogger.warn('Failed to persist lock during sync (non-fatal)', {
            txid: txRef.tx_hash, error: String(lockErr)
          })
        }
      }

      // If not a lock creation, check if this is an unlock (spending a timelock UTXO)
      // Uses locktime + sequence as sufficient signal — no parent tx fetch needed
      if (!txLabel && txDetails.locktime > 500000) {
        const hasNLockTimeInput = txDetails.vin.some(v => v.sequence === 4294967294)
        if (hasNLockTimeInput) {
          const totalOutput = txDetails.vout.reduce((sum, v) => {
            const sats = typeof v.value === 'number' && Number.isFinite(v.value)
              ? btcToSatoshis(v.value)
              : 0
            return sum + sats
          }, 0)
          txDescription = `Unlocked ${totalOutput.toLocaleString()} sats`
          txLabel = 'unlock'
          amount = totalOutput // Use actual received amount, not received-spent (which gives negative fee)
          // Mark the source lock(s) as unlocked in DB (prevents stale lock flash on restore)
          for (const vin of txDetails.vin) {
            if (vin.txid && vin.vout !== undefined) {
              try {
                await markLockUnlockedByTxid(vin.txid, vin.vout, accountId)
              } catch (_e) { /* best-effort — lock may not exist in DB yet */ }
            }
          }
        }
      }
    }

    // Store in database (addTransaction won't overwrite existing)
    {
      const addResult = await addTransaction({
        txid: txRef.tx_hash,
        createdAt: Date.now(),
        blockHeight: txRef.height > 0 ? txRef.height : undefined,
        status: txRef.height > 0 ? 'confirmed' : 'pending',
        amount: txLabel === 'lock' && lockSats && amount !== undefined && amount > 0 ? -lockSats : amount,
        description: txDescription
      }, accountId)
      if (addResult.ok) {
        newTxCount++
      } else {
        // Ignore duplicates — but still label transactions that already exist
        syncLogger.debug(`Tx ${txRef.tx_hash.slice(0,8)} already exists in database`)
      }
    }

    // Label lock/unlock transactions (idempotent — safe for both new and existing txs)
    if (txLabel && txDescription) {
      try {
        const labelsResult = await getTransactionLabels(txRef.tx_hash, accountId)
        const existingLabels = labelsResult.ok ? labelsResult.value : []
        if (!existingLabels.includes(txLabel)) {
          await updateTransactionLabels(txRef.tx_hash, [...existingLabels, txLabel], accountId)
        }
        // Update description and fix amount if needed (handles existing txs from prior sync)
        await upsertTransaction({
          txid: txRef.tx_hash,
          createdAt: Date.now(),
          blockHeight: txRef.height > 0 ? txRef.height : undefined,
          status: txRef.height > 0 ? 'confirmed' : 'pending',
          description: txDescription,
          ...(txLabel === 'lock' && lockSats && amount !== undefined && amount > 0 ? { amount: -lockSats } : {}),
          ...(txLabel === 'unlock' && amount !== undefined ? { amount } : {})
        }, accountId)
      } catch (_e) {
        // Best-effort: don't fail sync if labeling fails
      }
    }
  }

  // Update block heights for pending transactions that are now confirmed
  for (const txRef of history) {
    if (knownTxids.has(txRef.tx_hash) && txRef.height > 0) {
      const statusResult = await updateTransactionStatus(txRef.tx_hash, 'confirmed', txRef.height, accountId)
      if (!statusResult.ok) {
        syncLogger.debug('[SYNC] Failed to update tx status (non-fatal)', { txid: txRef.tx_hash, error: statusResult.error.message })
      }
    }
  }

  syncLogger.debug(`[TX HISTORY] Synced ${newTxCount} transactions for ${address.slice(0,12)}... (account=${accountId ?? 1})`)
  return newTxCount
}

/**
 * Sync all wallet addresses using batched concurrency.
 *
 * Addresses are processed in batches of `RATE_LIMITS.maxConcurrentRequests`
 * (default 3) with an inter-batch delay of `RATE_LIMITS.addressSyncDelay` to
 * stay within WoC rate limits.  Each batch uses `Promise.allSettled` so a
 * single address failure never aborts the rest.
 *
 * @param addresses - List of addresses to sync
 * @param token - Optional cancellation token to abort the sync
 */
export async function syncAllAddresses(
  addresses: AddressInfo[],
  token?: CancellationToken
): Promise<SyncResult[]> {
  const results: SyncResult[] = []
  const concurrency = RATE_LIMITS.maxConcurrentRequests

  const totalBatches = Math.ceil(addresses.length / concurrency)
  syncLogger.debug(`[SYNC] syncAllAddresses: ${addresses.length} addresses in ~${totalBatches} batches (concurrency=${concurrency})`)

  for (let i = 0; i < addresses.length; i += concurrency) {
    // Check for cancellation before each batch
    if (token?.isCancelled) {
      syncLogger.debug('[SYNC] Cancelled - stopping address sync')
      break
    }

    // Inter-batch delay (skip before the first batch)
    if (i > 0) {
      if (token) {
        await cancellableDelay(RATE_LIMITS.addressSyncDelay, token)
      } else {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMITS.addressSyncDelay))
      }
    }

    const batch = addresses.slice(i, i + concurrency)
    const batchNum = Math.floor(i / concurrency) + 1
    syncLogger.debug(`[SYNC] Batch ${batchNum}/${totalBatches}: syncing ${batch.map(a => a.address.slice(0, 8)).join(', ')}...`)

    const settled = await Promise.allSettled(
      batch.map(addr => syncAddress(addr))
    )

    for (let j = 0; j < settled.length; j++) {
      const outcome = settled[j]!
      const addr = batch[j]!
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value)
        syncLogger.info(`Synced ${addr.basket}: ${outcome.value.newUtxos} new, ${outcome.value.spentUtxos} spent, ${outcome.value.totalBalance} sats`)
      } else {
        if (isCancellationError(outcome.reason)) {
          syncLogger.debug('[SYNC] Cancelled during address sync')
          // Don't break here — other addresses in the batch may have completed
        } else {
          syncLogger.error(`Failed to sync ${addr.address}:`, outcome.reason)
        }
      }
    }
  }

  return results
}

/**
 * Backfill NULL transaction amounts.
 *
 * After a 12-word restore the sync may store transactions with amount=NULL when
 * the WoC API times out or rate-limits during the initial heavy sync burst.
 * This function re-fetches transaction details in batches and recalculates
 * amounts for any transactions that still have NULL amounts.
 *
 * Uses `getTransactionDetailsBatch` for efficient concurrent fetching and
 * the module-level `txDetailCache` to avoid redundant API calls.
 *
 * Safe to call repeatedly — only touches rows where amount IS NULL.
 */
async function backfillNullAmounts(
  allWalletAddresses: string[],
  accountId?: number
): Promise<number> {
  try {
    // Get all transactions for this account (up to 200 — covers typical restore)
    const allTxsResult = await getAllTransactions(200, accountId)
    if (!allTxsResult.ok) {
      syncLogger.warn('[BACKFILL] Failed to get transactions', { error: allTxsResult.error.message })
      return 0
    }
    const allTxs = allTxsResult.value
    const nullAmountTxs = allTxs.filter(tx => tx.amount === undefined || tx.amount === null)

    if (nullAmountTxs.length === 0) return 0

    syncLogger.info(`[BACKFILL] Found ${nullAmountTxs.length} transactions with NULL amounts, recalculating...`)

    const wocClient = getWocClient()
    const primaryAddress = allWalletAddresses[0]
    if (!primaryAddress) return 0

    // --- Batch-fetch all missing tx details in one go ---
    // Filter out txids that are already in the cache
    const txidsToFetch = nullAmountTxs
      .map(tx => tx.txid)
      .filter(txid => !txDetailCache.has(txid))

    if (txidsToFetch.length > 0) {
      syncLogger.debug(`[BACKFILL] Batch-fetching ${txidsToFetch.length} tx details (concurrency=${RATE_LIMITS.maxConcurrentRequests})`)
      const batchMap = await wocClient.getTransactionDetailsBatch(
        txidsToFetch,
        RATE_LIMITS.maxConcurrentRequests
      )
      // Merge into the module-level cache
      for (const [txid, detail] of batchMap) {
        txDetailCache.set(txid, detail)
      }
    }

    // --- Calculate amounts using cached details ---
    let fixed = 0
    const calcResults = await batchWithConcurrency(
      nullAmountTxs,
      async (tx) => {
        const txDetails = txDetailCache.get(tx.txid) ?? null
        if (!txDetails) {
          syncLogger.debug(`[BACKFILL] Could not fetch tx ${tx.txid.slice(0, 8)}... — skipping`)
          return null
        }
        const amount = await calculateTxAmount(txDetails, primaryAddress, allWalletAddresses, accountId)
        const amtResult = await updateTransactionAmount(tx.txid, amount, accountId)
        if (!amtResult.ok) {
          syncLogger.warn(`[BACKFILL] Failed to update amount for ${tx.txid.slice(0,8)}...`, { error: amtResult.error.message })
        }
        syncLogger.debug(`[BACKFILL] Fixed amount for ${tx.txid.slice(0, 8)}... → ${amount} sats`)
        return { txid: tx.txid, amount }
      },
      RATE_LIMITS.maxConcurrentRequests
    )

    for (const r of calcResults) {
      if (r.status === 'fulfilled' && r.value !== null) fixed++
    }

    syncLogger.info(`[BACKFILL] Fixed ${fixed}/${nullAmountTxs.length} transaction amounts`)
    return fixed
  } catch (e) {
    syncLogger.warn('[BACKFILL] backfillNullAmounts failed (non-fatal)', { error: String(e) })
    return 0
  }
}

/**
 * Full wallet sync - syncs all three address types plus derived addresses
 * Automatically cancels any previous sync in progress
 * @param walletAddress - Main wallet address
 * @param ordAddress - Ordinals address
 * @param identityAddress - Identity address
 * @param accountId - Account ID for scoping data (optional, defaults to 1)
 * @returns Object with total balance and sync results, or undefined if cancelled
 */
export async function syncWallet(
  walletAddress: string,
  ordAddress: string,
  identityAddress: string,
  accountId?: number,
  walletPubKey?: string
): Promise<{ total: number; results: SyncResult[] } | undefined> {
  // Acquire sync lock to prevent database race conditions
  // This ensures only one sync runs at a time
  const releaseLock = await acquireSyncLock(accountId ?? 1)

  // Start new sync (cancels any previous sync)
  const token = startNewSync()

  try {
    // Recover any UTXOs stuck in 'pending' state for more than 5 minutes
    // These can occur when a broadcast fails after marking UTXOs as pending
    try {
      const pendingResult = await getPendingUtxos(5 * 60 * 1000)
      if (!pendingResult.ok) {
        syncLogger.warn('[SYNC] Failed to query pending UTXOs', { error: pendingResult.error.message })
      } else if (pendingResult.value.length > 0) {
        syncLogger.warn(`[SYNC] Found ${pendingResult.value.length} stuck pending UTXOs — rolling back`)
        const rollbackResult = await rollbackPendingSpend(pendingResult.value.map(u => ({ txid: u.txid, vout: u.vout })))
        if (!rollbackResult.ok) {
          syncLogger.warn('[SYNC] Failed to rollback pending UTXOs', { error: rollbackResult.error.message })
        }
      }
    } catch (error) {
      syncLogger.warn('[SYNC] Failed to recover pending UTXOs', { error: String(error) })
    }

    // Sync derived addresses FIRST (most important for correct balance)
    let derivedAddresses: DerivedAddress[]
    try {
      derivedAddresses = await getDerivedAddressesFromDB(accountId)
    } catch (e) {
      syncLogger.error('[SYNC] DB query failed: getDerivedAddressesFromDB', e)
      throw new Error(`Database query failed (derived addresses): ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!Array.isArray(derivedAddresses)) {
      syncLogger.warn('[SYNC] getDerivedAddressesFromDB returned non-array, defaulting to empty', { type: typeof derivedAddresses })
      derivedAddresses = []
    }
    syncLogger.debug(`[SYNC] Found ${derivedAddresses.length} derived addresses in database`)

    if (token.isCancelled) {
      syncLogger.debug('[SYNC] Cancelled before starting')
      return undefined
    }

    const addresses: AddressInfo[] = []

    // Add derived addresses first (priority)
    // Note: the wif field in AddressInfo is not used during sync (syncAddress does
    // not sign anything). WIF re-derivation happens at spend time in useWalletSend /
    // getAllSpendableUTXOs. We intentionally omit it here to avoid routing key
    // material through the sync infrastructure (S-19).
    for (const derived of derivedAddresses) {
      syncLogger.debug(`[SYNC] Adding derived address to sync (priority): ${derived.address}`)
      addresses.push({
        address: derived.address,
        basket: BASKETS.DERIVED,
        accountId
      })
    }

    // Then add main addresses
    addresses.push(
      { address: walletAddress, basket: BASKETS.DEFAULT, accountId },
      { address: ordAddress, basket: BASKETS.ORDINALS, accountId },
      { address: identityAddress, basket: BASKETS.IDENTITY, accountId }
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
    // All wallet addresses for accurate input matching in calculateTxAmount
    const allWalletAddresses = [walletAddress, ordAddress, identityAddress, ...derivedAddresses.map(d => d.address)]
    syncLogger.debug(`[SYNC] Syncing transaction history for ${txHistoryAddresses.length} addresses (account=${accountId ?? 1})`)

    for (const addr of txHistoryAddresses) {
      if (token.isCancelled) break
      try {
        await syncTransactionHistory(addr, 30, accountId, allWalletAddresses, walletPubKey)
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, RATE_LIMITS.addressSyncDelay))
      } catch (e) {
        syncLogger.warn(`Failed to sync tx history for ${addr.slice(0,12)}...`, { error: String(e) })
      }
    }

    // Backfill any transactions that were stored with NULL amounts
    // (common after 12-word restore when API rate limits cause failures)
    if (!token.isCancelled) {
      await backfillNullAmounts(allWalletAddresses, accountId)
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
    // Always release the lock and clear per-sync caches when done
    clearTxDetailCache()
    releaseLock()
  }
}

/**
 * Quick balance check - just sums current spendable UTXOs from database
 * Much faster than fetching from blockchain
 * @param basket - Optional basket filter
 * @param accountId - Account ID to filter by (optional)
 */
export async function getBalanceFromDatabase(basket?: string, accountId?: number): Promise<number> {
  const utxosResult = await getSpendableUTXOs(accountId)
  if (!utxosResult.ok) {
    syncLogger.warn('[BALANCE] Failed to query spendable UTXOs', { error: utxosResult.error.message })
    return 0
  }
  const utxos = utxosResult.value

  if (basket) {
    const filtered = utxos.filter(u => u.basket === basket)
    const balance = filtered.reduce((sum, u) => sum + u.satoshis, 0)
    syncLogger.debug(`[BALANCE] getBalanceFromDatabase('${basket}', account=${accountId}): ${filtered.length} UTXOs, ${balance} sats`)
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
 * @param basket - The basket to filter by
 * @param accountId - Account ID to filter by (optional)
 */
export async function getSpendableUtxosFromDatabase(basket: string = BASKETS.DEFAULT, accountId?: number): Promise<DBUtxo[]> {
  const allUtxosResult = await getSpendableUTXOs(accountId)
  if (!allUtxosResult.ok) {
    syncLogger.warn('[DB] Failed to query spendable UTXOs', { error: allUtxosResult.error.message })
    return []
  }
  return allUtxosResult.value
    .filter(u => u.basket === basket)
    .sort((a, b) => a.satoshis - b.satoshis)
}

/**
 * Map database lock records to LockedUTXO format.
 * Used by WalletContext and SyncContext when preloading locks from DB.
 */
export function mapDbLocksToLockedUtxos(
  dbLocks: Awaited<ReturnType<typeof import('./database').getLocks>>,
  walletPubKey: string
): LockedUTXO[] {
  return dbLocks.map(lock => ({
    txid: lock.utxo.txid,
    vout: lock.utxo.vout,
    satoshis: lock.utxo.satoshis,
    lockingScript: lock.utxo.lockingScript,
    unlockBlock: lock.unlockBlock,
    publicKeyHex: walletPubKey,
    createdAt: lock.createdAt,
    lockBlock: lock.lockBlock
  }))
}

/**
 * Get ordinals from the database (ordinals basket)
 * Returns ordinals that are stored in the database from syncing
 * @param accountId - Account ID to filter by (optional)
 */
export async function getOrdinalsFromDatabase(accountId?: number): Promise<{ txid: string; vout: number; satoshis: number; origin: string }[]> {
  const allUtxosResult = await getSpendableUTXOs(accountId)
  if (!allUtxosResult.ok) {
    syncLogger.warn('[DB] Failed to query UTXOs for ordinals', { error: allUtxosResult.error.message })
    return []
  }
  const ordinalUtxos = allUtxosResult.value.filter(u => u.basket === BASKETS.ORDINALS)
  syncLogger.debug(`[Ordinals] Found ${ordinalUtxos.length} ordinals in database (account=${accountId})`)
  return ordinalUtxos.map(u => ({
    txid: u.txid,
    vout: u.vout,
    satoshis: u.satoshis,
    origin: `${u.txid}_${u.vout}`
  }))
}

/**
 * Record a transaction we sent
 * @param txid - Transaction ID
 * @param rawTx - Raw transaction hex
 * @param description - Transaction description
 * @param labels - Transaction labels
 * @param amount - Transaction amount in satoshis
 * @param accountId - Account ID for scoping data
 */
export async function recordSentTransaction(
  txid: string,
  rawTx: string,
  description: string,
  labels: string[] = [],
  amount?: number,
  accountId?: number
): Promise<void> {
  const result = await upsertTransaction({
    txid,
    rawTx,
    description,
    createdAt: Date.now(),
    status: 'pending',
    labels,
    amount
  }, accountId)
  if (!result.ok) {
    syncLogger.warn('recordSentTransaction: upsertTransaction failed', { txid, error: result.error.message })
  }
}

/**
 * Mark UTXOs as spent after sending a transaction
 */
export async function markUtxosSpent(
  utxos: { txid: string; vout: number }[],
  spendingTxid: string,
  accountId?: number
): Promise<void> {
  for (const utxo of utxos) {
    const markResult = await markUTXOSpent(utxo.txid, utxo.vout, spendingTxid, accountId)
    if (!markResult.ok) {
      syncLogger.warn('[DB] Failed to mark UTXO spent', { txid: utxo.txid, vout: utxo.vout, error: markResult.error.message })
    }
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
    const lastHeightResult = await getLastSyncedHeight(addr)
    const lastHeight = lastHeightResult.ok ? lastHeightResult.value : 0
    if (lastHeight === 0) {
      return true
    }
  }
  return false
}

/**
 * Restore wallet - full sync that rebuilds the database from blockchain
 * This is what happens when you restore from 12 words
 * @param walletAddress - Main wallet address
 * @param ordAddress - Ordinals address
 * @param identityAddress - Identity address
 * @param accountId - Account ID for scoping data
 */
export async function restoreFromBlockchain(
  walletAddress: string,
  ordAddress: string,
  identityAddress: string,
  accountId?: number,
  walletPubKey?: string
): Promise<{ total: number; results: SyncResult[] }> {
  syncLogger.info('Starting wallet restore from blockchain...')

  // Perform full sync
  const result = await syncWallet(walletAddress, ordAddress, identityAddress, accountId, walletPubKey)

  syncLogger.info(`Restore complete: ${result?.total ?? 0} total satoshis found`)
  if (result) {
    syncLogger.debug('Results', { results: result.results })
  }

  if (!result) {
    throw new Error('Wallet restore was cancelled')
  }
  return result
}
