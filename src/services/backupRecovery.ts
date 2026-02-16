/**
 * Backup Recovery Service
 *
 * Handles reading and decrypting accounts from external Simply Sats backups,
 * with options to add recovered accounts or sweep funds to current wallet.
 *
 * @module services/backupRecovery
 */

import initSqlJs from 'sql.js'
import { readFile } from '@tauri-apps/plugin-fs'
import { decrypt, type EncryptedData, isEncryptedData } from './crypto'
import { createAccount } from './accounts'
import { getWocClient } from '../infrastructure/api/wocClient'
import { calculateMaxSend, DEFAULT_FEE_RATE } from '../domain/transaction/fees'
import { broadcastTransaction } from './wallet/transactions'
import type { WalletKeys, UTXO } from './wallet/types'
import { PrivateKey, P2PKH, Transaction } from '@bsv/sdk'
import { walletLogger } from './logger'

// ============================================
// Types
// ============================================

/**
 * Account data recovered from an external backup
 */
export interface RecoveredAccount {
  id: number
  name: string
  identityAddress: string
  encryptedKeys: string
  createdAt: number
  /** Populated after password validation */
  decryptedKeys?: WalletKeys
  /** Populated after blockchain query */
  liveUtxos?: UTXO[]
  /** Sum of live UTXOs in satoshis */
  liveBalance?: number
}

/**
 * Estimate for sweeping funds from a recovered account
 */
export interface SweepEstimate {
  /** Total balance in satoshis */
  totalSats: number
  /** Transaction fee in satoshis */
  fee: number
  /** Net amount after fee (what will be received) */
  netSats: number
  /** Number of UTXOs to spend */
  numInputs: number
  /** True if balance is too small to sweep economically */
  isDust: boolean
}

/**
 * Result of reading an external backup database
 */
export interface BackupReadResult {
  success: boolean
  accounts: RecoveredAccount[]
  error?: string
}

// ============================================
// SQL.js Initialization
// ============================================

import type { SqlJsStatic } from 'sql.js'

let sqlInstance: SqlJsStatic | null = null

/**
 * Initialize sql.js WebAssembly SQLite library
 * Cached to avoid re-downloading WASM on each call
 */
async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlInstance) {
    sqlInstance = await initSqlJs({
      // Load WASM from local public folder (bundled with app)
      locateFile: () => '/sql-wasm.wasm'
    })
  }
  return sqlInstance
}

// ============================================
// Database Reading
// ============================================

/**
 * Read and parse an external Simply Sats database file
 *
 * @param dbPath - Absolute path to the .db file
 * @returns Array of recovered account metadata (encrypted keys not yet decrypted)
 */
export async function readExternalDatabase(dbPath: string): Promise<RecoveredAccount[]> {
  walletLogger.info('Reading external database', { path: dbPath })

  const SQL = await getSqlJs()

  // Read database file as binary using Tauri FS
  const dbBuffer = await readFile(dbPath)

  // Open database with sql.js
  const db = new SQL.Database(new Uint8Array(dbBuffer))

  try {
    // Query accounts table
    const results = db.exec(`
      SELECT id, name, identity_address, encrypted_keys, created_at
      FROM accounts
      ORDER BY id ASC
    `)

    if (results.length === 0 || results[0]!.values.length === 0) {
      throw new Error('No accounts found in backup')
    }

    type AccountRow = [number, string, string, string, number]
    const accounts: RecoveredAccount[] = results[0]!.values.map((row: unknown[]) => {
      const [id, name, identityAddress, encryptedKeys, createdAt] = row as AccountRow
      return { id, name, identityAddress, encryptedKeys, createdAt }
    })

    walletLogger.info('Found accounts in backup', { count: accounts.length })
    return accounts
  } finally {
    db.close()
  }
}

/**
 * Read a backup from a .wallet folder (finds the simplysats.db inside)
 *
 * @param folderPath - Path to the .wallet folder
 * @returns Array of recovered accounts
 */
export async function readBackupFolder(folderPath: string): Promise<RecoveredAccount[]> {
  // The .wallet folder contains simplysats.db
  // Handle both Unix (/) and Windows (\) path separators
  const hasTrailingSep = folderPath.endsWith('/') || folderPath.endsWith('\\')
  const dbPath = hasTrailingSep
    ? `${folderPath}simplysats.db`
    : `${folderPath}/simplysats.db`

  return readExternalDatabase(dbPath)
}

// ============================================
// Decryption
// ============================================

/**
 * Decrypt account keys using the backup password
 *
 * @param account - Recovered account with encrypted keys
 * @param password - Password used when creating the backup
 * @returns Decrypted WalletKeys
 * @throws Error if password is incorrect or data is corrupted
 */
export async function decryptBackupAccount(
  account: RecoveredAccount,
  password: string
): Promise<WalletKeys> {
  walletLogger.debug('Decrypting account', { name: account.name })

  const encryptedData = JSON.parse(account.encryptedKeys) as EncryptedData

  if (!isEncryptedData(encryptedData)) {
    throw new Error('Invalid encrypted data format in backup')
  }

  const keysJson = await decrypt(encryptedData, password)
  const keys = JSON.parse(keysJson) as WalletKeys

  // Validate the decrypted keys have expected structure
  if (!keys.walletWif || !keys.walletAddress || !keys.mnemonic) {
    throw new Error('Decrypted keys missing required fields')
  }

  return keys
}

/**
 * Decrypt all accounts in a backup with the same password
 *
 * @param accounts - Array of recovered accounts
 * @param password - Password for decryption
 * @returns Accounts with decryptedKeys populated
 */
export async function decryptAllAccounts(
  accounts: RecoveredAccount[],
  password: string
): Promise<RecoveredAccount[]> {
  const results: RecoveredAccount[] = []

  for (const account of accounts) {
    try {
      const decryptedKeys = await decryptBackupAccount(account, password)
      results.push({ ...account, decryptedKeys })
    } catch (error) {
      walletLogger.error('Failed to decrypt account', { name: account.name, error })
      throw new Error(`Failed to decrypt account "${account.name}": ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return results
}

// ============================================
// Balance Fetching
// ============================================

/**
 * Fetch live UTXOs for a recovered account from the blockchain
 *
 * @param keys - Decrypted wallet keys
 * @returns Array of UTXOs across all addresses
 */
export async function fetchLiveUtxos(keys: WalletKeys): Promise<UTXO[]> {
  const client = getWocClient()
  const utxos: UTXO[] = []

  // Fetch UTXOs from all three addresses
  const addresses = [
    { address: keys.walletAddress, label: 'wallet' },
    { address: keys.ordAddress, label: 'ordinals' },
    { address: keys.identityAddress, label: 'identity' }
  ]

  for (const { address, label } of addresses) {
    try {
      const addressUtxos = await client.getUtxos(address)
      walletLogger.debug('Fetched UTXOs', { address, label, count: addressUtxos.length })
      utxos.push(...addressUtxos)
    } catch (error) {
      walletLogger.warn('Failed to fetch UTXOs for address', { address, label, error })
      // Continue with other addresses
    }
  }

  return utxos
}

/**
 * Fetch live balances for all recovered accounts
 *
 * @param accounts - Accounts with decrypted keys
 * @returns Accounts with liveUtxos and liveBalance populated
 */
export async function fetchAllBalances(
  accounts: RecoveredAccount[]
): Promise<RecoveredAccount[]> {
  const results: RecoveredAccount[] = []

  for (const account of accounts) {
    if (!account.decryptedKeys) {
      results.push(account)
      continue
    }

    try {
      const liveUtxos = await fetchLiveUtxos(account.decryptedKeys)
      const liveBalance = liveUtxos.reduce((sum, u) => sum + u.satoshis, 0)

      results.push({
        ...account,
        liveUtxos,
        liveBalance
      })
    } catch (error) {
      walletLogger.error('Failed to fetch balance', { name: account.name, error })
      results.push({
        ...account,
        liveUtxos: [],
        liveBalance: 0
      })
    }
  }

  return results
}

// ============================================
// Sweep Estimation
// ============================================

/**
 * Calculate sweep estimate (fee and net amount)
 *
 * @param utxos - UTXOs to sweep
 * @param feeRate - Fee rate in sat/byte (default: 0.1)
 * @returns Sweep estimate with dust indicator
 */
export function calculateSweepEstimate(
  utxos: UTXO[],
  feeRate: number = DEFAULT_FEE_RATE
): SweepEstimate {
  const totalSats = utxos.reduce((sum, u) => sum + u.satoshis, 0)

  if (utxos.length === 0 || totalSats === 0) {
    return {
      totalSats: 0,
      fee: 0,
      netSats: 0,
      numInputs: 0,
      isDust: true
    }
  }

  const { maxSats, fee, numInputs } = calculateMaxSend(utxos, feeRate)

  // Consider dust if net amount is 0 or negative
  const isDust = maxSats <= 0

  return {
    totalSats,
    fee,
    netSats: maxSats,
    numInputs,
    isDust
  }
}

// ============================================
// Add Account
// ============================================

/**
 * Add a recovered account to the current wallet
 *
 * @param keys - Decrypted wallet keys from the backup
 * @param originalName - Original account name (will be suffixed with "(Imported)")
 * @param currentPassword - Current wallet password for re-encryption
 * @returns Account ID of the newly created account
 */
export async function addRecoveredAccount(
  keys: WalletKeys,
  originalName: string,
  currentPassword: string
): Promise<number> {
  const accountName = `${originalName} (Imported)`

  walletLogger.info('Adding recovered account', { name: accountName })

  const accountId = await createAccount(accountName, keys, currentPassword)

  if (!accountId) {
    throw new Error('Failed to create account in database')
  }

  return accountId
}

// ============================================
// Sweep Transaction
// ============================================

/**
 * Execute a sweep transaction from a recovered account to the current wallet
 *
 * @param recoveredKeys - Decrypted keys of the account to sweep from
 * @param destinationAddress - Address to send funds to (current wallet)
 * @param utxos - UTXOs to sweep
 * @param feeRate - Fee rate in sat/byte (default: 0.1)
 * @returns Transaction ID
 */
export async function executeSweep(
  recoveredKeys: WalletKeys,
  destinationAddress: string,
  utxos: UTXO[],
  feeRate: number = DEFAULT_FEE_RATE
): Promise<string> {
  walletLogger.info('Executing sweep transaction', {
    from: recoveredKeys.walletAddress,
    to: destinationAddress,
    utxoCount: utxos.length
  })

  const estimate = calculateSweepEstimate(utxos, feeRate)

  if (estimate.isDust) {
    throw new Error('Balance too small to sweep (would be consumed by fees)')
  }

  // Build sweep transaction manually to handle all UTXOs from the recovered wallet
  const tx = new Transaction()

  // Group UTXOs by their source address to use correct key for signing
  const walletUtxos = utxos.filter(u => {
    // Check if UTXO belongs to wallet address
    const walletScript = new P2PKH().lock(recoveredKeys.walletAddress).toHex()
    return u.script === walletScript
  })

  const ordUtxos = utxos.filter(u => {
    const ordScript = new P2PKH().lock(recoveredKeys.ordAddress).toHex()
    return u.script === ordScript
  })

  const identityUtxos = utxos.filter(u => {
    const identityScript = new P2PKH().lock(recoveredKeys.identityAddress).toHex()
    return u.script === identityScript
  })

  // Add wallet address inputs
  const walletPrivKey = PrivateKey.fromWif(recoveredKeys.walletWif)
  const walletLockingScript = new P2PKH().lock(recoveredKeys.walletAddress)
  for (const utxo of walletUtxos) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(
        walletPrivKey,
        'all',
        false,
        utxo.satoshis,
        walletLockingScript
      ),
      sequence: 0xffffffff
    })
  }

  // Add ordinals address inputs
  const ordPrivKey = PrivateKey.fromWif(recoveredKeys.ordWif)
  const ordLockingScript = new P2PKH().lock(recoveredKeys.ordAddress)
  for (const utxo of ordUtxos) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(
        ordPrivKey,
        'all',
        false,
        utxo.satoshis,
        ordLockingScript
      ),
      sequence: 0xffffffff
    })
  }

  // Add identity address inputs
  const identityPrivKey = PrivateKey.fromWif(recoveredKeys.identityWif)
  const identityLockingScript = new P2PKH().lock(recoveredKeys.identityAddress)
  for (const utxo of identityUtxos) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(
        identityPrivKey,
        'all',
        false,
        utxo.satoshis,
        identityLockingScript
      ),
      sequence: 0xffffffff
    })
  }

  // Add single output to destination (max send, no change)
  tx.addOutput({
    lockingScript: new P2PKH().lock(destinationAddress),
    satoshis: estimate.netSats
  })

  // Sign and broadcast
  await tx.sign()

  const txid = await broadcastTransaction(tx)

  walletLogger.info('Sweep transaction broadcast', {
    txid,
    amount: estimate.netSats,
    fee: estimate.fee
  })

  return txid
}
