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
  getDerivedAddresses as getDerivedAddressesFromDB,
  updateDerivedAddressSyncTime,
  type UTXO as DBUtxo
} from './database'
import { RATE_LIMITS } from './config'
import { getWocClient } from '../infrastructure/api/wocClient'

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

  console.log(`[SYNC #${syncId}] START: ${address.slice(0,12)}... (basket: ${basket})`)

  // Generate locking script for this specific address
  const lockingScript = getLockingScript(address)

  // Fetch current UTXOs from WhatsOnChain
  const wocUtxos = await fetchUtxosFromWoc(address)
  console.log(`[SYNC] Found ${wocUtxos.length} UTXOs on-chain for ${address.slice(0,12)}...`)

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
      console.log(`[SYNC] Adding UTXO: ${wocUtxo.txid.slice(0,8)}:${wocUtxo.vout} = ${wocUtxo.satoshis} sats`)
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
      console.log(`[SYNC] Marking spent: ${key}`)
      await markUTXOSpent(utxo.txid, utxo.vout, 'unknown')
      spentUtxos++
    }
  }

  // Update sync state
  const currentHeight = await getCurrentBlockHeight()
  await updateSyncState(address, currentHeight)

  console.log(`[SYNC #${syncId}] DONE: ${newUtxos} new, ${spentUtxos} spent, ${totalBalance} sats`)

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

  for (let i = 0; i < addresses.length; i++) {
    const addr = addresses[i]
    try {
      // Add delay between requests to avoid rate limiting (429 errors)
      // Use configurable delay from config
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMITS.addressSyncDelay))
      }
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
 * Full wallet sync - syncs all three address types plus derived addresses
 */
export async function syncWallet(
  walletAddress: string,
  ordAddress: string,
  identityAddress: string
): Promise<{ total: number; results: SyncResult[] }> {
  // Sync derived addresses FIRST (most important for correct balance)
  const derivedAddresses = await getDerivedAddressesFromDB()
  console.log('[SYNC] Found', derivedAddresses.length, 'derived addresses in database')

  const addresses: AddressInfo[] = []

  // Add derived addresses first (priority)
  for (const derived of derivedAddresses) {
    console.log('[SYNC] Adding derived address to sync (priority):', derived.address)
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

  console.log('[SYNC] Total addresses to sync:', addresses.length)
  const results = await syncAllAddresses(addresses)

  // Update sync timestamps for derived addresses
  for (const derived of derivedAddresses) {
    const result = results.find(r => r.address === derived.address)
    if (result) {
      await updateDerivedAddressSyncTime(derived.address)
    }
  }

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
    const filtered = utxos.filter(u => u.basket === basket)
    const balance = filtered.reduce((sum, u) => sum + u.satoshis, 0)
    console.log(`[BALANCE] getBalanceFromDatabase('${basket}'): ${filtered.length} UTXOs, ${balance} sats`)
    if (basket === 'derived' && filtered.length > 0) {
      console.log('[BALANCE] Derived UTXOs:', filtered.map(u => ({ txid: u.txid.slice(0, 8), vout: u.vout, sats: u.satoshis, basket: u.basket })))
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
  console.log(`[Ordinals] Found ${ordinalUtxos.length} ordinals in database`)
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
