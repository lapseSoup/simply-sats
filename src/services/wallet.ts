import * as bip39 from 'bip39'
import { HD, Mnemonic, PrivateKey, P2PKH, Transaction } from '@bsv/sdk'

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

// Get balance from WhatsOnChain
export async function getBalance(address: string): Promise<number> {
  const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/balance`)
  const data = await response.json()
  return data.confirmed + data.unconfirmed
}

// Get UTXOs from WhatsOnChain
export async function getUTXOs(address: string): Promise<UTXO[]> {
  const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`)
  const data = await response.json()
  return data.map((utxo: any) => ({
    txid: utxo.tx_hash,
    vout: utxo.tx_pos,
    satoshis: utxo.value,
    script: ''
  }))
}

// Get transaction history
export async function getTransactionHistory(address: string): Promise<any[]> {
  const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/history`)
  return response.json()
}

// Build and sign a simple P2PKH transaction
export async function sendBSV(
  wif: string,
  toAddress: string,
  satoshis: number,
  utxos: UTXO[]
): Promise<string> {
  const privateKey = PrivateKey.fromWif(wif)
  const fromAddress = privateKey.toPublicKey().toAddress()

  const tx = new Transaction()

  // Add inputs
  let totalInput = 0
  for (const utxo of utxos) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(privateKey)
    } as any)
    totalInput += utxo.satoshis

    if (totalInput >= satoshis + 200) break
  }

  // Add output to recipient
  tx.addOutput({
    lockingScript: new P2PKH().lock(toAddress),
    satoshis
  })

  // Add change output if needed
  const fee = Math.ceil(tx.toBinary().length * 1) // 1 sat/byte
  const change = totalInput - satoshis - fee
  if (change > 546) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(fromAddress),
      satoshis: change
    })
  }

  await tx.sign()

  // Broadcast
  const broadcastResponse = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: tx.toHex() })
  })

  if (!broadcastResponse.ok) {
    throw new Error('Failed to broadcast transaction')
  }

  return tx.id('hex')
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
  const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`)
  const utxos = await response.json()

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
