/**
 * Ordinals operations
 * Fetching, scanning, and transferring 1Sat Ordinals
 */

import { PrivateKey, P2PKH, Transaction } from '@bsv/sdk'
import type { UTXO, Ordinal, GpOrdinalItem, OrdinalDetails } from './types'
import { gpOrdinalsApi } from '../../infrastructure/api/clients'
import { getWocClient } from '../../infrastructure/api/wocClient'
import { calculateTxFee } from './fees'
import { executeBroadcast } from './transactions'
import { getTransactionHistory, getTransactionDetails } from './balance'
import {
  recordSentTransaction,
  confirmUtxosSpent
} from '../sync'
import { walletLogger } from '../logger'
import {
  mapGpItemToOrdinal,
  filterOneSatOrdinals,
  isOrdinalInscriptionScript,
  extractPkhFromInscriptionScript,
  pkhMatches,
  extractContentTypeFromScript,
  isOneSatOutput,
  formatOrdinalOrigin
} from '../../domain/ordinals'

// Create a child logger for ordinals-specific logging
const ordLogger = walletLogger

/**
 * Get 1Sat Ordinals from the ordinals address
 * Uses the GorillaPool 1Sat Ordinals API for reliable inscription detection
 */
export async function getOrdinals(address: string): Promise<Ordinal[]> {
  try {
    // First, try the GorillaPool 1Sat Ordinals API for proper inscription data
    // Paginate to fetch ALL ordinals (API returns max 100 per request)
    const PAGE_SIZE = 100
    const MAX_PAGES = 10 // Safety cap: 1000 ordinals max
    const allGpItems: GpOrdinalItem[] = []
    let gpSuccess = false

    ordLogger.debug('Fetching ordinals from GorillaPool', { address })
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE
      const gpResult = await gpOrdinalsApi.get<GpOrdinalItem[]>(`/api/txos/address/${address}/unspent?limit=${PAGE_SIZE}&offset=${offset}`)
      ordLogger.debug('GorillaPool response', { ok: gpResult.ok, page, offset })

      if (!gpResult.ok) {
        ordLogger.debug('GorillaPool API error, falling back to WhatsOnChain', { error: gpResult.error.message })
        break
      }

      const gpData = gpResult.value
      if (!Array.isArray(gpData) || gpData.length === 0) {
        if (page === 0) {
          ordLogger.debug('GorillaPool returned empty array, falling back to WhatsOnChain', { address })
        }
        gpSuccess = page > 0 // Had results on earlier pages
        break
      }

      allGpItems.push(...gpData)
      gpSuccess = true
      ordLogger.debug('GorillaPool page fetched', { page, pageCount: gpData.length, totalSoFar: allGpItems.length })

      // Last page — fewer results than page size means no more data
      if (gpData.length < PAGE_SIZE) break
    }

    if (gpSuccess && allGpItems.length > 0) {
      // Filter for 1-sat UTXOs (actual ordinals) and those with origin set
      const oneSatItems = filterOneSatOrdinals(allGpItems)
      ordLogger.debug('Filtered ordinals', { totalUtxos: allGpItems.length, oneSatOrdinals: oneSatItems.length })

      if (oneSatItems.length > 0) {
        ordLogger.debug('First ordinal structure', { sample: oneSatItems[0] })

        const result = oneSatItems.map(mapGpItemToOrdinal)
        ordLogger.info('Returning ordinals', { count: result.length })
        return result
      }
      ordLogger.debug('No 1-sat ordinals found, falling back to WhatsOnChain')
    }

    // Fallback: Use WhatsOnChain to get 1-sat UTXOs, then verify each with GorillaPool
    ordLogger.debug('Using WhatsOnChain for ordinals detection')
    const wocUtxos = await getWocClient().getUtxosSafe(address)
    if (!wocUtxos.ok) {
      ordLogger.warn('Failed to fetch ordinals from WhatsOnChain', { address, error: wocUtxos.error.message })
      return []
    }
    // Map to the format the rest of the code expects
    const utxos = wocUtxos.value.map(u => ({ tx_hash: u.txid, tx_pos: u.vout, value: u.satoshis }))
    ordLogger.debug('WhatsOnChain returned UTXOs', { address, count: utxos.length })

    const ordinals: Ordinal[] = []

    for (const utxo of utxos) {
      // Check 1-sat UTXOs - these might be ordinals
      if (utxo.value === 1) {
        const origin = formatOrdinalOrigin(utxo.tx_hash, utxo.tx_pos)
        ordLogger.debug('Found 1-sat UTXO', { origin })

        // Try to get inscription details from GorillaPool
        try {
          const details = await getOrdinalDetails(origin)
          if (details && details.origin) {
            ordinals.push({
              origin: details.origin || origin,
              txid: utxo.tx_hash,
              vout: utxo.tx_pos,
              satoshis: 1,
              contentType: details.data?.insc?.file?.type,
              content: details.data?.insc?.file?.hash
            })
          } else {
            // Still include as potential ordinal even if no metadata
            ordinals.push({
              origin,
              txid: utxo.tx_hash,
              vout: utxo.tx_pos,
              satoshis: 1
            })
          }
        } catch {
          // Include without metadata on error
          ordinals.push({
            origin,
            txid: utxo.tx_hash,
            vout: utxo.tx_pos,
            satoshis: 1
          })
        }
      }
    }

    ordLogger.info('WhatsOnChain fallback found ordinals', { count: ordinals.length })
    return ordinals
  } catch (error) {
    ordLogger.error('Error fetching ordinals', error, { address })
    return []
  }
}

/**
 * Get ordinal metadata from 1Sat Ordinals API
 */
export async function getOrdinalDetails(origin: string): Promise<OrdinalDetails | null> {
  const result = await gpOrdinalsApi.get<OrdinalDetails>(`/api/inscriptions/${origin}`)
  if (!result.ok) return null
  return result.value
}

/**
 * Scan transaction history to find ordinals with non-standard scripts
 * (e.g., 1Sat Ordinal inscriptions with OP_IF envelope that don't show up in address queries)
 */
export async function scanHistoryForOrdinals(
  walletAddress: string,
  publicKeyHash: string
): Promise<Ordinal[]> {
  ordLogger.info('Scanning transaction history for inscriptions', { publicKeyHash: publicKeyHash.slice(0, 16) + '...' })
  const ordinals: Ordinal[] = []

  try {
    const history = await getTransactionHistory(walletAddress)
    if (!history || history.length === 0) {
      ordLogger.debug('No transaction history found')
      return []
    }

    ordLogger.debug('Checking transactions for ordinal outputs', { count: history.length })

    for (const historyItem of history) {
      const txid = historyItem.tx_hash

      try {
        const txDetails = await getTransactionDetails(txid)
        if (!txDetails?.vout) continue

        for (let vout = 0; vout < txDetails.vout.length; vout++) {
          const output = txDetails.vout[vout]!
          const value = output.value
          const scriptHex = output.scriptPubKey?.hex

          // Only check 1-sat outputs (potential ordinals)
          if (!isOneSatOutput(value) || !scriptHex) continue

          // Check if this is an ordinal inscription (starts with OP_IF 'ord')
          if (isOrdinalInscriptionScript(scriptHex)) {
            // Extract PKH from the script
            const extractedPkh = extractPkhFromInscriptionScript(scriptHex)
            if (extractedPkh && pkhMatches(extractedPkh, publicKeyHash)) {
                // Check if still unspent by querying GorillaPool
                const origin = formatOrdinalOrigin(txid, vout)
                const details = await getOrdinalDetails(origin)

                // Check if spent
                if (details && details.spend && details.spend !== '') {
                  ordLogger.debug('Found inscription but spent', { origin })
                  continue
                }

                ordLogger.debug('Found unspent inscription', { origin })

                // Try to extract content type from script
                const contentType = extractContentTypeFromScript(scriptHex)

                ordinals.push({
                  origin,
                  txid,
                  vout,
                  satoshis: 1,
                  contentType
                })
            }
          }
        }
      } catch (error) {
        ordLogger.warn('Error processing tx for ordinals', { txid, error: String(error) })
      }
    }

    ordLogger.info('History scan complete', { ordinalsFound: ordinals.length })
    return ordinals
  } catch (error) {
    ordLogger.error('Error scanning history for ordinals', error)
    return []
  }
}

/**
 * Transfer a 1Sat Ordinal to another address
 *
 * @param ordWif - The ordinals private key WIF
 * @param ordinalUtxo - The 1-sat ordinal UTXO to transfer
 * @param toAddress - Recipient's address
 * @param fundingWif - WIF for funding UTXOs (for the fee)
 * @param fundingUtxos - UTXOs to use for paying the fee
 * @returns Transaction ID
 */
export async function transferOrdinal(
  ordWif: string,
  ordinalUtxo: UTXO,
  toAddress: string,
  fundingWif: string,
  fundingUtxos: UTXO[]
): Promise<string> {
  const ordPrivateKey = PrivateKey.fromWif(ordWif)
  const ordPublicKey = ordPrivateKey.toPublicKey()
  const ordFromAddress = ordPublicKey.toAddress()
  const ordSourceLockingScript = new P2PKH().lock(ordFromAddress)

  const fundingPrivateKey = PrivateKey.fromWif(fundingWif)
  const fundingPublicKey = fundingPrivateKey.toPublicKey()
  const fundingFromAddress = fundingPublicKey.toAddress()
  const fundingSourceLockingScript = new P2PKH().lock(fundingFromAddress)

  const tx = new Transaction()

  // Add ordinal input first (the 1-sat inscription)
  tx.addInput({
    sourceTXID: ordinalUtxo.txid,
    sourceOutputIndex: ordinalUtxo.vout,
    unlockingScriptTemplate: new P2PKH().unlock(
      ordPrivateKey,
      'all',
      false,
      ordinalUtxo.satoshis,
      ordSourceLockingScript
    ),
    sequence: 0xffffffff
  })

  // Select funding UTXOs first, then calculate fee with actual input count
  const fundingToUse: UTXO[] = []
  let totalFunding = 0

  // Use preliminary estimate for selection loop
  const prelimFee = calculateTxFee(1 + Math.min(fundingUtxos.length, 2), 2)
  for (const utxo of fundingUtxos) {
    fundingToUse.push(utxo)
    totalFunding += utxo.satoshis
    if (totalFunding >= prelimFee + 100) break
  }

  // Recalculate fee with actual input count
  const estimatedFee = calculateTxFee(1 + fundingToUse.length, 2)

  if (totalFunding < estimatedFee) {
    throw new Error(`Insufficient funds for fee (need ~${estimatedFee} sats)`)
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

  // Add ordinal output first (important: ordinals go to first output)
  tx.addOutput({
    lockingScript: new P2PKH().lock(toAddress),
    satoshis: 1 // Always 1 sat for ordinals
  })

  // Calculate actual fee and change
  const totalInput = ordinalUtxo.satoshis + totalFunding
  const actualFee = calculateTxFee(1 + fundingToUse.length, 2)
  const change = totalInput - 1 - actualFee

  // Add change output if there is any change
  // Note: BSV has no dust limit - all change amounts are valid
  if (change > 0) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(fundingFromAddress),
      satoshis: change
    })
  }

  await tx.sign()

  // Get the UTXOs we're about to spend
  const utxosToSpend = [
    { txid: ordinalUtxo.txid, vout: ordinalUtxo.vout },
    ...fundingToUse.map(u => ({ txid: u.txid, vout: u.vout }))
  ]

  // Compute txid before broadcast for pending marking
  const pendingTxid = tx.id('hex')

  // Mark pending → broadcast → rollback on failure (shared pattern)
  const txid = await executeBroadcast(tx, pendingTxid, utxosToSpend)

  // Track transaction locally
  try {
    await recordSentTransaction(
      txid,
      tx.toHex(),
      `Transferred ordinal ${ordinalUtxo.txid.slice(0, 8)}... to ${toAddress.slice(0, 8)}...`,
      ['ordinal', 'transfer']
    )

    // Confirm UTXOs as spent (updates from pending -> spent)
    const confirmResult = await confirmUtxosSpent(utxosToSpend, txid)
    if (!confirmResult.ok) {
      ordLogger.warn('Failed to confirm UTXOs as spent', { txid, error: confirmResult.error.message })
    }

    ordLogger.info('Ordinal transfer tracked locally', { txid })
  } catch (error) {
    ordLogger.warn('Failed to track ordinal transfer locally', { error: String(error) })
  }

  return txid
}
