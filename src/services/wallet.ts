import * as bip39 from 'bip39'
import { HD, Mnemonic, PrivateKey, P2PKH, Transaction, SatoshisPerKilobyte } from '@bsv/sdk'

// Wallet type for different derivation paths
export type WalletType = 'yours' | 'handcash' | 'relayx' | 'legacy'

// Derivation paths for different wallet types
const WALLET_PATHS = {
  // Yours Wallet / BRC-100 standard
  yours: {
    wallet: "m/44'/236'/0'/0/0",
    ordinals: "m/44'/236'/0'/1/0",
    identity: "m/44'/236'/0'/2/0"
  },
  // HandCash uses standard BSV path
  handcash: {
    wallet: "m/44'/145'/0'/0/0",
    ordinals: "m/44'/145'/0'/0/1",
    identity: "m/44'/145'/0'/0/2"
  },
  // RelayX uses standard BTC path with BSV
  relayx: {
    wallet: "m/44'/0'/0'/0/0",
    ordinals: "m/44'/0'/0'/0/1",
    identity: "m/44'/0'/0'/0/2"
  },
  // Legacy/generic BSV (MoneyButton style)
  legacy: {
    wallet: "m/44'/0'/0'/0/0",
    ordinals: "m/44'/0'/0'/1/0",
    identity: "m/44'/0'/0'/2/0"
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

// Create new wallet with fresh mnemonic (always uses Yours/BRC-100 standard)
export function createWallet(): WalletKeys {
  const mnemonic = bip39.generateMnemonic()
  return restoreWallet(mnemonic, 'yours')
}

// Restore wallet from mnemonic with specified wallet type
export function restoreWallet(mnemonic: string, walletType: WalletType = 'yours'): WalletKeys {
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase')
  }

  const paths = WALLET_PATHS[walletType]
  const wallet = deriveKeys(mnemonic, paths.wallet)
  const ord = deriveKeys(mnemonic, paths.ordinals)
  const identity = deriveKeys(mnemonic, paths.identity)

  return {
    mnemonic,
    walletType,
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
}

// Auto-detect wallet type by checking balances on different derivation paths
export async function detectWalletType(mnemonic: string): Promise<{type: WalletType, balance: number}[]> {
  const results: {type: WalletType, balance: number}[] = []

  for (const type of ['yours', 'handcash', 'relayx', 'legacy'] as WalletType[]) {
    const paths = WALLET_PATHS[type]
    const wallet = deriveKeys(mnemonic, paths.wallet)
    try {
      const balance = await getBalance(wallet.address)
      results.push({ type, balance })
    } catch {
      results.push({ type, balance: 0 })
    }
  }

  // Sort by balance descending
  return results.sort((a, b) => b.balance - a.balance)
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
    script: '' // Will need to fetch this
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
    // Fetch the script for each UTXO
    const scriptResponse = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${utxo.txid}/hex`)
    const txHex = await scriptResponse.text()

    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      sourceSatoshis: utxo.satoshis,
      unlockingScriptTemplate: new P2PKH().unlock(privateKey)
    })
    totalInput += utxo.satoshis

    if (totalInput >= satoshis + 200) break // +200 for fee estimate
  }

  // Add output to recipient
  tx.addOutput({
    lockingScript: new P2PKH().lock(toAddress),
    satoshis
  })

  // Add change output if needed
  const fee = Math.ceil(tx.toBinary().length * 0.5) // 0.5 sat/byte
  const change = totalInput - satoshis - fee
  if (change > 546) { // dust limit
    tx.addOutput({
      lockingScript: new P2PKH().lock(fromAddress),
      satoshis: change
    })
  }

  // Sign
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

export function saveWallet(keys: WalletKeys, password: string): void {
  // In production, encrypt with password
  // For now, simple localStorage (will add encryption)
  const encrypted = btoa(JSON.stringify(keys)) // TODO: proper encryption
  localStorage.setItem(STORAGE_KEY, encrypted)
}

export function loadWallet(password: string): WalletKeys | null {
  const encrypted = localStorage.getItem(STORAGE_KEY)
  if (!encrypted) return null

  try {
    // TODO: proper decryption
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
  // Fetch UTXOs from the ordinals address
  const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`)
  const utxos = await response.json()

  const ordinals: Ordinal[] = []

  // 1Sat Ordinals are UTXOs with exactly 1 satoshi
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
