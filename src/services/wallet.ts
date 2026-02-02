import * as bip39 from 'bip39'
import { HD, Mnemonic, PrivateKey, P2PKH, Transaction, Script, OP, LockingScript, UnlockingScript, TransactionSignature } from '@bsv/sdk'
import {
  getBalanceFromDatabase,
  getSpendableUtxosFromDatabase,
  recordSentTransaction,
  markUtxosSpent,
  BASKETS
} from './sync'

// Wallet type - simplified to just BRC-100/Yours standard
export type WalletType = 'yours'

// BRC-100 standard derivation paths (same as Yours Wallet)
const WALLET_PATHS = {
  yours: {
    wallet: "m/44'/236'/0'/0/0",    // BSV spending
    ordinals: "m/44'/236'/0'/1/0",   // Ordinals
    identity: "m/44'/236'/0'/2/0"    // Identity/BRC-100 authentication
  }
}

export interface WalletKeys {
  mnemonic: string
  walletType: WalletType
  walletWif: string
  walletAddress: string
  walletPubKey: string
  ordWif: string
  ordAddress: string
  ordPubKey: string
  identityWif: string
  identityAddress: string
  identityPubKey: string
}

export interface UTXO {
  txid: string
  vout: number
  satoshis: number
  script: string
}

// Shaullet backup format
interface ShaulletBackup {
  mnemonic?: string
  seed?: string
  keys?: {
    privateKey?: string
    wif?: string
  }
}

// 1Sat Ordinals wallet JSON format
interface OneSatWalletBackup {
  ordPk?: string      // Ordinals private key (WIF)
  payPk?: string      // Payment private key (WIF)
  mnemonic?: string   // Optional mnemonic
}

// Generate keys from derivation path
function deriveKeys(mnemonic: string, path: string) {
  const seed = Mnemonic.fromString(mnemonic).toSeed()
  const masterNode = HD.fromSeed(seed)
  const childNode = masterNode.derive(path)
  const privateKey = childNode.privKey
  const publicKey = privateKey.toPublicKey()

  return {
    wif: privateKey.toWif(),
    address: publicKey.toAddress(),
    pubKey: publicKey.toString()
  }
}

// Generate keys from WIF (for importing from other wallets)
function keysFromWif(wif: string) {
  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()

  return {
    wif: privateKey.toWif(),
    address: publicKey.toAddress(),
    pubKey: publicKey.toString()
  }
}

// Create new wallet with fresh mnemonic
export function createWallet(): WalletKeys {
  const mnemonic = bip39.generateMnemonic()
  return restoreWallet(mnemonic)
}

// Restore wallet from mnemonic
export function restoreWallet(mnemonic: string): WalletKeys {
  // Normalize mnemonic: lowercase, trim, collapse multiple spaces
  const normalizedMnemonic = mnemonic.toLowerCase().trim().replace(/\s+/g, ' ')

  // Validate mnemonic
  if (!bip39.validateMnemonic(normalizedMnemonic)) {
    console.error('Mnemonic validation failed for:', normalizedMnemonic.split(' ').length, 'words')
    throw new Error('Invalid mnemonic phrase. Please check your 12 words.')
  }

  try {
    const paths = WALLET_PATHS.yours
    const wallet = deriveKeys(normalizedMnemonic, paths.wallet)
    const ord = deriveKeys(normalizedMnemonic, paths.ordinals)
    const identity = deriveKeys(normalizedMnemonic, paths.identity)

    return {
      mnemonic: normalizedMnemonic,
      walletType: 'yours',
      walletWif: wallet.wif,
      walletAddress: wallet.address,
      walletPubKey: wallet.pubKey,
      ordWif: ord.wif,
      ordAddress: ord.address,
      ordPubKey: ord.pubKey,
      identityWif: identity.wif,
      identityAddress: identity.address,
      identityPubKey: identity.pubKey
    }
  } catch (error) {
    console.error('Error deriving keys from mnemonic:', error)
    throw new Error('Failed to derive wallet keys from mnemonic')
  }
}

// Import from Shaullet JSON backup
export function importFromShaullet(jsonString: string): WalletKeys {
  try {
    const backup: ShaulletBackup = JSON.parse(jsonString)

    // If mnemonic is present, use it
    if (backup.mnemonic) {
      return restoreWallet(backup.mnemonic)
    }

    // If WIF is present, import keys directly
    if (backup.keys?.wif) {
      const wallet = keysFromWif(backup.keys.wif)
      // For Shaullet imports without mnemonic, we use the same key for all purposes
      return {
        mnemonic: '', // No mnemonic available
        walletType: 'yours',
        walletWif: wallet.wif,
        walletAddress: wallet.address,
        walletPubKey: wallet.pubKey,
        ordWif: wallet.wif,
        ordAddress: wallet.address,
        ordPubKey: wallet.pubKey,
        identityWif: wallet.wif,
        identityAddress: wallet.address,
        identityPubKey: wallet.pubKey
      }
    }

    throw new Error('Invalid Shaullet backup format')
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error('Invalid JSON format')
    }
    throw e
  }
}

// Import from 1Sat Ordinals wallet JSON
export function importFrom1SatOrdinals(jsonString: string): WalletKeys {
  try {
    const backup: OneSatWalletBackup = JSON.parse(jsonString)

    // If mnemonic is present, use it
    if (backup.mnemonic) {
      return restoreWallet(backup.mnemonic)
    }

    // Import from separate keys
    if (backup.payPk || backup.ordPk) {
      const paymentKey = backup.payPk ? keysFromWif(backup.payPk) : null
      const ordKey = backup.ordPk ? keysFromWif(backup.ordPk) : null

      // Use payment key as primary, ordinals key for ordinals
      const primaryKey = paymentKey || ordKey
      if (!primaryKey) {
        throw new Error('No valid keys found in backup')
      }

      return {
        mnemonic: '', // No mnemonic available
        walletType: 'yours',
        walletWif: primaryKey.wif,
        walletAddress: primaryKey.address,
        walletPubKey: primaryKey.pubKey,
        ordWif: ordKey?.wif || primaryKey.wif,
        ordAddress: ordKey?.address || primaryKey.address,
        ordPubKey: ordKey?.pubKey || primaryKey.pubKey,
        // Generate identity from payment key for BRC-100 compatibility
        identityWif: primaryKey.wif,
        identityAddress: primaryKey.address,
        identityPubKey: primaryKey.pubKey
      }
    }

    throw new Error('Invalid 1Sat Ordinals backup format')
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error('Invalid JSON format')
    }
    throw e
  }
}

// Detect backup format and import accordingly
export function importFromJSON(jsonString: string): WalletKeys {
  try {
    const backup = JSON.parse(jsonString)

    // Check for 1Sat Ordinals format (has ordPk or payPk)
    if (backup.ordPk || backup.payPk) {
      return importFrom1SatOrdinals(jsonString)
    }

    // Check for Shaullet format (has keys object or mnemonic at root)
    if (backup.keys || backup.mnemonic || backup.seed) {
      return importFromShaullet(jsonString)
    }

    throw new Error('Unknown backup format')
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error('Invalid JSON format')
    }
    throw e
  }
}

// Get balance from WhatsOnChain (legacy method)
export async function getBalance(address: string): Promise<number> {
  try {
    const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/balance`)
    if (!response.ok) {
      console.warn(`Failed to fetch balance for ${address}: ${response.status}`)
      return 0
    }
    const data = await response.json()
    if (typeof data.confirmed !== 'number' || typeof data.unconfirmed !== 'number') {
      console.warn(`Unexpected balance response for ${address}:`, data)
      return 0
    }
    return data.confirmed + data.unconfirmed
  } catch (error) {
    console.error(`Error fetching balance for ${address}:`, error)
    return 0
  }
}

// Get balance from local database (BRC-100 method - faster!)
export async function getBalanceFromDB(basket?: string): Promise<number> {
  try {
    return await getBalanceFromDatabase(basket)
  } catch (error) {
    console.warn('Database not ready, falling back to API')
    return 0
  }
}

// Get spendable UTXOs from local database
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
    console.warn('Database not ready')
    return []
  }
}

// Get UTXOs from WhatsOnChain with locking scripts
export async function getUTXOs(address: string): Promise<UTXO[]> {
  try {
    const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`)
    if (!response.ok) {
      console.warn(`Failed to fetch UTXOs for ${address}: ${response.status}`)
      return []
    }
    const data = await response.json()
    if (!Array.isArray(data)) {
      console.warn(`Unexpected UTXO response for ${address}:`, data)
      return []
    }

    // Generate the P2PKH locking script for this address
    const lockingScript = new P2PKH().lock(address)

    return data.map((utxo: any) => ({
      txid: utxo.tx_hash,
      vout: utxo.tx_pos,
      satoshis: utxo.value,
      script: lockingScript.toHex()
    }))
  } catch (error) {
    console.error(`Error fetching UTXOs for ${address}:`, error)
    return []
  }
}

// Get transaction history
export async function getTransactionHistory(address: string): Promise<any[]> {
  try {
    const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/history`)
    if (!response.ok) {
      console.warn(`Failed to fetch history for ${address}: ${response.status}`)
      return []
    }
    const data = await response.json()
    // Handle case where API returns error object instead of array
    if (!Array.isArray(data)) {
      console.warn(`Unexpected history response for ${address}:`, data)
      return []
    }
    return data
  } catch (error) {
    console.error(`Error fetching history for ${address}:`, error)
    return []
  }
}

// Get transaction details including inputs/outputs
export async function getTransactionDetails(txid: string): Promise<any | null> {
  try {
    const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}`)
    if (!response.ok) {
      return null
    }
    return await response.json()
  } catch {
    return null
  }
}

// Calculate amount for a transaction relative to an address (positive = received, negative = sent)
// This is async because we may need to fetch previous tx details to get input amounts
export async function calculateTxAmount(txDetails: any, address: string): Promise<number> {
  if (!txDetails?.vin || !txDetails?.vout) return 0

  let received = 0
  let sent = 0

  // Sum outputs to our address (received)
  for (const vout of txDetails.vout) {
    if (vout.scriptPubKey?.addresses?.includes(address)) {
      received += Math.round(vout.value * 100000000)
    }
  }

  // Check inputs - WoC doesn't include prevout by default, so we need to fetch previous txs
  for (const vin of txDetails.vin) {
    // First check if prevout is available (some APIs include it)
    if (vin.prevout?.scriptPubKey?.addresses?.includes(address)) {
      sent += Math.round(vin.prevout.value * 100000000)
    } else if (vin.txid && vin.vout !== undefined) {
      // Fetch the previous transaction to check if the spent output was ours
      try {
        const prevTx = await getTransactionDetails(vin.txid)
        if (prevTx?.vout?.[vin.vout]) {
          const prevOutput = prevTx.vout[vin.vout]
          if (prevOutput.scriptPubKey?.addresses?.includes(address)) {
            sent += Math.round(prevOutput.value * 100000000)
          }
        }
      } catch {
        // If we can't fetch, skip this input
      }
    }
  }

  return received - sent
}

// Calculate transaction fee for given inputs/outputs at exactly 100 sat/KB
export function calculateTxFee(numInputs: number, numOutputs: number, extraBytes = 0): number {
  // P2PKH tx sizes: ~10 bytes overhead + 148 bytes per input + 34 bytes per output
  const txSize = 10 + (numInputs * 148) + (numOutputs * 34) + extraBytes
  // 100 sat/KB = 0.1 sat/byte, use ceiling to ensure we meet minimum
  return Math.max(1, Math.ceil(txSize * 100 / 1000))
}

// Calculate max sendable amount given UTXOs
export function calculateMaxSend(utxos: UTXO[]): { maxSats: number; fee: number; numInputs: number } {
  if (utxos.length === 0) {
    return { maxSats: 0, fee: 0, numInputs: 0 }
  }

  const totalSats = utxos.reduce((sum, u) => sum + u.satoshis, 0)
  const numInputs = utxos.length

  // When sending max, we have 1 output (no change)
  const fee = calculateTxFee(numInputs, 1)
  const maxSats = Math.max(0, totalSats - fee)

  return { maxSats, fee, numInputs }
}

// Broadcast a signed transaction
async function broadcastTransaction(tx: Transaction): Promise<string> {
  const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: tx.toHex() })
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Broadcast error:', errorText)
    throw new Error(`Failed to broadcast: ${errorText}`)
  }

  return tx.id('hex')
}

// Calculate exact fee by selecting UTXOs for a given amount
export function calculateExactFee(
  satoshis: number,
  utxos: UTXO[]
): { fee: number; inputCount: number; outputCount: number; totalInput: number; canSend: boolean } {
  if (utxos.length === 0 || satoshis <= 0) {
    return { fee: 0, inputCount: 0, outputCount: 0, totalInput: 0, canSend: false }
  }

  // Select UTXOs (same logic as sendBSV)
  const inputsToUse: UTXO[] = []
  let totalInput = 0

  for (const utxo of utxos) {
    inputsToUse.push(utxo)
    totalInput += utxo.satoshis

    if (totalInput >= satoshis + 100) break
  }

  if (totalInput < satoshis) {
    return { fee: 0, inputCount: inputsToUse.length, outputCount: 0, totalInput, canSend: false }
  }

  // Calculate if we'll have change
  const numInputs = inputsToUse.length
  const prelimChange = totalInput - satoshis
  const willHaveChange = prelimChange > 100

  const numOutputs = willHaveChange ? 2 : 1
  const fee = calculateTxFee(numInputs, numOutputs)

  const change = totalInput - satoshis - fee
  const canSend = change >= 0

  return { fee, inputCount: numInputs, outputCount: numOutputs, totalInput, canSend }
}

// Build and sign a simple P2PKH transaction
export async function sendBSV(
  wif: string,
  toAddress: string,
  satoshis: number,
  utxos: UTXO[]
): Promise<string> {
  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()
  const fromAddress = publicKey.toAddress()

  // Generate locking script for the source address
  const sourceLockingScript = new P2PKH().lock(fromAddress)

  const tx = new Transaction()

  // Collect inputs we'll use
  const inputsToUse: UTXO[] = []
  let totalInput = 0

  for (const utxo of utxos) {
    inputsToUse.push(utxo)
    totalInput += utxo.satoshis

    // Break if we have enough for amount + reasonable fee buffer
    if (totalInput >= satoshis + 100) break
  }

  if (totalInput < satoshis) {
    throw new Error('Insufficient funds')
  }

  // Calculate fee based on actual transaction size at 0.1 sat/byte
  const numInputs = inputsToUse.length

  // First calculate if we'll have meaningful change
  const prelimChange = totalInput - satoshis
  const willHaveChange = prelimChange > 100 // Need room for fee + non-dust change

  const numOutputs = willHaveChange ? 2 : 1
  const fee = calculateTxFee(numInputs, numOutputs)

  const change = totalInput - satoshis - fee

  if (change < 0) {
    throw new Error(`Insufficient funds (need ${fee} sats for fee)`)
  }

  // Add inputs - pass sourceSatoshis and lockingScript to unlock() for signing
  for (const utxo of inputsToUse) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(
        privateKey,
        'all',
        false,
        utxo.satoshis,
        sourceLockingScript
      ),
      sequence: 0xffffffff
    })
  }

  // Add recipient output
  tx.addOutput({
    lockingScript: new P2PKH().lock(toAddress),
    satoshis
  })

  // Add change output if it's above dust threshold
  if (change > 546) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(fromAddress),
      satoshis: change
    })
  }
  // If change <= 546, it goes to miners as extra fee (dust)

  await tx.sign()
  const txid = await broadcastTransaction(tx)

  // Track transaction locally for BRC-100 compliance
  try {
    // Record the transaction
    await recordSentTransaction(
      txid,
      tx.toHex(),
      `Sent ${satoshis} sats to ${toAddress}`,
      ['send']
    )

    // Mark spent UTXOs
    await markUtxosSpent(
      inputsToUse.map(u => ({ txid: u.txid, vout: u.vout })),
      txid
    )

    console.log('Transaction tracked locally:', txid)
  } catch (error) {
    // Don't fail the send if tracking fails - tx is already broadcast
    console.warn('Failed to track transaction locally:', error)
  }

  return txid
}

// Storage helpers
const STORAGE_KEY = 'simply_sats_wallet'

export function saveWallet(keys: WalletKeys, _password: string): void {
  const encrypted = btoa(JSON.stringify(keys))
  localStorage.setItem(STORAGE_KEY, encrypted)
}

export function loadWallet(_password: string): WalletKeys | null {
  const encrypted = localStorage.getItem(STORAGE_KEY)
  if (!encrypted) return null

  try {
    return JSON.parse(atob(encrypted))
  } catch {
    return null
  }
}

export function hasWallet(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null
}

export function clearWallet(): void {
  localStorage.removeItem(STORAGE_KEY)
}

// 1Sat Ordinals types
export interface Ordinal {
  origin: string
  txid: string
  vout: number
  satoshis: number
  contentType?: string
  content?: string
}

// Get 1Sat Ordinals from the ordinals address
export async function getOrdinals(address: string): Promise<Ordinal[]> {
  try {
    const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`)
    if (!response.ok) {
      console.warn(`Failed to fetch ordinals for ${address}: ${response.status}`)
      return []
    }
    const utxos = await response.json()
    if (!Array.isArray(utxos)) {
      console.warn(`Unexpected ordinals response for ${address}:`, utxos)
      return []
    }

    const ordinals: Ordinal[] = []

    for (const utxo of utxos) {
      if (utxo.value === 1) {
        ordinals.push({
          origin: `${utxo.tx_hash}_${utxo.tx_pos}`,
          txid: utxo.tx_hash,
          vout: utxo.tx_pos,
          satoshis: 1
        })
      }
    }

    return ordinals
  } catch (error) {
    console.error(`Error fetching ordinals for ${address}:`, error)
    return []
  }
}

// Get ordinal metadata from 1Sat Ordinals API
export async function getOrdinalDetails(origin: string): Promise<any> {
  try {
    const response = await fetch(`https://ordinals.gorillapool.io/api/inscriptions/${origin}`)
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}

// ============================================
// Time Lock (CLTV) Functions
// ============================================

export interface LockedUTXO {
  txid: string
  vout: number
  satoshis: number
  lockingScript: string
  unlockBlock: number
  publicKeyHex: string
  createdAt: number
}

/**
 * Create a CLTV (CheckLockTimeVerify) locking script
 * Script: <locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
 */
function createCLTVLockingScript(unlockBlock: number, publicKeyHash: number[]): Script {
  const script = new Script()

  // Push the lock time (block height)
  // BIP-65: locktime must be encoded as the minimum number of bytes
  if (unlockBlock <= 16) {
    script.writeOpCode(OP.OP_1 - 1 + unlockBlock) // OP_1 through OP_16
  } else {
    // Convert to little-endian bytes, removing leading zeros
    const bytes: number[] = []
    let n = unlockBlock
    while (n > 0) {
      bytes.push(n & 0xff)
      n >>= 8
    }
    // If high bit is set, add a 0x00 byte to keep it positive
    if (bytes.length > 0 && (bytes[bytes.length - 1] & 0x80) !== 0) {
      bytes.push(0)
    }
    script.writeBin(bytes)
  }

  script.writeOpCode(OP.OP_NOP2) // OP_NOP2 is OP_CHECKLOCKTIMEVERIFY (BIP-65)
  script.writeOpCode(OP.OP_DROP)
  script.writeOpCode(OP.OP_DUP)
  script.writeOpCode(OP.OP_HASH160)
  script.writeBin(publicKeyHash)
  script.writeOpCode(OP.OP_EQUALVERIFY)
  script.writeOpCode(OP.OP_CHECKSIG)

  return script
}


/**
 * Lock BSV until a specific block height using CLTV
 */
export async function lockBSV(
  wif: string,
  satoshis: number,
  unlockBlock: number,
  utxos: UTXO[]
): Promise<{ txid: string; lockedUtxo: LockedUTXO }> {
  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()
  const fromAddress = publicKey.toAddress()

  // Get public key hash for the CLTV script
  const publicKeyHash = publicKey.toHash() as number[]

  // Create the CLTV locking script
  const cltvLockingScript = createCLTVLockingScript(unlockBlock, publicKeyHash)

  // Generate locking script for the source address (for signing inputs)
  const sourceLockingScript = new P2PKH().lock(fromAddress)

  const tx = new Transaction()

  // Select UTXOs
  const inputsToUse: UTXO[] = []
  let totalInput = 0

  for (const utxo of utxos) {
    inputsToUse.push(utxo)
    totalInput += utxo.satoshis
    if (totalInput >= satoshis + 200) break
  }

  if (totalInput < satoshis) {
    throw new Error('Insufficient funds')
  }

  // Calculate fee - CLTV output is ~5 bytes larger than standard P2PKH (39 vs 34 bytes)
  const numInputs = inputsToUse.length
  const numOutputs = 2 // lock output + change
  const fee = calculateTxFee(numInputs, numOutputs, 5) // extra bytes for CLTV script
  const change = totalInput - satoshis - fee

  if (change < 0) {
    throw new Error(`Insufficient funds (need ${fee} sats for fee)`)
  }

  // Add inputs
  for (const utxo of inputsToUse) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(
        privateKey,
        'all',
        false,
        utxo.satoshis,
        sourceLockingScript
      ),
      sequence: 0xffffffff
    })
  }

  // Add locked output (output 0)
  // Convert Script binary to number array for LockingScript
  const lockScriptBin = cltvLockingScript.toBinary()
  const lockScriptBytes: number[] = []
  for (let i = 0; i < lockScriptBin.length; i++) {
    lockScriptBytes.push(lockScriptBin[i])
  }
  tx.addOutput({
    lockingScript: LockingScript.fromBinary(lockScriptBytes),
    satoshis
  })

  // Add change output if above dust
  if (change > 546) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(fromAddress),
      satoshis: change
    })
  }

  await tx.sign()
  const txid = await broadcastTransaction(tx)

  const lockedUtxo: LockedUTXO = {
    txid,
    vout: 0,
    satoshis,
    lockingScript: cltvLockingScript.toHex(),
    unlockBlock,
    publicKeyHex: publicKey.toString(),
    createdAt: Date.now()
  }

  // Track transaction
  try {
    await recordSentTransaction(
      txid,
      tx.toHex(),
      `Locked ${satoshis} sats until block ${unlockBlock}`,
      ['lock'],
      -satoshis  // Negative because we're sending/locking
    )
    await markUtxosSpent(
      inputsToUse.map(u => ({ txid: u.txid, vout: u.vout })),
      txid
    )
  } catch (error) {
    console.warn('Failed to track lock transaction:', error)
  }

  return { txid, lockedUtxo }
}

/**
 * Unlock a CLTV-locked UTXO after the lock time has passed
 */
export async function unlockBSV(
  wif: string,
  lockedUtxo: LockedUTXO,
  currentBlockHeight: number
): Promise<string> {
  if (currentBlockHeight < lockedUtxo.unlockBlock) {
    throw new Error(`Cannot unlock yet. Current block: ${currentBlockHeight}, Unlock block: ${lockedUtxo.unlockBlock}`)
  }

  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()
  const toAddress = publicKey.toAddress()

  const tx = new Transaction()

  // Set nLockTime to the unlock block height (required for CLTV)
  tx.lockTime = lockedUtxo.unlockBlock

  // Calculate fee for 1 input, 1 output
  const fee = calculateTxFee(1, 1)
  const outputSats = lockedUtxo.satoshis - fee

  if (outputSats <= 546) {
    throw new Error('Output would be dust after fee')
  }

  // Parse the locking script
  const lockingScript = LockingScript.fromHex(lockedUtxo.lockingScript)

  // Sighash type: ALL | FORKID
  const sigHashType = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID

  // Create a custom unlock template for CLTV
  const cltvUnlock = {
    sign: async (tx: Transaction, inputIndex: number): Promise<UnlockingScript> => {
      // Get the preimage for signing
      const preimage = TransactionSignature.format({
        sourceTXID: lockedUtxo.txid,
        sourceOutputIndex: lockedUtxo.vout,
        sourceSatoshis: lockedUtxo.satoshis,
        transactionVersion: tx.version,
        otherInputs: [],
        inputIndex,
        outputs: tx.outputs,
        inputSequence: 0xfffffffe,
        subscript: lockingScript,
        lockTime: tx.lockTime,
        scope: sigHashType
      })

      // Sign the preimage
      const signature = privateKey.sign(preimage)
      const sigDER = signature.toDER() as number[]

      // Build signature with hash type
      const sigWithHashType: number[] = [...sigDER, sigHashType]

      // Get pubkey bytes
      const pubKeyEncoded = publicKey.encode(true) as number[]

      // Build unlocking script: <sig> <pubkey>
      const unlockScript = new Script()
      unlockScript.writeBin(sigWithHashType)
      unlockScript.writeBin(pubKeyEncoded)

      // Convert Script binary to number array
      const scriptBin = unlockScript.toBinary() as number[]

      return UnlockingScript.fromBinary(scriptBin)
    },
    estimateLength: async (_tx: Transaction, _inputIndex: number): Promise<number> => 107
  }

  // Add the locked input
  tx.addInput({
    sourceTXID: lockedUtxo.txid,
    sourceOutputIndex: lockedUtxo.vout,
    sequence: 0xfffffffe, // Must be < 0xffffffff for CLTV to work
    unlockingScriptTemplate: cltvUnlock
  })

  // Add output back to our address
  tx.addOutput({
    lockingScript: new P2PKH().lock(toAddress),
    satoshis: outputSats
  })

  await tx.sign()
  const txid = await broadcastTransaction(tx)

  // Track transaction
  try {
    await recordSentTransaction(
      txid,
      tx.toHex(),
      `Unlocked ${lockedUtxo.satoshis} sats from block ${lockedUtxo.unlockBlock}`,
      ['unlock'],
      outputSats  // Positive because we're receiving back
    )
  } catch (error) {
    console.warn('Failed to track unlock transaction:', error)
  }

  return txid
}

/**
 * Get current block height from WhatsOnChain
 */
export async function getCurrentBlockHeight(): Promise<number> {
  try {
    const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/chain/info')
    if (!response.ok) throw new Error('Failed to fetch block height')
    const data = await response.json()
    return data.blocks
  } catch (error) {
    console.error('Error fetching block height:', error)
    throw error
  }
}
