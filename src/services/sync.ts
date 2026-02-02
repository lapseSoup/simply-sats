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
  addTransaction,
  type UTXO as DBUtxo
} from './database'

// WhatsOnChain API base URL
const WOC_API = 'https://api.whatsonchain.com/v1/bsv/main'

// Basket names for different address types
export const BASKETS = {
  DEFAULT: 'default',      // Main spending wallet
  ORDINALS: 'ordinals',    // Ordinal inscriptions
  IDENTITY: 'identity',    // BRC-100 identity key
  LOCKS: 'locks'           // Time-locked outputs
} as const

// Address info for syncing
export interface AddressInfo {
  address: string
  basket: string
  wif?: string // Optional - for signing
}

// WhatsOnChain UTXO response
interface WocUtxo {
  tx_hash: string
  tx_pos: number
  value: number
  height?: number
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
 * Fetch current blockchain height
 */
export async function getCurrentBlockHeight(): Promise<number> {
  const response = await fetch(`${WOC_API}/chain/info`)
  if (!response.ok) {
    throw new Error('Failed to fetch blockchain info')
  }
  const data = await response.json()
  return data.blocks
}

/**
 * Fetch UTXOs for an address from WhatsOnChain
 */
async function fetchUtxosFromWoc(address: string): Promise<WocUtxo[]> {
  const response = await fetch(`${WOC_API}/address/${address}/unspent`)
  if (!response.ok) {
    if (response.status === 404) {
      return [] // No UTXOs found
    }
    throw new Error(`Failed to fetch UTXOs for ${address}`)
  }
  return response.json()
}

/**
 * Generate P2PKH locking script for an address
 */
function getLockingScript(address: string): string {
  return new P2PKH().lock(address).toHex()
}

/**
 * Sync a single address - fetches UTXOs and updates the database
 */
export async function syncAddress(addressInfo: AddressInfo): Promise<SyncResult> {
  const { address, basket } = addressInfo

  // Fetch current UTXOs from WhatsOnChain
  const wocUtxos = await fetchUtxosFromWoc(address)

  // Get existing spendable UTXOs from database
  const existingUtxos = await getSpendableUTXOs()
  const existingMap = new Map<string, DBUtxo>()
  for (const utxo of existingUtxos) {
    if (utxo.basket === basket) {
      existingMap.set(`${utxo.txid}:${utxo.vout}`, utxo)
    }
  }

  // Build set of current UTXOs from WoC
  const currentUtxoKeys = new Set<string>()
  for (const u of wocUtxos) {
    currentUtxoKeys.add(`${u.tx_hash}:${u.tx_pos}`)
  }

  let newUtxos = 0
  let spentUtxos = 0
  let totalBalance = 0

  const lockingScript = getLockingScript(address)

  // Add new UTXOs
  for (const wocUtxo of wocUtxos) {
    const key = `${wocUtxo.tx_hash}:${wocUtxo.tx_pos}`
    totalBalance += wocUtxo.value

    if (!existingMap.has(key)) {
      // New UTXO - add to database
      await addUTXO({
        txid: wocUtxo.tx_hash,
        vout: wocUtxo.tx_pos,
        satoshis: wocUtxo.value,
        lockingScript,
        basket,
        spendable: true,
        createdAt: Date.now(),
        tags: basket === BASKETS.ORDINALS && wocUtxo.value === 1 ? ['ordinal'] : []
      })
      newUtxos++
    }
  }

  // Mark spent UTXOs
  for (const [key, utxo] of existingMap) {
    if (!currentUtxoKeys.has(key)) {
      // UTXO no longer exists - mark as spent
      // Note: We don't know the spending txid without additional API calls
      await markUTXOSpent(utxo.txid, utxo.vout, 'unknown')
      spentUtxos++
    }
  }

  // Update sync state
  const currentHeight = await getCurrentBlockHeight()
  await updateSyncState(address, currentHeight)

  return {
    address,
    basket,
    newUtxos,
    spentUtxos,
    totalBalance
  }
}

/**
 * Sync all wallet addresses
 */
export async function syncAllAddresses(addresses: AddressInfo[]): Promise<SyncResult[]> {
  const results: SyncResult[] = []

  for (const addr of addresses) {
    try {
      const result = await syncAddress(addr)
      results.push(result)
      console.log(`Synced ${addr.basket}: ${result.newUtxos} new, ${result.spentUtxos} spent, ${result.totalBalance} sats`)
    } catch (error) {
      console.error(`Failed to sync ${addr.address}:`, error)
      // Continue with other addresses
    }
  }

  return results
}

/**
 * Full wallet sync - syncs all three address types
 */
export async function syncWallet(
  walletAddress: string,
  ordAddress: string,
  identityAddress: string
): Promise<{ total: number; results: SyncResult[] }> {
  const addresses: AddressInfo[] = [
    { address: walletAddress, basket: BASKETS.DEFAULT },
    { address: ordAddress, basket: BASKETS.ORDINALS },
    { address: identityAddress, basket: BASKETS.IDENTITY }
  ]

  const results = await syncAllAddresses(addresses)
  const total = results.reduce((sum, r) => sum + r.totalBalance, 0)

  return { total, results }
}

/**
 * Quick balance check - just sums current spendable UTXOs from database
 * Much faster than fetching from blockchain
 */
export async function getBalanceFromDatabase(basket?: string): Promise<number> {
  const utxos = await getSpendableUTXOs()

  if (basket) {
    return utxos
      .filter(u => u.basket === basket)
      .reduce((sum, u) => sum + u.satoshis, 0)
  }

  return utxos.reduce((sum, u) => sum + u.satoshis, 0)
}

/**
 * Get UTXOs for spending from database
 * Returns UTXOs from the default basket, sorted by value (smallest first for coin selection)
 */
export async function getSpendableUtxosFromDatabase(basket = BASKETS.DEFAULT): Promise<DBUtxo[]> {
  const allUtxos = await getSpendableUTXOs()
  return allUtxos
    .filter(u => u.basket === basket)
    .sort((a, b) => a.satoshis - b.satoshis)
}

/**
 * Record a transaction we sent
 */
export async function recordSentTransaction(
  txid: string,
  rawTx: string,
  description: string,
  labels: string[] = []
): Promise<void> {
  await addTransaction({
    txid,
    rawTx,
    description,
    createdAt: Date.now(),
    status: 'pending',
    labels
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
  console.log('Starting wallet restore from blockchain...')

  // Perform full sync
  const result = await syncWallet(walletAddress, ordAddress, identityAddress)

  console.log(`Restore complete: ${result.total} total satoshis found`)
  console.log('Results:', result.results)

  return result
}
