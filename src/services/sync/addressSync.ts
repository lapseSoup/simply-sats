/**
 * Address Sync — address discovery and derived address syncing
 *
 * Handles syncing individual addresses: fetching UTXOs from WoC,
 * reconciling with the local database, and marking spent UTXOs.
 */

import { P2PKH } from '@bsv/sdk'
import { BASKETS } from '../../domain/types'
import {
  addUTXO,
  markUTXOSpent,
  getSpendableUTXOs,
  getPendingTransactionTxids,
  updateSyncState,
  type UTXO as DBUtxo
} from '../database'
import { getWocClient } from '../../infrastructure/api/wocClient'
import { syncLogger } from '../logger'

import type { AddressInfo, SyncResult } from './types'

// Simple counter for debugging sync order
let syncCounter = 0

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
export function getLockingScript(address: string): string {
  return new P2PKH().lock(address).toHex()
}

/**
 * Check if a transaction output belongs to a specific address.
 * Prefers the `addresses` array from WoC (faster, clearer), falls back to script hex comparison.
 */
export function isOurOutput(
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
export function isOurOutputMulti(
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
 * Fetch current blockchain height using infrastructure layer
 */
export async function getCurrentBlockHeight(): Promise<number> {
  return getWocClient().getBlockHeight()
}

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

  // If API call failed, skip this address entirely to avoid marking UTXOs as spent.
  // Return totalBalance: -1 as a sentinel so callers know to exclude this from balance sums.
  if (wocUtxos === null) {
    syncLogger.warn(`[SYNC #${syncId}] SKIPPED: ${address.slice(0,12)}... (API error — preserving existing UTXOs)`)
    return {
      address,
      basket,
      newUtxos: 0,
      spentUtxos: 0,
      totalBalance: -1
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
  // - If the address has transaction history -> sweep is legitimate, allow spend-marking
  // - If history check fails or returns empty -> assume API issue, preserve UTXOs
  if (wocUtxos.length === 0 && existingMap.size > 0) {
    const wocClient = getWocClient()
    const historyResult = await wocClient.getTransactionHistorySafe(address)

    if (!historyResult.ok || historyResult.value.length === 0) {
      // History check failed or returned empty — likely an API outage, keep existing UTXOs
      syncLogger.warn(
        `[SYNC #${syncId}] WoC returned 0 UTXOs but ${existingMap.size} exist locally for ${address.slice(0, 12)}... — skipping spend-marking (no tx history to confirm sweep)`
      )
      return { address, basket, newUtxos: 0, spentUtxos: 0, totalBalance: -1 }
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

  // Update sync state (scoped to account so stale records from other installs don't block re-sync)
  const currentHeight = await getCurrentBlockHeight()
  const syncStateResult = await updateSyncState(address, currentHeight, accountId)
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
