/**
 * History Sync — transaction history fetching and DB persistence
 *
 * Fetches transaction history from WhatsOnChain and stores it in the database.
 * Handles lock/unlock detection, ordinal transfer labeling, and amount calculation.
 */

import { getWocClient, type WocTransaction } from '../../infrastructure/api/wocClient'
import {
  upsertTransaction,
  addTransaction,
  getKnownTxids,
  updateTransactionStatus,
  getTransactionLabels,
  updateTransactionLabels,
  addUTXO,
  addLockIfNotExists,
  markLockUnlockedByTxid,
  getUtxoByOutpoint
} from '../database'
import { syncLogger } from '../logger'
import { btcToSatoshis } from '../../utils/satoshiConversion'
import { parseTimelockScript } from '../wallet/locks'
import { publicKeyToHash } from '../../domain/locks'
import { getLockingScript, isOurOutput, isOurOutputMulti } from './addressSync'

// ---------------------------------------------------------------------------
// Transaction detail cache — prevents redundant API calls for the same parent
// tx across multiple addresses within a single sync cycle.
// Cleared at the end of every syncWallet() call.
// ---------------------------------------------------------------------------
export const txDetailCache = new Map<string, WocTransaction>()

/** Clear the per-sync tx detail cache (call after each sync cycle). */
export function clearTxDetailCache(): void {
  txDetailCache.clear()
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
export async function calculateTxAmount(
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
 * @param accountId - Account ID for scoping data
 * @param allWalletAddresses - All wallet addresses for accurate input matching
 * @param walletPubKey - Wallet public key for lock detection
 */
export async function syncTransactionHistory(address: string, accountId?: number, allWalletAddresses?: string[], walletPubKey?: string): Promise<number> {
  const wocClient = getWocClient()

  // Fetch transaction history — no client-side limit: the API returns all txs
  // and each subsequent sync skips already-known txids, so only new ones are fetched.
  const historyResult = await wocClient.getTransactionHistorySafe(address)
  if (!historyResult.ok) {
    syncLogger.warn(`Failed to fetch tx history for ${address.slice(0,12)}...`, { error: historyResult.error })
    return 0
  }

  const history = historyResult.value
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
    let txLabel: 'lock' | 'unlock' | 'ordinal' | undefined
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

      // If not a lock/unlock, detect ordinal transfers: an input spending a 1-sat UTXO
      // signals an ordinal being transferred out. txDetailCache is already populated by
      // calculateTxAmount above — no extra API calls needed.
      if (!txLabel && amount !== undefined && amount < 0) {
        for (const vin of txDetails.vin) {
          if (!vin.txid || vin.vout === undefined) continue
          const parentTx = txDetailCache.get(vin.txid)
          const parentOut = parentTx?.vout?.[vin.vout]
          if (parentOut && parentOut.value === 1e-8) {
            const ordinalOrigin = `${vin.txid}_${vin.vout}`
            // Find the 1-sat output that received the ordinal (recipient)
            const recipientOut = txDetails.vout.find(v => Math.round(v.value * 1e8) === 1)
            const recipientAddr = recipientOut?.scriptPubKey?.addresses?.[0]
            txDescription = `Transferred ordinal ${ordinalOrigin} to ${recipientAddr ? recipientAddr.slice(0, 8) : 'unknown'}...`
            txLabel = 'ordinal'
            break
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
