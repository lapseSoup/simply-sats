import * as bip39 from 'bip39'
import { HD, Mnemonic, PrivateKey, PublicKey, P2PKH, Transaction, Script, LockingScript, UnlockingScript, TransactionSignature, Hash } from '@bsv/sdk'
import {
  getBalanceFromDatabase,
  getSpendableUtxosFromDatabase,
  recordSentTransaction,
  markUtxosSpent,
  BASKETS
} from './sync'
import { getDerivedAddresses } from './database'
import { encrypt, decrypt, isEncryptedData, isLegacyEncrypted, migrateLegacyData } from './crypto'

// Wallet type - simplified to just BRC-100/Yours standard
export type WalletType = 'yours'

// BRC-100 standard derivation paths (matching Yours Wallet exactly)
// See: https://github.com/yours-org/yours-wallet/blob/main/src/utils/constants.ts
const WALLET_PATHS = {
  yours: {
    wallet: "m/44'/236'/0'/1/0",    // BSV spending (DEFAULT_WALLET_PATH)
    ordinals: "m/44'/236'/1'/0/0",   // Ordinals (DEFAULT_ORD_PATH)
    identity: "m/0'/236'/0'/0/0"     // Identity/BRC-100 authentication (DEFAULT_IDENTITY_PATH)
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

// Calculate amount for a transaction relative to an address or array of addresses (positive = received, negative = sent)
// This is async because we may need to fetch previous tx details to get input amounts
export async function calculateTxAmount(txDetails: any, addressOrAddresses: string | string[]): Promise<number> {
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
      received += Math.round(vout.value * 100000000)
    }
  }

  // Check inputs - WoC doesn't include prevout by default, so we need to fetch previous txs
  for (const vin of txDetails.vin) {
    // First check if prevout is available (some APIs include it)
    if (isOurAddress(vin.prevout?.scriptPubKey?.addresses)) {
      sent += Math.round(vin.prevout.value * 100000000)
    } else if (vin.txid && vin.vout !== undefined) {
      // Fetch the previous transaction to check if the spent output was ours
      try {
        const prevTx = await getTransactionDetails(vin.txid)
        if (prevTx?.vout?.[vin.vout]) {
          const prevOutput = prevTx.vout[vin.vout]
          if (isOurAddress(prevOutput.scriptPubKey?.addresses)) {
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

// Default fee rate: 0.071 sat/byte (71 sat/KB) - most miners accept this
const DEFAULT_FEE_RATE = 0.071

// Get the current fee rate from settings or use default
export function getFeeRate(): number {
  const stored = localStorage.getItem('simply_sats_fee_rate')
  if (stored) {
    const rate = parseFloat(stored)
    if (!isNaN(rate) && rate > 0) return rate
  }
  return DEFAULT_FEE_RATE
}

// Set the fee rate (in sats/byte)
export function setFeeRate(rate: number): void {
  localStorage.setItem('simply_sats_fee_rate', String(rate))
}

// Get fee rate in sats/KB for display
export function getFeeRatePerKB(): number {
  return Math.round(getFeeRate() * 1000)
}

// Set fee rate from sats/KB input
export function setFeeRateFromKB(ratePerKB: number): void {
  setFeeRate(ratePerKB / 1000)
}

// Calculate fee from exact byte size
export function feeFromBytes(bytes: number, customFeeRate?: number): number {
  const rate = customFeeRate ?? getFeeRate()
  return Math.max(1, Math.ceil(bytes * rate))
}

// Calculate varint size for a given length
function varintSize(n: number): number {
  if (n < 0xfd) return 1
  if (n <= 0xffff) return 3
  if (n <= 0xffffffff) return 5
  return 9
}

// Standard P2PKH sizes
const P2PKH_INPUT_SIZE = 148  // outpoint 36 + scriptlen 1 + scriptsig ~107 + sequence 4
const P2PKH_OUTPUT_SIZE = 34  // value 8 + scriptlen 1 + script 25
const TX_OVERHEAD = 10        // version 4 + locktime 4 + input count ~1 + output count ~1

// Calculate transaction fee for standard P2PKH inputs/outputs
export function calculateTxFee(numInputs: number, numOutputs: number, extraBytes = 0): number {
  const txSize = TX_OVERHEAD + (numInputs * P2PKH_INPUT_SIZE) + (numOutputs * P2PKH_OUTPUT_SIZE) + extraBytes
  return feeFromBytes(txSize)
}

// Calculate the exact fee for a lock transaction using actual script size
export function calculateLockFee(numInputs: number, timelockScriptSize?: number): number {
  // If no script size provided, use the actual size from our timelock script
  // The script is built from LOCKUP_PREFIX + pkh (20 bytes) + nLockTime (3-4 bytes) + LOCKUP_SUFFIX
  // Actual measured size is ~1090 bytes
  const scriptSize = timelockScriptSize ?? 1090

  // Lock output: value (8) + varint for script length + script
  const lockOutputSize = 8 + varintSize(scriptSize) + scriptSize
  // Change output: standard P2PKH
  const changeOutputSize = P2PKH_OUTPUT_SIZE

  const txSize = TX_OVERHEAD + (numInputs * P2PKH_INPUT_SIZE) + lockOutputSize + changeOutputSize
  return feeFromBytes(txSize)
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

// Broadcast a signed transaction - try multiple endpoints for non-standard scripts
async function broadcastTransaction(tx: Transaction): Promise<string> {
  const txhex = tx.toHex()
  console.log('Broadcasting transaction:', txhex)

  const errors: string[] = []

  // Try WhatsOnChain first
  try {
    console.log('Trying WhatsOnChain...')
    const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txhex })
    })

    if (response.ok) {
      console.log('WhatsOnChain broadcast successful!')
      return tx.id('hex')
    }

    const errorText = await response.text()
    console.warn('WoC broadcast failed:', errorText)
    errors.push(`WoC: ${errorText}`)
  } catch (error) {
    console.warn('WoC error:', error)
    errors.push(`WoC: ${error}`)
  }

  // Try GorillaPool ARC with skipScriptFlags in JSON body to bypass DISCOURAGE_UPGRADABLE_NOPS policy
  try {
    console.log('Trying GorillaPool ARC with skipScriptFlags in body...')
    const arcResponse = await fetch('https://arc.gorillapool.io/v1/tx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SkipScriptFlags': 'DISCOURAGE_UPGRADABLE_NOPS'
      },
      body: JSON.stringify({
        rawTx: txhex,
        skipScriptFlags: ['DISCOURAGE_UPGRADABLE_NOPS']
      })
    })

    const arcResult = await arcResponse.json()
    console.log('GorillaPool ARC response:', arcResult)

    // ARC returns status 200 even for errors, check txStatus
    if (arcResult.txid && (arcResult.txStatus === 'SEEN_ON_NETWORK' || arcResult.txStatus === 'ACCEPTED')) {
      console.log('ARC broadcast successful! txid:', arcResult.txid)
      return arcResult.txid
    } else if (arcResult.txid && !arcResult.detail) {
      // Sometimes ARC returns just txid on success
      console.log('ARC broadcast possibly successful, txid:', arcResult.txid)
      return arcResult.txid
    } else {
      const errorMsg = arcResult.detail || arcResult.extraInfo || arcResult.title || 'Unknown ARC error'
      console.warn('ARC rejected transaction:', errorMsg)
      errors.push(`ARC: ${errorMsg}`)
    }
  } catch (error) {
    console.warn('GorillaPool ARC error:', error)
    errors.push(`ARC: ${error}`)
  }

  // Try ARC with plain text format but with skipscriptflags header
  try {
    console.log('Trying GorillaPool ARC (plain text with header)...')
    const arcResponse2 = await fetch('https://arc.gorillapool.io/v1/tx', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'X-SkipScriptFlags': 'DISCOURAGE_UPGRADABLE_NOPS'
      },
      body: txhex
    })

    const arcResult2 = await arcResponse2.json()
    console.log('GorillaPool ARC (plain) response:', arcResult2)

    if (arcResult2.txid && (arcResult2.txStatus === 'SEEN_ON_NETWORK' || arcResult2.txStatus === 'ACCEPTED')) {
      console.log('ARC broadcast successful! txid:', arcResult2.txid)
      return arcResult2.txid
    } else if (arcResult2.txid && !arcResult2.detail) {
      console.log('ARC broadcast possibly successful, txid:', arcResult2.txid)
      return arcResult2.txid
    } else {
      const errorMsg = arcResult2.detail || arcResult2.extraInfo || arcResult2.title || 'Unknown ARC error'
      console.warn('ARC (plain) rejected transaction:', errorMsg)
      errors.push(`ARC2: ${errorMsg}`)
    }
  } catch (error) {
    console.warn('GorillaPool ARC (plain) error:', error)
    errors.push(`ARC2: ${error}`)
  }

  // Try GorillaPool mAPI as fallback
  try {
    console.log('Trying GorillaPool mAPI...')
    const mapiResponse = await fetch('https://mapi.gorillapool.io/mapi/tx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ rawtx: txhex })
    })

    const result = await mapiResponse.json()
    console.log('GorillaPool mAPI response:', result)

    // mAPI wraps response in payload
    if (result.payload) {
      const payload = typeof result.payload === 'string' ? JSON.parse(result.payload) : result.payload
      console.log('mAPI payload:', payload)

      // Check for success - returnResult must be "success"
      if (payload.returnResult === 'success' && payload.txid) {
        console.log('mAPI broadcast successful! txid:', payload.txid)
        return payload.txid
      } else {
        // Failed - extract error message
        const errorMsg = payload.resultDescription || payload.returnResult || 'Unknown mAPI error'
        console.warn('mAPI rejected transaction:', errorMsg)
        errors.push(`mAPI: ${errorMsg}`)
      }
    } else {
      errors.push(`mAPI: No payload in response`)
    }
  } catch (error) {
    console.warn('mAPI error:', error)
    errors.push(`mAPI: ${error}`)
  }

  throw new Error(`Failed to broadcast: ${errors.join(' | ')}`)
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

  // Calculate fee based on actual transaction size using configured fee rate
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

// Extended UTXO type that includes WIF for multi-key spending
export interface ExtendedUTXO extends UTXO {
  wif: string
  address: string
}

/**
 * Get all spendable UTXOs from both default and derived baskets
 * Returns UTXOs with their associated WIFs for signing
 */
export async function getAllSpendableUTXOs(walletWif: string): Promise<ExtendedUTXO[]> {
  const result: ExtendedUTXO[] = []

  // Get UTXOs from default basket
  const defaultUtxos = await getSpendableUtxosFromDatabase(BASKETS.DEFAULT)
  const walletPrivKey = PrivateKey.fromWif(walletWif)
  const walletAddress = walletPrivKey.toPublicKey().toAddress()

  for (const u of defaultUtxos) {
    result.push({
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      script: u.lockingScript,
      wif: walletWif,
      address: walletAddress
    })
  }

  // Get UTXOs from derived basket with their WIFs
  const derivedUtxos = await getSpendableUtxosFromDatabase(BASKETS.DERIVED)
  const derivedAddresses = await getDerivedAddresses()

  for (const u of derivedUtxos) {
    // Find the derived address entry that matches this UTXO's locking script
    const derivedAddr = derivedAddresses.find(d => {
      const derivedLockingScript = new P2PKH().lock(d.address).toHex()
      return derivedLockingScript === u.lockingScript
    })

    if (derivedAddr) {
      result.push({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.lockingScript,
        wif: derivedAddr.privateKeyWif,
        address: derivedAddr.address
      })
    }
  }

  // Sort by satoshis (smallest first for efficient coin selection)
  return result.sort((a, b) => a.satoshis - b.satoshis)
}

/**
 * Send BSV using UTXOs from multiple addresses/keys
 * Supports spending from both default wallet and derived addresses
 */
export async function sendBSVMultiKey(
  changeWif: string,  // WIF for change output (usually wallet WIF)
  toAddress: string,
  satoshis: number,
  utxos: ExtendedUTXO[]
): Promise<string> {
  const changePrivKey = PrivateKey.fromWif(changeWif)
  const changeAddress = changePrivKey.toPublicKey().toAddress()

  const tx = new Transaction()

  // Collect inputs we'll use
  const inputsToUse: ExtendedUTXO[] = []
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

  // Calculate fee
  const numInputs = inputsToUse.length
  const prelimChange = totalInput - satoshis
  const willHaveChange = prelimChange > 100
  const numOutputs = willHaveChange ? 2 : 1
  const fee = calculateTxFee(numInputs, numOutputs)

  const change = totalInput - satoshis - fee

  if (change < 0) {
    throw new Error(`Insufficient funds (need ${fee} sats for fee)`)
  }

  // Add inputs - each with its own key
  for (const utxo of inputsToUse) {
    const inputPrivKey = PrivateKey.fromWif(utxo.wif)
    const inputLockingScript = new P2PKH().lock(utxo.address)

    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(
        inputPrivKey,
        'all',
        false,
        utxo.satoshis,
        inputLockingScript
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
      lockingScript: new P2PKH().lock(changeAddress),
      satoshis: change
    })
  }

  await tx.sign()
  const txid = await broadcastTransaction(tx)

  // Track transaction locally
  try {
    await recordSentTransaction(
      txid,
      tx.toHex(),
      `Sent ${satoshis} sats to ${toAddress}`,
      ['send']
    )

    await markUtxosSpent(
      inputsToUse.map(u => ({ txid: u.txid, vout: u.vout })),
      txid
    )

    console.log('Transaction tracked locally:', txid)
  } catch (error) {
    console.warn('Failed to track transaction locally:', error)
  }

  return txid
}

// Storage helpers
const STORAGE_KEY = 'simply_sats_wallet'

/**
 * Save wallet keys with proper AES-GCM encryption
 *
 * @param keys - Wallet keys to save
 * @param password - Password for encryption
 */
export async function saveWallet(keys: WalletKeys, password: string): Promise<void> {
  if (!password || password.length < 4) {
    throw new Error('Password must be at least 4 characters')
  }

  const encryptedData = await encrypt(keys, password)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(encryptedData))
}

/**
 * Load wallet keys with decryption
 *
 * Handles both new encrypted format and legacy base64 format.
 * If legacy format is detected, it will be migrated to the new format.
 *
 * @param password - Password for decryption
 * @returns WalletKeys or null if not found
 * @throws Error if password is wrong or data is corrupted
 */
export async function loadWallet(password: string): Promise<WalletKeys | null> {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return null

  try {
    // Try to parse as JSON (new format)
    const parsed = JSON.parse(stored)

    if (isEncryptedData(parsed)) {
      // New encrypted format - decrypt it
      const decrypted = await decrypt(parsed, password)
      return JSON.parse(decrypted)
    }

    // If it's a plain object with wallet keys (shouldn't happen, but handle it)
    if (parsed.mnemonic && parsed.walletWif) {
      console.warn('Found unencrypted wallet data - this should not happen')
      // Re-save with encryption
      await saveWallet(parsed, password)
      return parsed
    }
  } catch (e) {
    // Not valid JSON - might be legacy format
  }

  // Try legacy base64 format
  if (isLegacyEncrypted(stored)) {
    console.log('Migrating legacy wallet format to secure encryption...')
    try {
      // Decode the old format
      const decoded = atob(stored)
      const keys = JSON.parse(decoded) as WalletKeys

      // Migrate to new encrypted format
      const encryptedData = await migrateLegacyData(stored, password)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(encryptedData))

      console.log('Wallet migrated to secure encryption successfully')
      return keys
    } catch {
      // Legacy decoding failed
      throw new Error('Failed to load wallet - data may be corrupted')
    }
  }

  return null
}

/**
 * Check if a wallet exists in storage
 */
export function hasWallet(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null
}

/**
 * Clear wallet from storage
 */
export function clearWallet(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Change the wallet password
 *
 * @param oldPassword - Current password
 * @param newPassword - New password
 * @returns true if successful
 * @throws Error if old password is wrong
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
  if (!newPassword || newPassword.length < 4) {
    throw new Error('New password must be at least 4 characters')
  }

  const keys = await loadWallet(oldPassword)
  if (!keys) {
    throw new Error('Wrong password or wallet not found')
  }

  await saveWallet(keys, newPassword)
  return true
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
// Time Lock Functions (OP_PUSH_TX technique)
// Based on jdh7190's bsv-lock: https://github.com/jdh7190/bsv-lock
// Uses sCrypt-compiled script that validates preimage on-chain
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

// sCrypt-compiled timelock script components from bsv-lock
// This script uses OP_PUSH_TX to validate the transaction preimage on-chain,
// checking that nLockTime >= the specified block height
const LOCKUP_PREFIX = `97dfd76851bf465e8f715593b217714858bbe9570ff3bd5e33840a34e20ff026 02ba79df5f8ae7604a9830f03c7933028186aede0675a16f025dc4f8be8eec0382 1008ce7480da41702918d1ec8e6849ba32b4d65b1e40dc669c31a1e6306b266c 0 0`
const LOCKUP_SUFFIX = `OP_NOP 0 OP_PICK 0065cd1d OP_LESSTHAN OP_VERIFY 0 OP_PICK OP_4 OP_ROLL OP_DROP OP_3 OP_ROLL OP_3 OP_ROLL OP_3 OP_ROLL OP_1 OP_PICK OP_3 OP_ROLL OP_DROP OP_2 OP_ROLL OP_2 OP_ROLL OP_DROP OP_DROP OP_NOP OP_5 OP_PICK 41 OP_NOP OP_1 OP_PICK OP_7 OP_PICK OP_7 OP_PICK 0ac407f0e4bd44bfc207355a778b046225a7068fc59ee7eda43ad905aadbffc800 6c266b30e6a1319c66dc401e5bd6b432ba49688eecd118297041da8074ce0810 OP_9 OP_PICK OP_6 OP_PICK OP_NOP OP_6 OP_PICK OP_HASH256 0 OP_PICK OP_NOP 0 OP_PICK OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT 00 OP_CAT OP_BIN2NUM OP_1 OP_ROLL OP_DROP OP_NOP OP_7 OP_PICK OP_6 OP_PICK OP_6 OP_PICK OP_6 OP_PICK OP_6 OP_PICK OP_NOP OP_3 OP_PICK OP_6 OP_PICK OP_4 OP_PICK OP_7 OP_PICK OP_MUL OP_ADD OP_MUL 414136d08c5ed2bf3ba048afe6dcaebafeffffffffffffffffffffffffffffff00 OP_1 OP_PICK OP_1 OP_PICK OP_NOP OP_1 OP_PICK OP_1 OP_PICK OP_MOD 0 OP_PICK 0 OP_LESSTHAN OP_IF 0 OP_PICK OP_2 OP_PICK OP_ADD OP_ELSE 0 OP_PICK OP_ENDIF OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_2 OP_ROLL OP_DROP OP_1 OP_ROLL OP_1 OP_PICK OP_1 OP_PICK OP_2 OP_DIV OP_GREATERTHAN OP_IF 0 OP_PICK OP_2 OP_PICK OP_SUB OP_2 OP_ROLL OP_DROP OP_1 OP_ROLL OP_ENDIF OP_3 OP_PICK OP_SIZE OP_NIP OP_2 OP_PICK OP_SIZE OP_NIP OP_3 OP_PICK 20 OP_NUM2BIN OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT 20 OP_2 OP_PICK OP_SUB OP_SPLIT OP_NIP OP_4 OP_3 OP_PICK OP_ADD OP_2 OP_PICK OP_ADD 30 OP_1 OP_PICK OP_CAT OP_2 OP_CAT OP_4 OP_PICK OP_CAT OP_8 OP_PICK OP_CAT OP_2 OP_CAT OP_3 OP_PICK OP_CAT OP_2 OP_PICK OP_CAT OP_7 OP_PICK OP_CAT 0 OP_PICK OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP 0 OP_PICK OP_7 OP_PICK OP_CHECKSIG OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_VERIFY OP_5 OP_PICK OP_NOP 0 OP_PICK OP_NOP 0 OP_PICK OP_SIZE OP_NIP OP_1 OP_PICK OP_1 OP_PICK OP_4 OP_SUB OP_SPLIT OP_DROP OP_1 OP_PICK OP_8 OP_SUB OP_SPLIT OP_NIP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_NOP 0 OP_PICK 00 OP_CAT OP_BIN2NUM OP_1 OP_ROLL OP_DROP OP_NOP OP_1 OP_ROLL OP_DROP OP_NOP 0065cd1d OP_LESSTHAN OP_VERIFY OP_5 OP_PICK OP_NOP 0 OP_PICK OP_NOP 0 OP_PICK OP_SIZE OP_NIP OP_1 OP_PICK OP_1 OP_PICK 28 OP_SUB OP_SPLIT OP_DROP OP_1 OP_PICK 2c OP_SUB OP_SPLIT OP_NIP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_NOP 0 OP_PICK 00 OP_CAT OP_BIN2NUM OP_1 OP_ROLL OP_DROP OP_NOP OP_1 OP_ROLL OP_DROP OP_NOP ffffffff00 OP_LESSTHAN OP_VERIFY OP_5 OP_PICK OP_NOP 0 OP_PICK OP_NOP 0 OP_PICK OP_SIZE OP_NIP OP_1 OP_PICK OP_1 OP_PICK OP_4 OP_SUB OP_SPLIT OP_DROP OP_1 OP_PICK OP_8 OP_SUB OP_SPLIT OP_NIP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_NOP 0 OP_PICK 00 OP_CAT OP_BIN2NUM OP_1 OP_ROLL OP_DROP OP_NOP OP_1 OP_ROLL OP_DROP OP_NOP OP_2 OP_PICK OP_GREATERTHANOREQUAL OP_VERIFY OP_6 OP_PICK OP_HASH160 OP_1 OP_PICK OP_EQUAL OP_VERIFY OP_7 OP_PICK OP_7 OP_PICK OP_CHECKSIG OP_NIP OP_NIP OP_NIP OP_NIP OP_NIP OP_NIP OP_NIP OP_NIP`

// Helper: convert integer to little-endian hex
function int2Hex(n: number): string {
  if (n === 0) return '00'
  let hex = n.toString(16)
  if (hex.length % 2) hex = '0' + hex
  // Reverse bytes for little-endian
  const bytes = hex.match(/.{2}/g) || []
  return bytes.reverse().join('')
}

// Helper: convert little-endian hex to integer (kept for potential future use in extracting block height from scripts)
function _hex2Int(hex: string): number {
  const bytes = hex.match(/.{2}/g) || []
  const reversed = bytes.reverse().join('')
  return parseInt(reversed, 16)
}
// Export to prevent unused warning
export { _hex2Int as hex2Int }

/**
 * Create the OP_PUSH_TX timelock locking script
 * This script validates the transaction preimage on-chain and checks nLockTime
 */
function createTimelockScript(publicKeyHash: string, blockHeight: number): Script {
  const nLockTimeHex = int2Hex(blockHeight)
  const scriptASM = `${LOCKUP_PREFIX} ${publicKeyHash} ${nLockTimeHex} ${LOCKUP_SUFFIX}`
  return Script.fromASM(scriptASM)
}

/**
 * Get the exact size of a timelock script for a given public key and block height
 * This allows accurate fee calculation before creating the transaction
 */
export function getTimelockScriptSize(publicKeyHex: string, blockHeight: number): number {
  const publicKey = PublicKey.fromString(publicKeyHex)
  const publicKeyHashBytes = publicKey.toHash() as number[]
  const publicKeyHashHex = publicKeyHashBytes.map(b => b.toString(16).padStart(2, '0')).join('')
  const script = createTimelockScript(publicKeyHashHex, blockHeight)
  return script.toBinary().length
}


/**
 * Lock BSV until a specific block height using OP_PUSH_TX technique
 * Based on jdh7190's bsv-lock implementation
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

  // Get public key hash as hex string for the timelock script
  const publicKeyHashBytes = publicKey.toHash() as number[]
  const publicKeyHashHex = publicKeyHashBytes.map(b => b.toString(16).padStart(2, '0')).join('')

  // Create the OP_PUSH_TX timelock locking script
  const timelockScript = createTimelockScript(publicKeyHashHex, unlockBlock)

  // Generate locking script for the source address (for signing inputs)
  const sourceLockingScript = new P2PKH().lock(fromAddress)

  const tx = new Transaction()

  // Select UTXOs
  const inputsToUse: UTXO[] = []
  let totalInput = 0

  for (const utxo of utxos) {
    inputsToUse.push(utxo)
    totalInput += utxo.satoshis
    if (totalInput >= satoshis + 500) break // timelock script is larger, need more for fees
  }

  if (totalInput < satoshis) {
    throw new Error('Insufficient funds')
  }

  // Calculate fee using actual script size
  const numInputs = inputsToUse.length
  const timelockScriptSize = timelockScript.toBinary().length
  const fee = calculateLockFee(numInputs, timelockScriptSize)
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
  const lockScriptBin = timelockScript.toBinary()
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
    lockingScript: timelockScript.toHex(),
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
 * Unlock a locked UTXO using OP_PUSH_TX technique
 *
 * The solution script is: <signature> <publicKey> <preimage>
 * The preimage is the BIP-143 sighash preimage that the script validates on-chain
 */
export async function unlockBSV(
  wif: string,
  lockedUtxo: LockedUTXO,
  currentBlockHeight: number
): Promise<string> {
  // Check block height for user feedback
  if (currentBlockHeight < lockedUtxo.unlockBlock) {
    throw new Error(`Cannot unlock yet. Current block: ${currentBlockHeight}, Unlock block: ${lockedUtxo.unlockBlock}`)
  }

  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()
  const toAddress = publicKey.toAddress()

  // Calculate fee for unlock transaction
  // The unlock tx is large because the preimage contains the full locking script (~1090 bytes)
  // Actual measured size is ~1290 bytes
  const lockingScriptSize = lockedUtxo.lockingScript.length / 2 // hex to bytes
  // TX structure: version(4) + inputCount(1) + outpoint(36) + unlockScript + sequence(4) +
  //               outputCount(1) + output(34) + locktime(4)
  // Unlock script: sig(~73) + pubkey(34) + preimage(~180 + lockingScriptSize)
  const unlockScriptSize = 73 + 34 + 180 + lockingScriptSize
  const txSize = 4 + 1 + 36 + 3 + unlockScriptSize + 4 + 1 + 34 + 4 // ~3 bytes for varint
  const fee = feeFromBytes(txSize)
  const outputSats = lockedUtxo.satoshis - fee

  if (outputSats <= 0) {
    throw new Error(`Insufficient funds to cover unlock fee (need ${fee} sats)`)
  }

  // Parse the locking script
  const lockingScript = LockingScript.fromHex(lockedUtxo.lockingScript)

  // SIGHASH_ALL | SIGHASH_FORKID for BSV
  const sigHashType = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
  const inputSequence = 0xfffffffe // < 0xffffffff to enable nLockTime

  // Build transaction
  const tx = new Transaction()
  tx.version = 1
  tx.lockTime = lockedUtxo.unlockBlock

  // Create custom unlock template that builds the preimage solution
  const customUnlockTemplate = {
    sign: async (tx: Transaction, inputIndex: number): Promise<UnlockingScript> => {
      console.log('Building OP_PUSH_TX unlock for input', inputIndex)
      console.log('nLockTime:', tx.lockTime)

      // Build the BIP-143 preimage - this is what the sCrypt script validates
      const preimage = TransactionSignature.format({
        sourceTXID: lockedUtxo.txid,
        sourceOutputIndex: lockedUtxo.vout,
        sourceSatoshis: lockedUtxo.satoshis,
        transactionVersion: tx.version,
        otherInputs: [],
        inputIndex: inputIndex,
        outputs: tx.outputs,
        inputSequence: inputSequence,
        subscript: lockingScript,
        lockTime: tx.lockTime,
        scope: sigHashType
      })

      const preimageBytes = preimage as number[]
      console.log('Preimage length:', preimageBytes.length)

      // Sign the preimage hash
      // The SDK's sign() does single SHA256 internally, so pass single hash
      const singleHash = Hash.sha256(preimage) as number[]
      const signature = privateKey.sign(singleHash)

      // Get DER-encoded signature with sighash type
      const sigDER = signature.toDER() as number[]
      const sigWithHashType: number[] = [...sigDER, sigHashType]

      // Get compressed public key
      const pubKeyBytes = publicKey.encode(true) as number[]

      console.log('Signature length:', sigWithHashType.length)
      console.log('PubKey length:', pubKeyBytes.length)

      // Build unlocking script: <signature> <publicKey> <preimage>
      // This is the format expected by the sCrypt timelock script
      const unlockScript = new Script()
      unlockScript.writeBin(sigWithHashType)
      unlockScript.writeBin(pubKeyBytes)
      unlockScript.writeBin(preimageBytes)

      const scriptBytes = unlockScript.toBinary() as number[]
      console.log('Unlocking script length:', scriptBytes.length)

      return UnlockingScript.fromBinary(scriptBytes)
    },
    estimateLength: async (): Promise<number> => 300 // sig + pubkey + preimage
  }

  // Add input with our custom unlock template
  tx.addInput({
    sourceTXID: lockedUtxo.txid,
    sourceOutputIndex: lockedUtxo.vout,
    sequence: inputSequence,
    unlockingScriptTemplate: customUnlockTemplate
  })

  // Add output back to our address
  tx.addOutput({
    lockingScript: new P2PKH().lock(toAddress),
    satoshis: outputSats
  })

  // Sign the transaction (calls our custom template)
  await tx.sign()

  console.log('=== FINAL TRANSACTION ===')
  console.log('Transaction hex:', tx.toHex())
  console.log('nLockTime:', tx.lockTime)
  console.log('Attempting to broadcast...')

  const txid = await broadcastTransaction(tx)

  // Track transaction
  try {
    await recordSentTransaction(
      txid,
      tx.toHex(),
      `Unlocked ${lockedUtxo.satoshis} sats`,
      ['unlock'],
      outputSats
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

/**
 * Generate the raw unlock transaction hex without broadcasting.
 * Uses OP_PUSH_TX technique with preimage in the solution.
 */
export async function generateUnlockTxHex(
  wif: string,
  lockedUtxo: LockedUTXO
): Promise<{ txHex: string; txid: string; outputSats: number }> {
  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()
  const toAddress = publicKey.toAddress()

  // Calculate fee for unlock transaction
  // The unlock tx is large because the preimage contains the full locking script (~1090 bytes)
  // Actual measured size is ~1290 bytes
  const lockingScriptSize = lockedUtxo.lockingScript.length / 2 // hex to bytes
  const unlockScriptSize = 73 + 34 + 180 + lockingScriptSize
  const txSize = 4 + 1 + 36 + 3 + unlockScriptSize + 4 + 1 + 34 + 4
  const fee = feeFromBytes(txSize)
  const outputSats = lockedUtxo.satoshis - fee

  if (outputSats <= 0) {
    throw new Error(`Insufficient funds to cover unlock fee (need ${fee} sats)`)
  }

  // Parse the locking script
  const lockingScript = LockingScript.fromHex(lockedUtxo.lockingScript)

  // SIGHASH_ALL | SIGHASH_FORKID for BSV
  const sigHashType = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
  const inputSequence = 0xfffffffe

  // Build transaction
  const tx = new Transaction()
  tx.version = 1
  tx.lockTime = lockedUtxo.unlockBlock

  // Create unlock template with preimage
  const customUnlockTemplate = {
    sign: async (tx: Transaction, inputIndex: number): Promise<UnlockingScript> => {
      // Build the BIP-143 preimage
      const preimage = TransactionSignature.format({
        sourceTXID: lockedUtxo.txid,
        sourceOutputIndex: lockedUtxo.vout,
        sourceSatoshis: lockedUtxo.satoshis,
        transactionVersion: tx.version,
        otherInputs: [],
        inputIndex: inputIndex,
        outputs: tx.outputs,
        inputSequence: inputSequence,
        subscript: lockingScript,
        lockTime: tx.lockTime,
        scope: sigHashType
      })

      const preimageBytes = preimage as number[]

      // Sign the preimage hash
      const singleHash = Hash.sha256(preimage) as number[]
      const signature = privateKey.sign(singleHash)

      const sigDER = signature.toDER() as number[]
      const sigWithHashType: number[] = [...sigDER, sigHashType]
      const pubKeyBytes = publicKey.encode(true) as number[]

      // Build unlocking script: <signature> <publicKey> <preimage>
      const unlockScript = new Script()
      unlockScript.writeBin(sigWithHashType)
      unlockScript.writeBin(pubKeyBytes)
      unlockScript.writeBin(preimageBytes)

      const scriptBytes = unlockScript.toBinary() as number[]
      return UnlockingScript.fromBinary(scriptBytes)
    },
    estimateLength: async (): Promise<number> => 300
  }

  tx.addInput({
    sourceTXID: lockedUtxo.txid,
    sourceOutputIndex: lockedUtxo.vout,
    sequence: inputSequence,
    unlockingScriptTemplate: customUnlockTemplate
  })

  tx.addOutput({
    lockingScript: new P2PKH().lock(toAddress),
    satoshis: outputSats
  })

  await tx.sign()

  return {
    txHex: tx.toHex(),
    txid: tx.id('hex'),
    outputSats
  }
}

// Timelock script signature - the first 32-byte constant from LOCKUP_PREFIX
// When assembled, it becomes 0x20 (push 32 bytes) followed by this hex
const TIMELOCK_SCRIPT_SIGNATURE = '2097dfd76851bf465e8f715593b217714858bbe9570ff3bd5e33840a34e20ff026'

/**
 * Parse a timelock script to extract the unlock block height and public key hash
 * Returns null if the script is not a recognized timelock script
 */
function parseTimelockScript(scriptHex: string): { unlockBlock: number; publicKeyHash: string } | null {
  // Check if script starts with our timelock signature
  if (!scriptHex.startsWith(TIMELOCK_SCRIPT_SIGNATURE)) {
    return null
  }

  try {
    // Script structure after the prefix constants:
    // LOCKUP_PREFIX (known pattern) + publicKeyHash (20 bytes) + nLockTime (variable) + LOCKUP_SUFFIX
    //
    // The script ASM is: PREFIX pkh nLockTime SUFFIX
    // After PREFIX (which is multiple constants totaling 134 bytes when assembled):
    // - 0x14 (push 20 bytes) + 20-byte pkh = 21 bytes
    // - Variable push for nLockTime (1-5 bytes depending on value)

    // The prefix when assembled is a fixed pattern. After the three 32-byte constants and two zeros:
    // 0x20 (32 bytes) + const1 + 0x21 (33 bytes) + const2 + 0x20 (32 bytes) + const3 + 0x00 + 0x00
    // Total prefix hex length: 2 + 64 + 2 + 66 + 2 + 64 + 2 + 2 = 204 chars (102 bytes)
    const prefixHexLen = 204

    // After prefix comes: 0x14 (1 byte) + pkh (20 bytes) = 42 hex chars
    const pkhStart = prefixHexLen
    const pkhPushByte = scriptHex.substring(pkhStart, pkhStart + 2)

    if (pkhPushByte !== '14') {
      // Not the expected 20-byte push
      return null
    }

    const publicKeyHash = scriptHex.substring(pkhStart + 2, pkhStart + 2 + 40)

    // After pkh comes the nLockTime push
    const nLockTimeStart = pkhStart + 42
    const nLockTimePushByte = scriptHex.substring(nLockTimeStart, nLockTimeStart + 2)
    const pushLen = parseInt(nLockTimePushByte, 16)

    if (pushLen > 4) {
      // nLockTime shouldn't be more than 4 bytes
      return null
    }

    const nLockTimeHex = scriptHex.substring(nLockTimeStart + 2, nLockTimeStart + 2 + pushLen * 2)

    // Convert little-endian hex to number
    const bytes = nLockTimeHex.match(/.{2}/g) || []
    const unlockBlock = parseInt(bytes.reverse().join(''), 16)

    return { unlockBlock, publicKeyHash }
  } catch (error) {
    console.error('Error parsing timelock script:', error)
    return null
  }
}

/**
 * Check if a UTXO is still unspent
 */
async function isUtxoUnspent(txid: string, vout: number): Promise<boolean> {
  try {
    const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}`)
    if (!response.ok) return false

    const txData = await response.json()
    const output = txData.vout?.[vout]

    // If the output has a spent txid, it's been spent
    if (output?.spent) {
      return false
    }

    // Also check via the direct spent endpoint
    const spentResponse = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}/${vout}/spent`)
    if (spentResponse.ok) {
      const spentData = await spentResponse.json()
      // If we get spending info, it's spent
      if (spentData && spentData.txid) {
        return false
      }
    }

    return true
  } catch {
    // Assume unspent if we can't determine
    return true
  }
}

/**
 * Scan transaction history to detect locked UTXOs
 * This is used during wallet restoration to reconstruct the locks list
 */
export async function detectLockedUtxos(
  walletAddress: string,
  publicKeyHex: string
): Promise<LockedUTXO[]> {
  console.log('Scanning transaction history for locked UTXOs...')

  const detectedLocks: LockedUTXO[] = []

  try {
    // Get transaction history for the wallet address
    const history = await getTransactionHistory(walletAddress)

    if (!history || history.length === 0) {
      console.log('No transaction history found')
      return []
    }

    console.log(`Checking ${history.length} transactions for locks...`)

    // Calculate expected public key hash from the provided public key
    const publicKey = PublicKey.fromString(publicKeyHex)
    const expectedPkhBytes = publicKey.toHash() as number[]
    const expectedPkh = expectedPkhBytes.map(b => b.toString(16).padStart(2, '0')).join('')

    // Check each transaction for timelock outputs
    for (const historyItem of history) {
      const txid = historyItem.tx_hash

      try {
        const txDetails = await getTransactionDetails(txid)
        if (!txDetails?.vout) continue

        // Check each output for timelock script
        for (let vout = 0; vout < txDetails.vout.length; vout++) {
          const output = txDetails.vout[vout]
          const scriptHex = output.scriptPubKey?.hex

          if (!scriptHex) continue

          const parsed = parseTimelockScript(scriptHex)
          if (!parsed) continue

          // Verify the lock belongs to this wallet
          if (parsed.publicKeyHash !== expectedPkh) {
            console.log(`Found lock but PKH doesn't match (different wallet)`)
            continue
          }

          // Check if still unspent
          const unspent = await isUtxoUnspent(txid, vout)
          if (!unspent) {
            console.log(`Lock ${txid}:${vout} has been spent (unlocked)`)
            continue
          }

          const satoshis = Math.round(output.value * 100000000)

          console.log(`Found active lock: ${txid}:${vout} - ${satoshis} sats until block ${parsed.unlockBlock}`)

          detectedLocks.push({
            txid,
            vout,
            satoshis,
            lockingScript: scriptHex,
            unlockBlock: parsed.unlockBlock,
            publicKeyHex,
            createdAt: txDetails.time ? txDetails.time * 1000 : Date.now()
          })
        }
      } catch (error) {
        console.warn(`Error processing tx ${txid}:`, error)
      }
    }

    console.log(`Detected ${detectedLocks.length} active lock(s)`)
    return detectedLocks
  } catch (error) {
    console.error('Error detecting locked UTXOs:', error)
    return []
  }
}
