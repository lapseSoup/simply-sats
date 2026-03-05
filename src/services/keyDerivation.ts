/**
 * BRC-42/43 Key Derivation for Simply Sats
 *
 * Implements key derivation for receiving payments sent to your identity public key.
 * When someone sends to your public key, they derive a unique address using ECDH.
 * We need to derive the same addresses to find and spend those funds.
 *
 * All cryptographic operations are performed in Rust via Tauri commands.
 * Private keys never enter the JavaScript heap.
 */

import { isTauri, tauriInvoke } from '../utils/tauri'
import { STORAGE_KEYS } from '../infrastructure/storage/localStorage'

// ---------------------------------------------------------------------------
// Types returned by Tauri BRC-42/43 commands
// ---------------------------------------------------------------------------

/** Result of a BRC-42 child key derivation (from Rust) */
export interface DerivedKeyResult {
  wif: string
  address: string
  pubKey: string
}

/** Result of a batch address derivation (from Rust) */
export interface DerivedAddressResult {
  address: string
  senderPubKey: string
  invoiceNumber: string
}

// ---------------------------------------------------------------------------
// BRC-42 Key Derivation (via Tauri)
// ---------------------------------------------------------------------------

/**
 * Derive a child key using BRC-42 protocol via Tauri.
 *
 * Implements: ECDH(receiver_priv, sender_pub) → HMAC-SHA256(invoice) → scalar addition.
 * Returns the child WIF, address, and compressed public key hex.
 */
export async function deriveChildKey(
  receiverWif: string,
  senderPubKeyHex: string,
  invoiceNumber: string
): Promise<DerivedKeyResult> {
  if (isTauri()) {
    return tauriInvoke<DerivedKeyResult>('derive_child_key', {
      wif: receiverWif,
      senderPubKey: senderPubKeyHex,
      invoiceNumber,
    })
  }
  throw new Error('BRC-42 key derivation requires Tauri runtime')
}

/**
 * Derive a child key using a key from the Rust key store.
 *
 * This is the preferred API — the WIF never leaves Rust memory.
 */
export async function deriveChildKeyFromStore(
  keyType: string,
  senderPubKeyHex: string,
  invoiceNumber: string
): Promise<DerivedKeyResult> {
  return tauriInvoke<DerivedKeyResult>('derive_child_key_from_store', {
    keyType,
    senderPubKey: senderPubKeyHex,
    invoiceNumber,
  })
}

/**
 * Derive the address that a sender would create when sending to our public key.
 */
export async function deriveSenderAddress(
  receiverWif: string,
  senderPubKeyHex: string,
  invoiceNumber: string
): Promise<string> {
  const result = await deriveChildKey(receiverWif, senderPubKeyHex, invoiceNumber)
  return result.address
}

// ---------------------------------------------------------------------------
// Known Senders
// ---------------------------------------------------------------------------

/**
 * Known BRC-100 wallet public keys that might send to us.
 * Discovered from transaction metadata or app connections.
 * Q-90: Uses Set for O(1) lookups and natural deduplication.
 */
const KNOWN_SENDER_PUBKEYS = new Set<string>()

const MAX_KNOWN_SENDERS = 100
const PUBKEY_PATTERN = /^(02|03)[0-9a-fA-F]{64}$/

export function addKnownSender(pubKeyHex: string): boolean {
  if (!PUBKEY_PATTERN.test(pubKeyHex)) return false
  if (KNOWN_SENDER_PUBKEYS.size >= MAX_KNOWN_SENDERS) return false
  if (KNOWN_SENDER_PUBKEYS.has(pubKeyHex)) return false
  KNOWN_SENDER_PUBKEYS.add(pubKeyHex)
  try {
    localStorage.setItem(STORAGE_KEYS.KNOWN_SENDERS, JSON.stringify([...KNOWN_SENDER_PUBKEYS]))
  } catch (_e) {
    // Ignore storage errors
  }
  return true
}

export function loadKnownSenders(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.KNOWN_SENDERS)
    if (saved) {
      const senders = JSON.parse(saved)
      if (!Array.isArray(senders)) return
      for (const s of senders) {
        if (KNOWN_SENDER_PUBKEYS.size >= MAX_KNOWN_SENDERS) break
        if (typeof s === 'string' && PUBKEY_PATTERN.test(s)) {
          KNOWN_SENDER_PUBKEYS.add(s)
        }
      }
    }
  } catch (_e) {
    // Ignore parse errors
  }
}

export function getKnownSenders(): string[] {
  return [...KNOWN_SENDER_PUBKEYS]
}

// ---------------------------------------------------------------------------
// Common Invoice Numbers
// ---------------------------------------------------------------------------

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

function getRecentDates(days: number): string[] {
  const dates: string[] = []
  const now = new Date()
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().split('T')[0]!)
  }
  return dates
}

function generateBSVDesktopInvoices(): string[] {
  const invoices: string[] = []

  const recentDates = getRecentDates(30)
  for (const date of recentDates) {
    invoices.push(`${toBase64(date)} ${toBase64('legacy')}`)
  }

  invoices.push(`${toBase64('initial-funding')} ${toBase64('wallet-funding')}`)
  invoices.push(`${toBase64('funding')} ${toBase64('wallet-funding')}`)

  const suffixes = ['legacy', 'payment', 'send', 'default', 'wallet', '0', '1']
  for (const date of recentDates.slice(0, 7)) {
    for (const suf of suffixes) {
      invoices.push(`${toBase64(date)} ${toBase64(suf)}`)
    }
  }

  for (let i = 0; i <= 20; i++) {
    invoices.push(String(i))
    invoices.push(`${toBase64(String(i))} ${toBase64('0')}`)
    invoices.push(`${toBase64(String(i))} ${toBase64('1')}`)
  }

  invoices.push('', 'default', 'payment', 'send', '1', '0')

  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 5; j++) {
      invoices.push(`2-3241645161d8-${i} ${j}`)
    }
  }

  return invoices
}

/** Q-106: Lazy-initialized cache for common invoice numbers */
let _commonInvoiceNumbers: string[] | null = null

function getLazyCommonInvoiceNumbers(): string[] {
  if (!_commonInvoiceNumbers) {
    _commonInvoiceNumbers = generateBSVDesktopInvoices()
  }
  return _commonInvoiceNumbers
}

/** Export common invoice numbers for callers that need them */
export function getCommonInvoiceNumbers(): string[] {
  return [...getLazyCommonInvoiceNumbers()]
}

// ---------------------------------------------------------------------------
// Batch Derivation (via Tauri)
// ---------------------------------------------------------------------------

/**
 * Scan for derived addresses from known senders.
 * Returns addresses we should check for UTXOs.
 */
export async function getDerivedAddressesFromKeys(
  receiverWif: string,
  senderPubKeys: string[] = [...KNOWN_SENDER_PUBKEYS],
  invoiceNumbers: string[] = getLazyCommonInvoiceNumbers()
): Promise<DerivedAddressResult[]> {
  if (senderPubKeys.length === 0) return []

  if (isTauri()) {
    return tauriInvoke<DerivedAddressResult[]>('get_derived_addresses', {
      wif: receiverWif,
      senderPubKeys,
      invoiceNumbers,
    })
  }
  throw new Error('Batch address derivation requires Tauri runtime')
}

/**
 * Scan using a key from the Rust key store (preferred — WIF stays in Rust).
 */
export async function getDerivedAddressesFromStore(
  keyType: string,
  senderPubKeys: string[] = [...KNOWN_SENDER_PUBKEYS],
  invoiceNumbers: string[] = getLazyCommonInvoiceNumbers()
): Promise<DerivedAddressResult[]> {
  if (senderPubKeys.length === 0) return []
  return tauriInvoke<DerivedAddressResult[]>('get_derived_addresses_from_store', {
    keyType,
    senderPubKeys,
    invoiceNumbers,
  })
}

/**
 * Find the invoice number that produces a target address.
 */
export async function findDerivedKeyForAddress(
  receiverWif: string,
  targetAddress: string,
  senderPubKeyHex: string,
  invoiceNumbers: string[] = getLazyCommonInvoiceNumbers(),
  maxNumeric = 100
): Promise<DerivedKeyResult | null> {
  if (isTauri()) {
    return tauriInvoke<DerivedKeyResult | null>('find_derived_key_for_address', {
      wif: receiverWif,
      targetAddress,
      senderPubKey: senderPubKeyHex,
      invoiceNumbers,
      maxNumeric,
    })
  }
  throw new Error('Key search requires Tauri runtime')
}

/**
 * Debug function to find the invoice number that produces a target address.
 * Brute-forces through many possible invoice numbers.
 *
 * SECURITY: Only available in development builds.
 */
export async function debugFindInvoiceNumber(
  receiverWif: string,
  senderPubKeyHex: string,
  targetAddress: string
): Promise<{ found: boolean; invoiceNumber?: string }> {
  if (!import.meta.env.DEV) {
    throw new Error('debugFindInvoiceNumber is only available in development builds')
  }

  // Build extended invoice number list for thorough search
  const extendedInvoices = [...getLazyCommonInvoiceNumbers()]

  // Add numeric 0-1000
  for (let i = 0; i <= 1000; i++) {
    extendedInvoices.push(String(i))
  }

  // Add BRC-29 variations
  for (let i = 0; i <= 100; i++) {
    for (let j = 0; j <= 10; j++) {
      extendedInvoices.push(`2-3241645161d8-${i} ${j}`)
    }
  }

  // Add BRC-43 protocol patterns
  const protocols = ['wallet', 'payment', 'send', 'bsv', 'p2pkh', 'simple', 'default', 'babbage', 'authrite']
  for (const proto of protocols) {
    for (let sec = 1; sec <= 2; sec++) {
      for (let key = 0; key <= 10; key++) {
        extendedInvoices.push(`${sec}-${proto}-${key}`)
      }
    }
  }

  // Add BSV Desktop Base64 patterns for last 60 days
  const debugSuffixes = ['legacy', 'payment', 'send', 'default', 'wallet', '0', '1', 'wallet-funding']
  const dates = getRecentDates(60)
  for (const date of dates) {
    for (const suf of debugSuffixes) {
      extendedInvoices.push(`${toBase64(date)} ${toBase64(suf)}`)
    }
  }
  for (const date of dates.slice(0, 14)) {
    for (const suf of debugSuffixes) {
      extendedInvoices.push(`${toBase64(date)}${toBase64(suf)}`)
    }
  }

  const result = await findDerivedKeyForAddress(
    receiverWif,
    targetAddress,
    senderPubKeyHex,
    extendedInvoices,
    1000
  )

  return result ? { found: true } : { found: false }
}

// ---------------------------------------------------------------------------
// Tagged Key Derivation (BRC-43 Compatible)
// ---------------------------------------------------------------------------

export interface DerivationTag {
  label: string
  id: string
  domain?: string
  meta?: Record<string, unknown>
}

export interface TaggedKeyResult {
  wif: string
  publicKey: string
  address: string
  derivationPath: string
}

/**
 * Derive a tagged key for app-specific purposes (BRC-43 compatible).
 */
export async function deriveTaggedKey(
  rootWif: string,
  tag: DerivationTag
): Promise<TaggedKeyResult> {
  if (isTauri()) {
    return tauriInvoke<TaggedKeyResult>('derive_tagged_key', {
      wif: rootWif,
      label: tag.label,
      id: tag.id,
      domain: tag.domain,
    })
  }
  throw new Error('Tagged key derivation requires Tauri runtime')
}

/**
 * Derive a tagged key using a key from the Rust key store.
 */
export async function deriveTaggedKeyFromStore(
  keyType: string,
  tag: DerivationTag
): Promise<TaggedKeyResult> {
  return tauriInvoke<TaggedKeyResult>('derive_tagged_key_from_store', {
    keyType,
    label: tag.label,
    id: tag.id,
    domain: tag.domain,
  })
}

/**
 * Get a tagged key for a well-known app.
 *
 * Special handling for built-in labels that map to standard wallet keys.
 * For well-known labels (yours, panda), returns the root wallet/identity/ord key.
 * For unknown labels, returns null — caller should use deriveTaggedKey instead.
 *
 * SECURITY NOTE (S-57): This returns ROOT wallet/identity/ordinals keys
 * for well-known labels. The caller must gate this behind user approval.
 *
 * @deprecated Use `deriveTaggedKeyFromStore()` via Tauri command instead.
 * This function returns raw WIFs in the result, exposing private keys to JavaScript.
 */
export function getKnownTaggedKey(
  label: string,
  id: string,
  walletKeys: {
    walletWif?: string
    walletPubKey?: string
    walletAddress?: string
    ordWif?: string
    ordPubKey?: string
    ordAddress?: string
    identityWif: string
    identityPubKey: string
    identityAddress: string
  }
): TaggedKeyResult | null {
  const lowerLabel = label.toLowerCase()
  const lowerId = id.toLowerCase()

  if ((lowerLabel === 'yours' || lowerLabel === 'panda') && lowerId === 'identity') {
    return {
      wif: walletKeys.identityWif,
      publicKey: walletKeys.identityPubKey,
      address: walletKeys.identityAddress,
      derivationPath: "m/0'/236'/0'/0/0"
    }
  }

  if (lowerLabel === 'yours' && lowerId === 'bsv' && walletKeys.walletWif) {
    return {
      wif: walletKeys.walletWif,
      publicKey: walletKeys.walletPubKey ?? '',
      address: walletKeys.walletAddress ?? '',
      derivationPath: "m/44'/236'/0'/1/0"
    }
  }

  if (lowerLabel === 'yours' && lowerId === 'ord' && walletKeys.ordWif) {
    return {
      wif: walletKeys.ordWif,
      publicKey: walletKeys.ordPubKey ?? '',
      address: walletKeys.ordAddress ?? '',
      derivationPath: "m/44'/236'/1'/0/0"
    }
  }

  return null
}
