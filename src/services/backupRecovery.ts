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
import { validateMnemonic } from '../domain/wallet/validation'
import { createAccount } from './accounts'
import { getWocClient } from '../infrastructure/api/wocClient'
import { calculateMaxSend, DEFAULT_FEE_RATE } from '../domain/transaction/fees'
import { broadcastTransaction } from './wallet/transactions'
import type { WalletKeys, UTXO } from './wallet/types'
import { walletLogger } from './logger'
import { p2pkhLockingScriptHex } from '../domain/transaction/builder'
import { isTauri, tauriInvoke } from '../utils/tauri'

// ============================================
// Types
// ============================================

/**
 * Encrypted account record read from an external backup.
 */
export interface RecoveredBackupAccount {
  id: number
  name: string
  identityAddress: string
  encryptedKeys: string
  createdAt: number
}

/**
 * Sanitized recovered account summary exposed to the UI.
 */
export interface RecoveredAccount {
  id: number
  name: string
  identityAddress: string
  createdAt: number
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

// ============================================
// SQL.js Initialization
// ============================================

import type { SqlJsStatic } from 'sql.js'

let sqlInstance: SqlJsStatic | null = null
const recoveredAccountKeySession = new Map<number, WalletKeys>()

function setRecoveredAccountKeys(accountId: number, keys: WalletKeys): void {
  recoveredAccountKeySession.set(accountId, keys)
}

function getRecoveredAccountKeys(accountId: number): WalletKeys | null {
  return recoveredAccountKeySession.get(accountId) ?? null
}

function requireRecoveredAccountKeys(accountId: number): WalletKeys {
  const keys = getRecoveredAccountKeys(accountId)
  if (!keys) {
    throw new Error('Recovered account keys are no longer available. Re-open the backup and decrypt it again.')
  }
  return keys
}

export function clearRecoveredAccountSession(): void {
  recoveredAccountKeySession.clear()
}

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
export async function readExternalDatabase(dbPath: string): Promise<RecoveredBackupAccount[]> {
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
    const accounts: RecoveredBackupAccount[] = results[0]!.values.map((row: unknown[]) => {
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
export async function readBackupFolder(folderPath: string): Promise<RecoveredBackupAccount[]> {
  // The .wallet folder contains simplysats.db
  // Strip any trailing separator, then use the platform's native separator
  const cleanPath = folderPath.replace(/[/\\]+$/, '')
  // Use the separator present in the path (backslash for Windows, forward slash for Unix)
  const sep = cleanPath.includes('\\') ? '\\' : '/'
  const dbPath = `${cleanPath}${sep}simplysats.db`

  // Defense-in-depth: reject path traversal sequences even though paths come from file dialog
  if (dbPath.includes('..')) {
    throw new Error('Invalid backup path: directory traversal not allowed')
  }

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
  account: RecoveredBackupAccount,
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

  // Validate WIF is a real private key — a wrong password can produce garbage
  // that passes the string existence check above but would silently corrupt the wallet.
  // Use Tauri backend for WIF validation when available; fall back to format check otherwise.
  if (isTauri()) {
    try {
      await tauriInvoke('keys_from_wif', { wif: keys.walletWif })
    } catch {
      throw new Error('Decrypted keys contain an invalid WIF private key — wrong password or corrupted backup')
    }
  } else {
    // Basic WIF format validation: Base58Check, starts with K/L/5, correct length
    if (!/^[KL5][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(keys.walletWif)) {
      throw new Error('Decrypted keys contain an invalid WIF private key — wrong password or corrupted backup')
    }
  }

  // Validate mnemonic is a proper BIP-39 phrase
  const mnemonicResult = validateMnemonic(keys.mnemonic)
  if (!mnemonicResult.isValid) {
    throw new Error(`Decrypted keys contain an invalid mnemonic: ${mnemonicResult.error ?? 'unknown error'}`)
  }

  return keys
}

/**
 * Decrypt all accounts in a backup with the same password
 *
 * @param accounts - Array of recovered backup accounts
 * @param password - Password for decryption
 * @returns Sanitized recovered accounts; decrypted keys are held only in the recovery session.
 */
export async function decryptAllAccounts(
  accounts: RecoveredBackupAccount[],
  password: string
): Promise<RecoveredAccount[]> {
  clearRecoveredAccountSession()
  const results: RecoveredAccount[] = []

  for (const account of accounts) {
    try {
      const decryptedKeys = await decryptBackupAccount(account, password)
      setRecoveredAccountKeys(account.id, decryptedKeys)
      results.push({
        id: account.id,
        name: account.name,
        identityAddress: account.identityAddress,
        createdAt: account.createdAt
      })
    } catch (error) {
      clearRecoveredAccountSession()
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
    const recoveredKeys = getRecoveredAccountKeys(account.id)
    if (!recoveredKeys) {
      results.push(account)
      continue
    }

    try {
      const liveUtxos = await fetchLiveUtxos(recoveredKeys)
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

  const createResult = await createAccount(accountName, keys, currentPassword)

  if (!createResult.ok) {
    throw new Error(`Failed to create account in database: ${createResult.error.message}`)
  }
  const accountId = createResult.value

  return accountId
}

export async function addRecoveredAccountFromSession(
  accountId: number,
  originalName: string,
  currentPassword: string
): Promise<number> {
  return addRecoveredAccount(
    requireRecoveredAccountKeys(accountId),
    originalName,
    currentPassword
  )
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
  if (!isTauri()) {
    throw new Error('Sweep transaction building requires Tauri runtime')
  }

  walletLogger.info('Executing sweep transaction', {
    from: recoveredKeys.walletAddress,
    to: destinationAddress,
    utxoCount: utxos.length
  })

  const estimate = calculateSweepEstimate(utxos, feeRate)

  if (estimate.isDust) {
    throw new Error('Balance too small to sweep (would be consumed by fees)')
  }

  // Compute locking script hex for each address to group UTXOs
  const walletScriptHex = p2pkhLockingScriptHex(recoveredKeys.walletAddress)
  const ordScriptHex = p2pkhLockingScriptHex(recoveredKeys.ordAddress)
  const identityScriptHex = p2pkhLockingScriptHex(recoveredKeys.identityAddress)

  // Build extended UTXOs with per-UTXO WIF for multi-key signing
  const extendedUtxos = utxos.map(u => {
    let wif: string
    if (u.script === walletScriptHex) {
      wif = recoveredKeys.walletWif
    } else if (u.script === ordScriptHex) {
      wif = recoveredKeys.ordWif
    } else if (u.script === identityScriptHex) {
      wif = recoveredKeys.identityWif
    } else {
      // Unknown script — default to wallet key (best effort)
      wif = recoveredKeys.walletWif
    }
    return {
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      script: u.script ?? walletScriptHex,
      wif
    }
  })

  const totalInput = utxos.reduce((sum, u) => sum + u.satoshis, 0)

  // Build and sign multi-key sweep transaction via Tauri
  const txResult = await tauriInvoke<{ rawTx: string; txid: string }>('build_multi_key_p2pkh_tx', {
    changeWif: recoveredKeys.walletWif,
    toAddress: destinationAddress,
    satoshis: estimate.netSats,
    selectedUtxos: extendedUtxos,
    totalInput,
    feeRate
  })

  // Broadcast the signed raw transaction
  const txid = await broadcastTransaction(txResult.rawTx)

  walletLogger.info('Sweep transaction broadcast', {
    txid,
    amount: estimate.netSats,
    fee: estimate.fee
  })

  return txid
}

export async function executeRecoveredAccountSweep(
  accountId: number,
  destinationAddress: string,
  utxos: UTXO[],
  feeRate: number = DEFAULT_FEE_RATE
): Promise<string> {
  return executeSweep(
    requireRecoveredAccountKeys(accountId),
    destinationAddress,
    utxos,
    feeRate
  )
}
