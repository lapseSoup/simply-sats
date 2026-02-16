/**
 * Balance and UTXO fetching operations
 */

import type { UTXO, WocHistoryItem, WocTransaction } from './types'
import { getWocClient } from '../../infrastructure/api/wocClient'
import {
  getBalanceFromDatabase,
  getSpendableUtxosFromDatabase,
  BASKETS
} from '../sync'
import { walletLogger } from '../logger'
import { btcToSatoshis } from '../../utils/satoshiConversion'

/**
 * Get balance from WhatsOnChain (uses wocClient infrastructure)
 */
export async function getBalance(address: string): Promise<number> {
  return getWocClient().getBalance(address)
}

/**
 * Get balance from local database (BRC-100 method - faster!)
 */
export async function getBalanceFromDB(basket?: string): Promise<number> {
  try {
    return await getBalanceFromDatabase(basket)
  } catch (error) {
    walletLogger.error('Database query failed in getBalanceFromDB — returning 0 (wallet may appear empty)', { basket, error: String(error) })
    return 0
  }
}

/**
 * Get spendable UTXOs from local database
 */
export async function getUTXOsFromDB(basket = BASKETS.DEFAULT): Promise<UTXO[]> {
  try {
    const dbUtxos = await getSpendableUtxosFromDatabase(basket)
    return dbUtxos.map(u => ({
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      script: u.lockingScript
    }))
  } catch (error) {
    walletLogger.error('Database query failed in getUTXOsFromDB — returning empty array', { basket, error: String(error) })
    return []
  }
}

/**
 * Get UTXOs from WhatsOnChain with locking scripts (uses wocClient infrastructure)
 */
export async function getUTXOs(address: string): Promise<UTXO[]> {
  return getWocClient().getUtxos(address)
}

/**
 * Get transaction history (uses wocClient infrastructure)
 */
export async function getTransactionHistory(address: string): Promise<WocHistoryItem[]> {
  const result = await getWocClient().getTransactionHistory(address)
  // Map to ensure WocHistoryItem type compatibility
  return result.map(item => ({ tx_hash: item.tx_hash, height: item.height }))
}

/**
 * Get transaction details including inputs/outputs (uses wocClient infrastructure)
 */
export async function getTransactionDetails(txid: string): Promise<WocTransaction | null> {
  // Note: wocClient returns a compatible WocTransaction type
  const result = await getWocClient().getTransactionDetails(txid)
  // Convert to our local WocTransaction type (they're compatible)
  return result as unknown as WocTransaction | null
}

/**
 * Calculate amount for a transaction relative to an address or array of addresses
 * (positive = received, negative = sent)
 * This is async because we may need to fetch previous tx details to get input amounts
 */
export async function calculateTxAmount(
  txDetails: WocTransaction | null,
  addressOrAddresses: string | string[]
): Promise<number> {
  if (!txDetails?.vin || !txDetails?.vout) return 0

  // Normalize to array
  const addresses = Array.isArray(addressOrAddresses) ? addressOrAddresses : [addressOrAddresses]

  let received = 0
  let sent = 0

  // Helper to check if any of our addresses match
  const isOurAddress = (addrList: string[] | undefined) => {
    if (!addrList) return false
    return addrList.some(addr => addresses.includes(addr))
  }

  // Sum outputs to our addresses (received)
  for (const vout of txDetails.vout) {
    if (isOurAddress(vout.scriptPubKey?.addresses)) {
      received += btcToSatoshis(vout.value)
    }
  }

  // Check inputs - WoC doesn't include prevout by default, so we need to fetch previous txs
  for (const vin of txDetails.vin) {
    // First check if prevout is available (some APIs include it)
    if (vin.prevout && isOurAddress(vin.prevout.scriptPubKey?.addresses)) {
      sent += btcToSatoshis(vin.prevout.value)
    } else if (vin.txid && vin.vout !== undefined) {
      // Fetch the previous transaction to check if the spent output was ours
      try {
        const prevTx = await getTransactionDetails(vin.txid)
        if (prevTx?.vout?.[vin.vout]) {
          const prevOutput = prevTx.vout[vin.vout]!
          if (isOurAddress(prevOutput.scriptPubKey?.addresses)) {
            sent += btcToSatoshis(prevOutput.value)
          }
        }
      } catch {
        // If we can't fetch, skip this input
      }
    }
  }

  return received - sent
}
