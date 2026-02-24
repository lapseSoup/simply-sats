/**
 * Lock Queries — lock status queries and DB lookups
 *
 * Handles detecting locked UTXOs from transaction history,
 * checking UTXO spend status, and lock database queries.
 */

import { PublicKey } from '@bsv/sdk'
import type { LockedUTXO } from './types'
import { getTransactionHistory } from './balance'
import { getWocClient } from '../../infrastructure/api/wocClient'
import { btcToSatoshis } from '../../utils/satoshiConversion'
import { getDatabase } from '../database'
import { walletLogger } from '../logger'
import { parseTimelockScript } from './lockCreation'

/**
 * Check if a UTXO is still unspent
 */
async function isUtxoUnspent(txid: string, vout: number): Promise<boolean> {
  const woc = getWocClient()

  try {
    // Primary check: the direct spent endpoint (faster and more reliable)
    const spentResult = await woc.isOutputSpentSafe(txid, vout)

    if (spentResult.ok) {
      if (spentResult.value !== null) {
        walletLogger.debug('UTXO has been spent', { txid, vout, spendingTxid: spentResult.value })
        return false
      }
      // null means unspent
      return true
    }

    // API error — fall back to full tx lookup
    walletLogger.debug('Spent check failed, trying tx details', { txid, vout, error: spentResult.error.message })
    if (spentResult.error.status === 429) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // Fallback: Check the full transaction
    const txResult = await woc.getTransactionDetailsSafe(txid)
    if (!txResult.ok) {
      walletLogger.warn('Could not verify UTXO spend status, assuming unspent', { txid, vout, error: txResult.error.message })
      return true // Assume unspent on error — better to show a stale lock than lose one
    }

    const output = txResult.value.vout?.[vout]
    if (output && 'spent' in output && output.spent) {
      return false
    }

    return true
  } catch (error) {
    walletLogger.error('Error checking UTXO', error, { txid, vout })
    return true // Assume unspent on error — better to show a stale lock than lose one
  }
}

/**
 * Check if a lock has been marked as unlocked in the database
 */
async function isLockMarkedUnlocked(
  txid: string,
  vout: number,
  knownUnlockedLocks?: Set<string>
): Promise<boolean> {
  const lockKey = `${txid}:${vout}`
  if (knownUnlockedLocks?.has(lockKey)) {
    walletLogger.debug('Lock found in known-unlocked set', { lockKey })
    return true
  }

  try {
    const database = getDatabase()
    const result = await database.select<{ unlocked_at: number | null }[]>(
      `SELECT l.unlocked_at FROM locks l
       INNER JOIN utxos u ON l.utxo_id = u.id
       WHERE u.txid = $1 AND u.vout = $2`,
      [txid, vout]
    )
    const isUnlocked = result.length > 0 && result[0]!.unlocked_at !== null
    if (isUnlocked) {
      walletLogger.debug('Lock marked as unlocked in database', { lockKey })
    }
    return isUnlocked
  } catch (err) {
    walletLogger.warn('Error checking lock status', { lockKey, error: String(err) })
    return false
  }
}

/**
 * Scan transaction history to detect locked UTXOs
 * This is used during wallet restoration to reconstruct the locks list
 * @param knownUnlockedLocks - Set of "txid:vout" strings for locks that were just unlocked
 */
export async function detectLockedUtxos(
  walletAddress: string,
  publicKeyHex: string,
  knownUnlockedLocks?: Set<string>
): Promise<LockedUTXO[]> {
  walletLogger.info('Scanning transaction history for locked UTXOs')
  if (knownUnlockedLocks && knownUnlockedLocks.size > 0) {
    walletLogger.debug('Excluding known-unlocked locks', { count: knownUnlockedLocks.size })
  }

  const detectedLocks: LockedUTXO[] = []
  const seen = new Set<string>()

  try {
    // Get transaction history for the wallet address
    const history = await getTransactionHistory(walletAddress)

    if (!history || history.length === 0) {
      walletLogger.debug('No transaction history found')
      return []
    }

    walletLogger.debug('Checking transactions for locks', { count: history.length })

    // Calculate expected public key hash from the provided public key
    const publicKey = PublicKey.fromString(publicKeyHex)
    const expectedPkhBytes = publicKey.toHash() as number[]
    const expectedPkh = expectedPkhBytes.map(b => b.toString(16).padStart(2, '0')).join('')

    // Batch-fetch all transaction details to avoid N+1 sequential API calls
    const txids = [...new Set(history.map(h => h.tx_hash))]
    const wocClient = getWocClient()
    const txDetailsMap = await wocClient.getTransactionDetailsBatch(txids)

    walletLogger.debug('Batch-fetched transaction details', { requested: txids.length, received: txDetailsMap.size })

    // Process fetched transactions for timelock outputs
    for (const [txid, txDetails] of txDetailsMap) {
      if (!txDetails?.vout) continue

      // Check each output for timelock script
      for (let vout = 0; vout < txDetails.vout.length; vout++) {
        const output = txDetails.vout[vout]!
        const scriptHex = output.scriptPubKey?.hex

        if (!scriptHex) continue

        const parsed = parseTimelockScript(scriptHex)
        if (!parsed) continue

        // Verify the lock belongs to this wallet
        if (parsed.publicKeyHash !== expectedPkh) {
          walletLogger.debug('Found lock but PKH does not match (different wallet)')
          continue
        }

        // Check if marked as unlocked (in-memory set or database)
        const markedUnlocked = await isLockMarkedUnlocked(txid, vout, knownUnlockedLocks)
        if (markedUnlocked) {
          continue
        }

        // Check if still unspent on chain
        const unspent = await isUtxoUnspent(txid, vout)
        if (!unspent) {
          walletLogger.debug('Lock has been spent (unlocked)', { txid, vout })
          continue
        }

        // Deduplicate: WoC may return same txid in both mempool and confirmed history
        const dedupKey = `${txid}:${vout}`
        if (seen.has(dedupKey)) continue
        seen.add(dedupKey)

        const satoshis = btcToSatoshis(output!.value)

        walletLogger.info('Found active lock', { txid, vout, satoshis, unlockBlock: parsed.unlockBlock })

        detectedLocks.push({
          txid,
          vout,
          satoshis,
          lockingScript: scriptHex,
          unlockBlock: parsed.unlockBlock,
          publicKeyHex,
          createdAt: txDetails.time ? txDetails.time * 1000 : Date.now(),
          confirmationBlock: txDetails.blockheight || undefined,
          // Use confirmation block as lockBlock fallback for restore (best available data)
          lockBlock: txDetails.blockheight || undefined
        })
      }
    }

    walletLogger.info('Lock detection complete', { count: detectedLocks.length })
    return detectedLocks
  } catch (error) {
    walletLogger.error('Error detecting locked UTXOs', error)
    return []
  }
}
