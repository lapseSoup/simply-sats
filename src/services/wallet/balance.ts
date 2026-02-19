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
import { btcToSatoshis } from '../../utils/satoshiConversion'

/**
 * Get balance from WhatsOnChain (uses wocClient infrastructure)
 */
export async function getBalance(address: string): Promise<number> {
  return getWocClient().getBalance(address)
}

/**
 * Get balance from local database (BRC-100 method - faster!)
 * @param basket - Optional basket filter (e.g. 'default', 'derived')
 * @param accountId - Account to scope query to. Omit only for account-agnostic contexts (e.g. BRC-100).
 */
export async function getBalanceFromDB(basket?: string, accountId?: number): Promise<number> {
  return getBalanceFromDatabase(basket, accountId)
}

/**
 * Get spendable UTXOs from local database
 * @param basket - Basket filter (defaults to 'default')
 * @param accountId - Account to scope query to. Omit only for account-agnostic contexts.
 */
export async function getUTXOsFromDB(basket = BASKETS.DEFAULT, accountId?: number): Promise<UTXO[]> {
  // Do NOT catch here — callers must distinguish "no UTXOs" (empty array) from
  // "DB error" (thrown exception). Swallowing errors causes the UI to show
  // "empty wallet" when the real problem is a database failure.
  const dbUtxos = await getSpendableUtxosFromDatabase(basket, accountId)
  return dbUtxos.map(u => ({
    txid: u.txid,
    vout: u.vout,
    satoshis: u.satoshis,
    script: u.lockingScript
  }))
}

/**
 * Get the locking script hex for a specific UTXO by outpoint, from the local database.
 * Returns null if the UTXO is not found in any basket.
 * Used to supply the correct (potentially non-P2PKH) script when signing ordinal transfers.
 */
export async function getUTXOLockingScript(txid: string, vout: number): Promise<string | null> {
  const ordinalUtxos = await getSpendableUtxosFromDatabase(BASKETS.ORDINALS)
  const match = ordinalUtxos.find(u => u.txid === txid && u.vout === vout)
  return match?.lockingScript ?? null
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
  return getWocClient().getTransactionDetails(txid)
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
  if (!Array.isArray(txDetails.vout) || !Array.isArray(txDetails.vin)) return 0

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
      const value = vout.value
      if (typeof value === 'number' && Number.isFinite(value)) {
        received += btcToSatoshis(value)
      }
    }
  }

  // Check inputs - WoC doesn't include prevout by default, so we need to fetch previous txs
  for (const vin of txDetails.vin) {
    // First check if prevout is available (some APIs include it)
    if (vin.prevout && isOurAddress(vin.prevout.scriptPubKey?.addresses)) {
      const value = vin.prevout.value
      if (typeof value === 'number' && Number.isFinite(value)) {
        sent += btcToSatoshis(value)
      }
    } else if (vin.txid && vin.vout !== undefined) {
      // Fetch the previous transaction to check if the spent output was ours
      try {
        const prevTx = await getTransactionDetails(vin.txid)
        const prevOutput = prevTx?.vout && Array.isArray(prevTx.vout) ? prevTx.vout[vin.vout] : undefined
        if (prevOutput) {
          if (isOurAddress(prevOutput.scriptPubKey?.addresses)) {
            const value = prevOutput.value
            if (typeof value === 'number' && Number.isFinite(value)) {
              sent += btcToSatoshis(value)
            }
          }
        }
      } catch {
        // If we can't fetch, skip this input
      }
    }
  }

  return received - sent
}
