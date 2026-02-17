/**
 * BRC-42/43 Key Derivation for Simply Sats
 *
 * Implements key derivation for receiving payments sent to your identity public key.
 * When someone sends to your public key, they derive a unique address using ECDH.
 * We need to derive the same addresses to find and spend those funds.
 *
 * Uses the BSV SDK's built-in deriveChild() which implements the correct BRC-42 algorithm.
 */

import { PrivateKey, PublicKey, Hash } from '@bsv/sdk'
import { STORAGE_KEYS } from '../infrastructure/storage/localStorage'

/**
 * Derive a child private key using BRC-42 protocol
 *
 * Uses the BSV SDK's deriveChild() method which implements:
 * - ECDH shared secret computation
 * - HMAC-SHA256(key=sharedSecret, message=invoiceNumber)
 * - Addition to private key (mod n)
 */
export function deriveChildPrivateKey(
  receiverPrivateKey: PrivateKey,
  senderPublicKey: PublicKey,
  invoiceNumber: string
): PrivateKey {
  // Use the SDK's built-in BRC-42 derivation
  return receiverPrivateKey.deriveChild(senderPublicKey, invoiceNumber)
}

/**
 * Derive the address that a sender would create when sending to our public key
 */
export function deriveSenderAddress(
  receiverPrivateKey: PrivateKey,
  senderPublicKey: PublicKey,
  invoiceNumber: string
): string {
  const childPrivKey = deriveChildPrivateKey(receiverPrivateKey, senderPublicKey, invoiceNumber)
  return childPrivKey.toPublicKey().toAddress()
}

/**
 * Known BRC-100 wallet public keys that might send to us
 * This is a growing list of known senders - in practice you'd discover these
 * from transaction metadata or app connections
 */
const KNOWN_SENDER_PUBKEYS: string[] = [
  // Add known sender public keys here as they're discovered
]

// Helper to encode string to Base64 (handles non-ASCII safely)
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

// Generate date strings for past N days in ISO format (YYYY-MM-DD)
function getRecentDates(days: number): string[] {
  const dates: string[] = []
  const now = new Date()
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().split('T')[0]!) // YYYY-MM-DD format
  }
  return dates
}

/**
 * Common invoice numbers used by BRC-100 apps
 *
 * BSV Desktop uses BRC-29 format with Base64-encoded prefix and suffix:
 * - keyID = Base64(prefix) + ' ' + Base64(suffix)
 * - Legacy bridge uses: Base64(date) + ' ' + Base64('legacy')
 * - Wallet funding uses: Base64('initial-funding') + ' ' + Base64('wallet-funding')
 */
const COMMON_INVOICE_NUMBERS: string[] = []

// Generate BSV Desktop style invoice numbers
function generateBSVDesktopInvoices(): string[] {
  const invoices: string[] = []

  // BSV Desktop Legacy Bridge format: Base64(date) + ' ' + Base64('legacy')
  const recentDates = getRecentDates(30) // Check last 30 days
  for (const date of recentDates) {
    const prefix = toBase64(date)
    const suffix = toBase64('legacy')
    invoices.push(`${prefix} ${suffix}`)
  }

  // BSV Desktop Wallet Funding format
  invoices.push(`${toBase64('initial-funding')} ${toBase64('wallet-funding')}`)
  invoices.push(`${toBase64('funding')} ${toBase64('wallet-funding')}`)

  // Common suffix patterns with date prefixes
  const suffixes = ['legacy', 'payment', 'send', 'default', 'wallet', '0', '1']
  for (const date of recentDates.slice(0, 7)) { // Last 7 days with various suffixes
    for (const suf of suffixes) {
      invoices.push(`${toBase64(date)} ${toBase64(suf)}`)
    }
  }

  // Simple numeric patterns (some wallets might use these)
  for (let i = 0; i <= 20; i++) {
    invoices.push(String(i))
    invoices.push(`${toBase64(String(i))} ${toBase64('0')}`)
    invoices.push(`${toBase64(String(i))} ${toBase64('1')}`)
  }

  // BRC-43 standard formats
  invoices.push('', 'default', 'payment', 'send', '1', '0')

  // BRC-29 format variations
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 5; j++) {
      invoices.push(`2-3241645161d8-${i} ${j}`)
    }
  }

  return invoices
}

// Populate the invoice numbers
COMMON_INVOICE_NUMBERS.push(...generateBSVDesktopInvoices())

/**
 * Scan for derived addresses from known senders
 * Returns a list of addresses we should check for UTXOs
 */
export function getDerivedAddresses(
  receiverPrivateKey: PrivateKey,
  senderPubKeys: string[] = KNOWN_SENDER_PUBKEYS,
  invoiceNumbers: string[] = COMMON_INVOICE_NUMBERS
): { address: string; senderPubKey: string; invoiceNumber: string; privateKey: PrivateKey }[] {
  const derivedAddresses: { address: string; senderPubKey: string; invoiceNumber: string; privateKey: PrivateKey }[] = []

  for (const senderPubKeyHex of senderPubKeys) {
    try {
      const senderPubKey = PublicKey.fromString(senderPubKeyHex)

      for (const invoiceNumber of invoiceNumbers) {
        try {
          const childPrivKey = deriveChildPrivateKey(receiverPrivateKey, senderPubKey, invoiceNumber)
          const address = childPrivKey.toPublicKey().toAddress()

          derivedAddresses.push({
            address,
            senderPubKey: senderPubKeyHex,
            invoiceNumber,
            privateKey: childPrivKey
          })
        } catch (_e) {
          // Skip invalid derivations
        }
      }
    } catch (_e) {
      // Skip invalid public keys
    }
  }

  return derivedAddresses
}

/**
 * Check if an address matches any derived address from a specific sender
 */
export function findDerivedKeyForAddress(
  targetAddress: string,
  receiverPrivateKey: PrivateKey,
  senderPubKeyHex: string,
  maxInvoiceNumber = 100
): { privateKey: PrivateKey; invoiceNumber: string } | null {
  try {
    const senderPubKey = PublicKey.fromString(senderPubKeyHex)

    // Try numeric invoice numbers
    for (let i = 0; i <= maxInvoiceNumber; i++) {
      const invoiceNumber = String(i)
      const childPrivKey = deriveChildPrivateKey(receiverPrivateKey, senderPubKey, invoiceNumber)
      const derivedAddress = childPrivKey.toPublicKey().toAddress()

      if (derivedAddress === targetAddress) {
        return { privateKey: childPrivKey, invoiceNumber }
      }
    }

    // Try common string invoice numbers
    for (const invoiceNumber of COMMON_INVOICE_NUMBERS) {
      const childPrivKey = deriveChildPrivateKey(receiverPrivateKey, senderPubKey, invoiceNumber)
      const derivedAddress = childPrivKey.toPublicKey().toAddress()

      if (derivedAddress === targetAddress) {
        return { privateKey: childPrivKey, invoiceNumber }
      }
    }
  } catch (_e) {
    // Invalid sender public key
  }

  return null
}

/**
 * Store discovered sender public keys for future scanning
 */
export function addKnownSender(pubKeyHex: string): void {
  if (!KNOWN_SENDER_PUBKEYS.includes(pubKeyHex)) {
    KNOWN_SENDER_PUBKEYS.push(pubKeyHex)
    // Persist to localStorage
    try {
      localStorage.setItem(STORAGE_KEYS.KNOWN_SENDERS, JSON.stringify(KNOWN_SENDER_PUBKEYS))
    } catch (_e) {
      // Ignore storage errors
    }
  }
}

/**
 * Load known senders from storage
 */
export function loadKnownSenders(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.KNOWN_SENDERS)
    if (saved) {
      const senders = JSON.parse(saved)
      for (const s of senders) {
        if (!KNOWN_SENDER_PUBKEYS.includes(s)) {
          KNOWN_SENDER_PUBKEYS.push(s)
        }
      }
    }
  } catch (_e) {
    // Ignore parse errors
  }
}

/**
 * Get all known sender public keys
 */
export function getKnownSenders(): string[] {
  return [...KNOWN_SENDER_PUBKEYS]
}

/**
 * Debug function to find the invoice number that produces a target address
 * This brute-forces through many possible invoice numbers to find a match
 *
 * SECURITY: Only available in development builds — gated behind import.meta.env.DEV
 */
export function debugFindInvoiceNumber(
  receiverPrivateKey: PrivateKey,
  senderPubKeyHex: string,
  targetAddress: string
): { found: boolean; invoiceNumber?: string; testedCount: number } {
  if (!import.meta.env.DEV) {
    throw new Error('debugFindInvoiceNumber is only available in development builds')
  }
  const senderPubKey = PublicKey.fromString(senderPubKeyHex)
  let testedCount = 0

  // First test all common invoice numbers
  for (const inv of COMMON_INVOICE_NUMBERS) {
    testedCount++
    try {
      const childPrivKey = deriveChildPrivateKey(receiverPrivateKey, senderPubKey, inv)
      const address = childPrivKey.toPublicKey().toAddress()
      if (address === targetAddress) {
        return { found: true, invoiceNumber: inv, testedCount }
      }
    } catch (_e) {
      // Skip invalid
    }
  }

  // Try numeric 0-1000
  for (let i = 0; i <= 1000; i++) {
    testedCount++
    try {
      const childPrivKey = deriveChildPrivateKey(receiverPrivateKey, senderPubKey, String(i))
      const address = childPrivKey.toPublicKey().toAddress()
      if (address === targetAddress) {
        return { found: true, invoiceNumber: String(i), testedCount }
      }
    } catch (_e) {
      // Skip
    }
  }

  // Try BRC-29 format with various suffixes
  for (let i = 0; i <= 100; i++) {
    for (let j = 0; j <= 10; j++) {
      testedCount++
      const inv = `2-3241645161d8-${i} ${j}`
      try {
        const childPrivKey = deriveChildPrivateKey(receiverPrivateKey, senderPubKey, inv)
        const address = childPrivKey.toPublicKey().toAddress()
        if (address === targetAddress) {
          return { found: true, invoiceNumber: inv, testedCount }
        }
      } catch (_e) {
        // Skip
      }
    }
  }

  // Try various BRC-43 protocol patterns with numbers
  const protocols = ['wallet', 'payment', 'send', 'bsv', 'p2pkh', 'simple', 'default', 'babbage', 'authrite']
  for (const proto of protocols) {
    for (let sec = 1; sec <= 2; sec++) {
      for (let key = 0; key <= 10; key++) {
        testedCount++
        const inv = `${sec}-${proto}-${key}`
        try {
          const childPrivKey = deriveChildPrivateKey(receiverPrivateKey, senderPubKey, inv)
          const address = childPrivKey.toPublicKey().toAddress()
          if (address === targetAddress) {
            return { found: true, invoiceNumber: inv, testedCount }
          }
        } catch (_e) {
          // Skip
        }
      }
    }
  }

  // Try BSV Desktop specific Base64 patterns for last 60 days
  const suffixes = ['legacy', 'payment', 'send', 'default', 'wallet', '0', '1', 'wallet-funding']
  const dates = getRecentDates(60)
  for (const date of dates) {
    for (const suf of suffixes) {
      testedCount++
      const inv = `${toBase64(date)} ${toBase64(suf)}`
      try {
        const childPrivKey = deriveChildPrivateKey(receiverPrivateKey, senderPubKey, inv)
        const address = childPrivKey.toPublicKey().toAddress()
        if (address === targetAddress) {
          return { found: true, invoiceNumber: inv, testedCount }
        }
      } catch (_e) {
        // Skip
      }
    }
  }

  // Try without space separator too
  for (const date of dates.slice(0, 14)) {
    for (const suf of suffixes) {
      testedCount++
      const inv = `${toBase64(date)}${toBase64(suf)}`
      try {
        const childPrivKey = deriveChildPrivateKey(receiverPrivateKey, senderPubKey, inv)
        const address = childPrivKey.toPublicKey().toAddress()
        if (address === targetAddress) {
          return { found: true, invoiceNumber: inv, testedCount }
        }
      } catch (_e) {
        // Skip
      }
    }
  }

  return { found: false, testedCount }
}

// ============================================
// Tagged Key Derivation (BRC-43 Compatible)
// ============================================

/**
 * Derivation tag for app-specific keys
 * Following Yours Wallet pattern
 */
export interface DerivationTag {
  /** App identifier (e.g., 'yours', 'wrootz', custom app name) */
  label: string
  /** Feature identifier within the app (e.g., 'identity', 'signing') */
  id: string
  /** Optional domain for web apps */
  domain?: string
  /** Optional additional metadata */
  meta?: Record<string, unknown>
}

/**
 * Result of tagged key derivation
 */
export interface TaggedKeyResult {
  privateKey: PrivateKey
  publicKey: string
  address: string
  derivationPath: string
}

/**
 * Compute tagged derivation path following Yours Wallet pattern
 *
 * Uses SHA-256 hash of label and id to derive path indices,
 * ensuring deterministic key generation for the same tags.
 *
 * Path format: m/44'/236'/218'/{labelIndex}/{idIndex}
 * The 218' is a reserved purpose for tagged derivation.
 *
 * @param label - App identifier
 * @param id - Feature identifier
 * @returns Derivation path string
 */
export function getTaggedDerivationPath(label: string, id: string): string {
  // SHA-256 hash to get deterministic path indices
  const labelHash = Hash.sha256(Array.from(new TextEncoder().encode(label))) as number[]
  const idHash = Hash.sha256(Array.from(new TextEncoder().encode(id))) as number[]

  // Take first 4 bytes as a 32-bit unsigned integer, limit to non-hardened range (< 2^31)
  const labelIndex = (((labelHash[0]! << 24) | (labelHash[1]! << 16) | (labelHash[2]! << 8) | labelHash[3]!) >>> 0) % 2147483648
  const idIndex = (((idHash[0]! << 24) | (idHash[1]! << 16) | (idHash[2]! << 8) | idHash[3]!) >>> 0) % 2147483648

  return `m/44'/236'/218'/${labelIndex}/${idIndex}`
}

/**
 * Derive a tagged key for app-specific purposes
 *
 * This allows apps to request keys specific to their domain,
 * ensuring key isolation between different applications.
 *
 * @param rootPrivateKey - The wallet's root private key (from identity or wallet path)
 * @param tag - The derivation tag specifying app and feature
 * @returns TaggedKeyResult with derived private key, public key, and address
 */
export function deriveTaggedKey(
  rootPrivateKey: PrivateKey,
  tag: DerivationTag
): TaggedKeyResult {
  const path = getTaggedDerivationPath(tag.label, tag.id)

  // For tagged derivation, we use the private key as a seed
  // and derive using the tag as an "invoice" via ECDH
  // This matches the BRC-42/43 approach

  // Create a deterministic public key from the tag for ECDH
  const tagString = `${tag.label}:${tag.id}:${tag.domain || ''}`

  // Use the root private key's public key for self-derivation
  const rootPubKey = rootPrivateKey.toPublicKey()

  // Derive child key using the tag as invoice number
  const childPrivKey = rootPrivateKey.deriveChild(rootPubKey, tagString)
  const childPubKey = childPrivKey.toPublicKey()

  return {
    privateKey: childPrivKey,
    publicKey: childPubKey.toString(),
    address: childPubKey.toAddress(),
    derivationPath: path
  }
}

/**
 * Get a tagged key for a well-known app
 *
 * Special handling for built-in labels that map to standard wallet keys.
 *
 * @param label - App label
 * @param id - Feature id
 * @param walletKeys - Object containing wallet, ordinal, and identity keys
 */
export function getKnownTaggedKey(
  label: string,
  id: string,
  walletKeys: {
    walletPrivKey?: PrivateKey
    ordPrivKey?: PrivateKey
    identityPrivKey: PrivateKey
  }
): TaggedKeyResult | null {
  // Handle well-known labels that map to standard keys
  const lowerLabel = label.toLowerCase()
  const lowerId = id.toLowerCase()

  // 'yours' or 'panda' with 'identity' returns identity key
  if ((lowerLabel === 'yours' || lowerLabel === 'panda') && lowerId === 'identity') {
    const pubKey = walletKeys.identityPrivKey.toPublicKey()
    return {
      privateKey: walletKeys.identityPrivKey,
      publicKey: pubKey.toString(),
      address: pubKey.toAddress(),
      derivationPath: "m/0'/236'/0'/0/0"
    }
  }

  // 'yours' with 'bsv' returns wallet key
  if (lowerLabel === 'yours' && lowerId === 'bsv' && walletKeys.walletPrivKey) {
    const pubKey = walletKeys.walletPrivKey.toPublicKey()
    return {
      privateKey: walletKeys.walletPrivKey,
      publicKey: pubKey.toString(),
      address: pubKey.toAddress(),
      derivationPath: "m/44'/236'/0'/1/0"
    }
  }

  // 'yours' with 'ord' returns ordinals key
  if (lowerLabel === 'yours' && lowerId === 'ord' && walletKeys.ordPrivKey) {
    const pubKey = walletKeys.ordPrivKey.toPublicKey()
    return {
      privateKey: walletKeys.ordPrivKey,
      publicKey: pubKey.toString(),
      address: pubKey.toAddress(),
      derivationPath: "m/44'/236'/1'/0/0"
    }
  }

  return null
}
