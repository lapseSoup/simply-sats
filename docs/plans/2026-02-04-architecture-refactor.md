# Simply Sats Architecture Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor Simply Sats from monolithic services into a clean layered architecture with domain logic, infrastructure, and smaller focused contexts - using a hybrid migration approach where new code coexists with old until migration is complete.

**Architecture:** Four-layer design: Domain (pure business logic), Infrastructure (I/O and side effects), Actions (hooks composing domain + infrastructure), State (small focused contexts). Old services remain functional while new architecture is built alongside, with thin adapters bridging old and new code.

**Tech Stack:** React 19, TypeScript 5.9, Tauri 2, SQLite, @bsv/sdk, Vitest

---

## Phase 1: Foundation - Domain Layer Setup

### Task 1.1: Create Domain Directory Structure

**Files:**
- Create: `src/domain/index.ts`
- Create: `src/domain/wallet/index.ts`
- Create: `src/domain/transaction/index.ts`
- Create: `src/domain/types.ts`

**Step 1: Create the domain directory structure**

```bash
mkdir -p src/domain/wallet src/domain/transaction src/domain/brc100 src/domain/locks src/domain/ordinals src/domain/tokens
```

**Step 2: Create shared types file**

Create `src/domain/types.ts`:

```typescript
/**
 * Core domain types for Simply Sats
 * These are pure data types with no dependencies on infrastructure
 */

// ============================================
// Wallet Types
// ============================================

export interface WalletKeys {
  mnemonic: string
  walletType: 'yours'
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

export interface KeyPair {
  wif: string
  address: string
  pubKey: string
}

// ============================================
// UTXO Types
// ============================================

export interface UTXO {
  txid: string
  vout: number
  satoshis: number
  script: string
}

export interface ExtendedUTXO extends UTXO {
  wif: string
  address: string
}

export interface DBUtxo {
  id?: number
  txid: string
  vout: number
  satoshis: number
  lockingScript: string
  address?: string
  basket: string
  spendable: boolean
  createdAt: number
  spentAt?: number
  spentTxid?: string
  tags?: string[]
}

// ============================================
// Transaction Types
// ============================================

export interface TransactionRecord {
  id?: number
  txid: string
  rawTx?: string
  description?: string
  createdAt: number
  confirmedAt?: number
  blockHeight?: number
  status: 'pending' | 'confirmed' | 'failed'
  labels?: string[]
  amount?: number
}

export interface SendResult {
  success: boolean
  txid?: string
  error?: string
}

// ============================================
// Lock Types
// ============================================

export interface Lock {
  id?: number
  utxoId: number
  unlockBlock: number
  ordinalOrigin?: string
  createdAt: number
  unlockedAt?: number
}

export interface LockedUTXO {
  txid: string
  vout: number
  satoshis: number
  unlockBlock: number
  blocksRemaining: number
  spendable: boolean
  lockingScript?: string
}

export interface LockedOutput {
  outpoint: string
  txid: string
  vout: number
  satoshis: number
  unlockBlock: number
  tags: string[]
  spendable: boolean
  blocksRemaining: number
}

// ============================================
// Ordinal Types
// ============================================

export interface Ordinal {
  origin: string
  txid: string
  vout: number
  satoshis: number
  contentType?: string
  content?: string
  number?: number
}

// ============================================
// Token Types
// ============================================

export interface TokenBalance {
  ticker: string
  protocol: 'bsv20' | 'bsv21'
  confirmed: string
  pending: string
  id?: string
  decimals?: number
  icon?: string
  sym?: string
}

// ============================================
// Account Types
// ============================================

export interface Account {
  id?: number
  name: string
  encryptedMnemonic: string
  walletAddress: string
  ordAddress: string
  identityAddress: string
  createdAt: number
  isActive: boolean
}

// ============================================
// Network Types
// ============================================

export interface NetworkInfo {
  blockHeight: number
  overlayHealthy: boolean
  overlayNodeCount: number
}

// ============================================
// Fee Types
// ============================================

export interface FeeEstimate {
  fee: number
  inputCount: number
  outputCount: number
  totalInput: number
  canSend: boolean
}

export interface MaxSendResult {
  maxSats: number
  fee: number
  numInputs: number
}

// ============================================
// Basket Constants
// ============================================

export const BASKETS = {
  DEFAULT: 'default',
  ORDINALS: 'ordinals',
  IDENTITY: 'identity',
  LOCKS: 'locks',
  WROOTZ_LOCKS: 'wrootz_locks',
  DERIVED: 'derived'
} as const

export type BasketType = typeof BASKETS[keyof typeof BASKETS]
```

**Step 3: Create domain barrel exports**

Create `src/domain/index.ts`:

```typescript
/**
 * Domain Layer - Pure Business Logic
 *
 * This layer contains all business logic with no side effects.
 * Functions here are pure, easily testable, and have no dependencies
 * on infrastructure (database, APIs, storage).
 */

export * from './types'
export * from './wallet'
export * from './transaction'
```

Create `src/domain/wallet/index.ts`:

```typescript
/**
 * Wallet Domain - Key derivation, signing, encryption
 */

export * from './keyDerivation'
export * from './validation'
```

Create `src/domain/transaction/index.ts`:

```typescript
/**
 * Transaction Domain - TX building, fee calculation, coin selection
 */

export * from './fees'
export * from './coinSelection'
export * from './builder'
```

**Step 4: Commit foundation**

```bash
git add src/domain/
git commit -m "feat: add domain layer foundation with shared types"
```

---

### Task 1.2: Extract Pure Fee Calculation Functions

**Files:**
- Create: `src/domain/transaction/fees.ts`
- Create: `src/domain/transaction/fees.test.ts`

**Step 1: Write failing tests for fee calculation**

Create `src/domain/transaction/fees.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  calculateTxFee,
  calculateLockFee,
  feeFromBytes,
  calculateMaxSend,
  calculateExactFee,
  varintSize,
  P2PKH_INPUT_SIZE,
  P2PKH_OUTPUT_SIZE,
  TX_OVERHEAD,
  DEFAULT_FEE_RATE
} from './fees'
import type { UTXO } from '../types'

describe('Fee Calculation', () => {
  describe('varintSize', () => {
    it('should return 1 for values < 0xfd', () => {
      expect(varintSize(0)).toBe(1)
      expect(varintSize(100)).toBe(1)
      expect(varintSize(252)).toBe(1)
    })

    it('should return 3 for values <= 0xffff', () => {
      expect(varintSize(253)).toBe(3)
      expect(varintSize(0xffff)).toBe(3)
    })

    it('should return 5 for values <= 0xffffffff', () => {
      expect(varintSize(0x10000)).toBe(5)
      expect(varintSize(0xffffffff)).toBe(5)
    })

    it('should return 9 for larger values', () => {
      expect(varintSize(0x100000000)).toBe(9)
    })
  })

  describe('feeFromBytes', () => {
    it('should calculate fee from bytes using default rate', () => {
      const fee = feeFromBytes(200, DEFAULT_FEE_RATE)
      expect(fee).toBe(Math.max(1, Math.ceil(200 * DEFAULT_FEE_RATE)))
    })

    it('should use custom fee rate when provided', () => {
      const fee = feeFromBytes(200, 0.1)
      expect(fee).toBe(20)
    })

    it('should return minimum of 1 sat', () => {
      const fee = feeFromBytes(1, 0.001)
      expect(fee).toBe(1)
    })
  })

  describe('calculateTxFee', () => {
    it('should calculate fee for 1 input 1 output', () => {
      const fee = calculateTxFee(1, 1, DEFAULT_FEE_RATE)
      const expectedSize = TX_OVERHEAD + P2PKH_INPUT_SIZE + P2PKH_OUTPUT_SIZE
      expect(fee).toBe(Math.max(1, Math.ceil(expectedSize * DEFAULT_FEE_RATE)))
    })

    it('should calculate fee for 2 inputs 2 outputs', () => {
      const fee = calculateTxFee(2, 2, DEFAULT_FEE_RATE)
      const expectedSize = TX_OVERHEAD + (2 * P2PKH_INPUT_SIZE) + (2 * P2PKH_OUTPUT_SIZE)
      expect(fee).toBe(Math.max(1, Math.ceil(expectedSize * DEFAULT_FEE_RATE)))
    })

    it('should include extra bytes in calculation', () => {
      const feeWithoutExtra = calculateTxFee(1, 1, DEFAULT_FEE_RATE)
      const feeWithExtra = calculateTxFee(1, 1, DEFAULT_FEE_RATE, 100)
      expect(feeWithExtra).toBeGreaterThan(feeWithoutExtra)
    })
  })

  describe('calculateLockFee', () => {
    it('should calculate fee for lock transaction with default script size', () => {
      const fee = calculateLockFee(1, DEFAULT_FEE_RATE)
      expect(fee).toBeGreaterThan(0)
    })

    it('should use provided script size', () => {
      const fee = calculateLockFee(1, DEFAULT_FEE_RATE, 500)
      expect(fee).toBeGreaterThan(0)
    })
  })

  describe('calculateMaxSend', () => {
    it('should return 0 for empty UTXOs', () => {
      const result = calculateMaxSend([], DEFAULT_FEE_RATE)
      expect(result.maxSats).toBe(0)
      expect(result.fee).toBe(0)
      expect(result.numInputs).toBe(0)
    })

    it('should calculate max sendable amount', () => {
      const utxos: UTXO[] = [
        { txid: 'abc', vout: 0, satoshis: 10000, script: '' }
      ]
      const result = calculateMaxSend(utxos, DEFAULT_FEE_RATE)
      expect(result.maxSats).toBeLessThan(10000)
      expect(result.fee).toBeGreaterThan(0)
      expect(result.numInputs).toBe(1)
      expect(result.maxSats + result.fee).toBe(10000)
    })
  })

  describe('calculateExactFee', () => {
    it('should return canSend=false for empty UTXOs', () => {
      const result = calculateExactFee(1000, [], DEFAULT_FEE_RATE)
      expect(result.canSend).toBe(false)
    })

    it('should return canSend=false for insufficient funds', () => {
      const utxos: UTXO[] = [
        { txid: 'abc', vout: 0, satoshis: 100, script: '' }
      ]
      const result = calculateExactFee(10000, utxos, DEFAULT_FEE_RATE)
      expect(result.canSend).toBe(false)
    })

    it('should calculate fee with change output', () => {
      const utxos: UTXO[] = [
        { txid: 'abc', vout: 0, satoshis: 10000, script: '' }
      ]
      const result = calculateExactFee(5000, utxos, DEFAULT_FEE_RATE)
      expect(result.canSend).toBe(true)
      expect(result.outputCount).toBe(2) // recipient + change
    })

    it('should calculate fee without change for small remainder', () => {
      const utxos: UTXO[] = [
        { txid: 'abc', vout: 0, satoshis: 1000, script: '' }
      ]
      // Send almost everything - small remainder goes to fee
      const result = calculateExactFee(900, utxos, DEFAULT_FEE_RATE)
      expect(result.canSend).toBe(true)
    })
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/domain/transaction/fees.test.ts
```

Expected: FAIL with "Cannot find module './fees'"

**Step 3: Implement pure fee calculation functions**

Create `src/domain/transaction/fees.ts`:

```typescript
/**
 * Pure fee calculation functions
 * No side effects, no external dependencies, easily testable
 */

import type { UTXO, FeeEstimate, MaxSendResult } from '../types'

// Standard P2PKH sizes (bytes)
export const P2PKH_INPUT_SIZE = 148  // outpoint 36 + scriptlen 1 + scriptsig ~107 + sequence 4
export const P2PKH_OUTPUT_SIZE = 34  // value 8 + scriptlen 1 + script 25
export const TX_OVERHEAD = 10        // version 4 + locktime 4 + input count ~1 + output count ~1

// Default fee rate: 0.05 sat/byte (50 sat/KB) - BSV miners typically accept very low fees
export const DEFAULT_FEE_RATE = 0.05

// Minimum fee rate (sat/byte)
export const MIN_FEE_RATE = 0.01

// Maximum fee rate (sat/byte)
export const MAX_FEE_RATE = 1.0

/**
 * Calculate varint size for a given length
 * Used for variable-length integer encoding in Bitcoin protocol
 */
export function varintSize(n: number): number {
  if (n < 0xfd) return 1
  if (n <= 0xffff) return 3
  if (n <= 0xffffffff) return 5
  return 9
}

/**
 * Calculate fee from exact byte size
 * Pure function - fee rate must be passed in
 */
export function feeFromBytes(bytes: number, feeRate: number): number {
  return Math.max(1, Math.ceil(bytes * feeRate))
}

/**
 * Calculate transaction fee for standard P2PKH inputs/outputs
 * Pure function - all parameters explicit
 */
export function calculateTxFee(
  numInputs: number,
  numOutputs: number,
  feeRate: number,
  extraBytes: number = 0
): number {
  const txSize = TX_OVERHEAD + (numInputs * P2PKH_INPUT_SIZE) + (numOutputs * P2PKH_OUTPUT_SIZE) + extraBytes
  return feeFromBytes(txSize, feeRate)
}

/**
 * Calculate the exact fee for a lock transaction using actual script size
 * Pure function - all parameters explicit
 */
export function calculateLockFee(
  numInputs: number,
  feeRate: number,
  timelockScriptSize: number = 1090
): number {
  // Lock output: value (8) + varint for script length + script
  const lockOutputSize = 8 + varintSize(timelockScriptSize) + timelockScriptSize
  // Change output: standard P2PKH
  const changeOutputSize = P2PKH_OUTPUT_SIZE

  const txSize = TX_OVERHEAD + (numInputs * P2PKH_INPUT_SIZE) + lockOutputSize + changeOutputSize
  return feeFromBytes(txSize, feeRate)
}

/**
 * Calculate max sendable amount given UTXOs
 * Pure function - all parameters explicit
 */
export function calculateMaxSend(utxos: UTXO[], feeRate: number): MaxSendResult {
  if (utxos.length === 0) {
    return { maxSats: 0, fee: 0, numInputs: 0 }
  }

  const totalSats = utxos.reduce((sum, u) => sum + u.satoshis, 0)
  const numInputs = utxos.length

  // When sending max, we have 1 output (no change)
  const fee = calculateTxFee(numInputs, 1, feeRate)
  const maxSats = Math.max(0, totalSats - fee)

  return { maxSats, fee, numInputs }
}

/**
 * Calculate exact fee by selecting UTXOs for a given amount
 * Pure function - returns calculation result without side effects
 */
export function calculateExactFee(
  satoshis: number,
  utxos: UTXO[],
  feeRate: number
): FeeEstimate {
  if (utxos.length === 0 || satoshis <= 0) {
    return { fee: 0, inputCount: 0, outputCount: 0, totalInput: 0, canSend: false }
  }

  // Select UTXOs (greedy approach)
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
  const fee = calculateTxFee(numInputs, numOutputs, feeRate)

  const change = totalInput - satoshis - fee
  const canSend = change >= 0

  return { fee, inputCount: numInputs, outputCount: numOutputs, totalInput, canSend }
}

/**
 * Clamp fee rate to valid range
 */
export function clampFeeRate(rate: number): number {
  return Math.max(MIN_FEE_RATE, Math.min(MAX_FEE_RATE, rate))
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/domain/transaction/fees.test.ts
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/domain/transaction/fees.ts src/domain/transaction/fees.test.ts
git commit -m "feat(domain): add pure fee calculation functions with tests"
```

---

### Task 1.3: Extract Pure Key Derivation Functions

**Files:**
- Create: `src/domain/wallet/keyDerivation.ts`
- Create: `src/domain/wallet/keyDerivation.test.ts`

**Step 1: Write failing tests for key derivation**

Create `src/domain/wallet/keyDerivation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  deriveKeysFromPath,
  deriveWalletKeys,
  keysFromWif,
  WALLET_PATHS
} from './keyDerivation'

// Known test mnemonic (DO NOT use in production)
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('Key Derivation', () => {
  describe('WALLET_PATHS', () => {
    it('should have correct Yours wallet paths', () => {
      expect(WALLET_PATHS.yours.wallet).toBe("m/44'/236'/0'/1/0")
      expect(WALLET_PATHS.yours.ordinals).toBe("m/44'/236'/1'/0/0")
      expect(WALLET_PATHS.yours.identity).toBe("m/0'/236'/0'/0/0")
    })
  })

  describe('deriveKeysFromPath', () => {
    it('should derive keys from mnemonic and path', () => {
      const keys = deriveKeysFromPath(TEST_MNEMONIC, WALLET_PATHS.yours.wallet)

      expect(keys.wif).toBeDefined()
      expect(keys.address).toBeDefined()
      expect(keys.pubKey).toBeDefined()
      expect(keys.wif.length).toBeGreaterThan(0)
      expect(keys.address.length).toBeGreaterThan(0)
    })

    it('should derive different keys for different paths', () => {
      const walletKeys = deriveKeysFromPath(TEST_MNEMONIC, WALLET_PATHS.yours.wallet)
      const ordKeys = deriveKeysFromPath(TEST_MNEMONIC, WALLET_PATHS.yours.ordinals)

      expect(walletKeys.address).not.toBe(ordKeys.address)
      expect(walletKeys.wif).not.toBe(ordKeys.wif)
    })

    it('should be deterministic - same inputs produce same outputs', () => {
      const keys1 = deriveKeysFromPath(TEST_MNEMONIC, WALLET_PATHS.yours.wallet)
      const keys2 = deriveKeysFromPath(TEST_MNEMONIC, WALLET_PATHS.yours.wallet)

      expect(keys1.wif).toBe(keys2.wif)
      expect(keys1.address).toBe(keys2.address)
      expect(keys1.pubKey).toBe(keys2.pubKey)
    })
  })

  describe('deriveWalletKeys', () => {
    it('should derive all three key types', () => {
      const walletKeys = deriveWalletKeys(TEST_MNEMONIC)

      expect(walletKeys.mnemonic).toBe(TEST_MNEMONIC)
      expect(walletKeys.walletType).toBe('yours')

      // Wallet keys
      expect(walletKeys.walletWif).toBeDefined()
      expect(walletKeys.walletAddress).toBeDefined()
      expect(walletKeys.walletPubKey).toBeDefined()

      // Ordinal keys
      expect(walletKeys.ordWif).toBeDefined()
      expect(walletKeys.ordAddress).toBeDefined()
      expect(walletKeys.ordPubKey).toBeDefined()

      // Identity keys
      expect(walletKeys.identityWif).toBeDefined()
      expect(walletKeys.identityAddress).toBeDefined()
      expect(walletKeys.identityPubKey).toBeDefined()
    })

    it('should derive different addresses for each key type', () => {
      const walletKeys = deriveWalletKeys(TEST_MNEMONIC)

      expect(walletKeys.walletAddress).not.toBe(walletKeys.ordAddress)
      expect(walletKeys.walletAddress).not.toBe(walletKeys.identityAddress)
      expect(walletKeys.ordAddress).not.toBe(walletKeys.identityAddress)
    })
  })

  describe('keysFromWif', () => {
    it('should derive public key and address from WIF', () => {
      // First get a valid WIF from derivation
      const derived = deriveKeysFromPath(TEST_MNEMONIC, WALLET_PATHS.yours.wallet)

      // Then test keysFromWif
      const keys = keysFromWif(derived.wif)

      expect(keys.wif).toBe(derived.wif)
      expect(keys.address).toBe(derived.address)
      expect(keys.pubKey).toBe(derived.pubKey)
    })
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/domain/wallet/keyDerivation.test.ts
```

Expected: FAIL with "Cannot find module './keyDerivation'"

**Step 3: Implement pure key derivation functions**

Create `src/domain/wallet/keyDerivation.ts`:

```typescript
/**
 * Pure key derivation functions
 * No side effects, no storage operations
 */

import { HD, Mnemonic, PrivateKey } from '@bsv/sdk'
import type { WalletKeys, KeyPair } from '../types'

// BRC-100 standard derivation paths (matching Yours Wallet exactly)
export const WALLET_PATHS = {
  yours: {
    wallet: "m/44'/236'/0'/1/0",    // BSV spending (DEFAULT_WALLET_PATH)
    ordinals: "m/44'/236'/1'/0/0",   // Ordinals (DEFAULT_ORD_PATH)
    identity: "m/0'/236'/0'/0/0"     // Identity/BRC-100 authentication
  }
} as const

/**
 * Derive keys from mnemonic and derivation path
 * Pure function - no side effects
 */
export function deriveKeysFromPath(mnemonic: string, path: string): KeyPair {
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

/**
 * Derive all wallet keys from mnemonic
 * Pure function - returns complete WalletKeys structure
 */
export function deriveWalletKeys(mnemonic: string): WalletKeys {
  const paths = WALLET_PATHS.yours
  const wallet = deriveKeysFromPath(mnemonic, paths.wallet)
  const ord = deriveKeysFromPath(mnemonic, paths.ordinals)
  const identity = deriveKeysFromPath(mnemonic, paths.identity)

  return {
    mnemonic,
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
}

/**
 * Generate keys from WIF (for importing from other wallets)
 * Pure function - no side effects
 */
export function keysFromWif(wif: string): KeyPair {
  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()

  return {
    wif: privateKey.toWif(),
    address: publicKey.toAddress(),
    pubKey: publicKey.toString()
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/domain/wallet/keyDerivation.test.ts
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/domain/wallet/keyDerivation.ts src/domain/wallet/keyDerivation.test.ts
git commit -m "feat(domain): add pure key derivation functions with tests"
```

---

### Task 1.4: Extract Mnemonic Validation Functions

**Files:**
- Create: `src/domain/wallet/validation.ts`
- Create: `src/domain/wallet/validation.test.ts`

**Step 1: Write failing tests for validation**

Create `src/domain/wallet/validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  normalizeMnemonic,
  validateMnemonic,
  isValidBSVAddress
} from './validation'

describe('Wallet Validation', () => {
  describe('normalizeMnemonic', () => {
    it('should lowercase the mnemonic', () => {
      const result = normalizeMnemonic('ABANDON ABANDON ABANDON')
      expect(result).toBe('abandon abandon abandon')
    })

    it('should trim whitespace', () => {
      const result = normalizeMnemonic('  abandon abandon abandon  ')
      expect(result).toBe('abandon abandon abandon')
    })

    it('should collapse multiple spaces', () => {
      const result = normalizeMnemonic('abandon   abandon    abandon')
      expect(result).toBe('abandon abandon abandon')
    })

    it('should handle mixed case and spacing', () => {
      const result = normalizeMnemonic('  ABANDON   Abandon   ABANDON  ')
      expect(result).toBe('abandon abandon abandon')
    })
  })

  describe('validateMnemonic', () => {
    const VALID_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

    it('should return valid for correct 12-word mnemonic', () => {
      const result = validateMnemonic(VALID_MNEMONIC)
      expect(result.isValid).toBe(true)
      expect(result.normalizedMnemonic).toBe(VALID_MNEMONIC)
    })

    it('should normalize and validate', () => {
      const result = validateMnemonic('  ABANDON   ABANDON   ABANDON   ABANDON   ABANDON   ABANDON   ABANDON   ABANDON   ABANDON   ABANDON   ABANDON   ABOUT  ')
      expect(result.isValid).toBe(true)
      expect(result.normalizedMnemonic).toBe(VALID_MNEMONIC)
    })

    it('should return invalid for wrong word count', () => {
      const result = validateMnemonic('abandon abandon abandon')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('12 words')
    })

    it('should return invalid for invalid words', () => {
      const result = validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon notaword')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('Invalid')
    })
  })

  describe('isValidBSVAddress', () => {
    it('should return true for valid P2PKH address', () => {
      expect(isValidBSVAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(true)
    })

    it('should return false for empty string', () => {
      expect(isValidBSVAddress('')).toBe(false)
    })

    it('should return false for too short address', () => {
      expect(isValidBSVAddress('1BvBM')).toBe(false)
    })

    it('should return false for invalid characters', () => {
      expect(isValidBSVAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN0')).toBe(false) // 0 is invalid
    })
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/domain/wallet/validation.test.ts
```

Expected: FAIL with "Cannot find module './validation'"

**Step 3: Implement validation functions**

Create `src/domain/wallet/validation.ts`:

```typescript
/**
 * Pure validation functions for wallet operations
 * No side effects, no external API calls
 */

import * as bip39 from 'bip39'

export interface MnemonicValidationResult {
  isValid: boolean
  normalizedMnemonic?: string
  error?: string
}

/**
 * Normalize mnemonic: lowercase, trim, collapse multiple spaces
 * Pure function
 */
export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Validate a mnemonic phrase
 * Returns normalized mnemonic if valid, error message if not
 * Pure function
 */
export function validateMnemonic(mnemonic: string): MnemonicValidationResult {
  const normalized = normalizeMnemonic(mnemonic)
  const words = normalized.split(' ')

  if (words.length !== 12 && words.length !== 24) {
    return {
      isValid: false,
      error: `Invalid mnemonic phrase. Expected 12 words but got ${words.length}.`
    }
  }

  if (!bip39.validateMnemonic(normalized)) {
    return {
      isValid: false,
      error: 'Invalid mnemonic phrase. Please check your words.'
    }
  }

  return {
    isValid: true,
    normalizedMnemonic: normalized
  }
}

/**
 * Validate a BSV address (basic format check)
 * Pure function - does not verify on-chain
 */
export function isValidBSVAddress(address: string): boolean {
  if (!address || address.length < 26 || address.length > 35) {
    return false
  }

  // BSV addresses start with 1 (P2PKH) or 3 (P2SH)
  if (!address.startsWith('1') && !address.startsWith('3')) {
    return false
  }

  // Base58 character set (no 0, O, I, l)
  const base58Regex = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/
  return base58Regex.test(address)
}

/**
 * Validate a transaction ID (64 hex characters)
 * Pure function
 */
export function isValidTxid(txid: string): boolean {
  if (!txid || txid.length !== 64) {
    return false
  }
  return /^[0-9a-fA-F]{64}$/.test(txid)
}

/**
 * Validate satoshi amount
 * Pure function
 */
export function isValidSatoshiAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount > 0 && amount <= 21_000_000_00_000_000
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/domain/wallet/validation.test.ts
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/domain/wallet/validation.ts src/domain/wallet/validation.test.ts
git commit -m "feat(domain): add pure wallet validation functions with tests"
```

---

### Task 1.5: Extract Coin Selection Logic

**Files:**
- Create: `src/domain/transaction/coinSelection.ts`
- Create: `src/domain/transaction/coinSelection.test.ts`

**Step 1: Write failing tests for coin selection**

Create `src/domain/transaction/coinSelection.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  selectCoins,
  selectCoinsMultiKey,
  sortUtxosByValue
} from './coinSelection'
import type { UTXO, ExtendedUTXO } from '../types'

describe('Coin Selection', () => {
  describe('sortUtxosByValue', () => {
    it('should sort UTXOs by satoshis ascending', () => {
      const utxos: UTXO[] = [
        { txid: 'a', vout: 0, satoshis: 1000, script: '' },
        { txid: 'b', vout: 0, satoshis: 500, script: '' },
        { txid: 'c', vout: 0, satoshis: 2000, script: '' }
      ]

      const sorted = sortUtxosByValue(utxos)

      expect(sorted[0].satoshis).toBe(500)
      expect(sorted[1].satoshis).toBe(1000)
      expect(sorted[2].satoshis).toBe(2000)
    })

    it('should not mutate original array', () => {
      const utxos: UTXO[] = [
        { txid: 'a', vout: 0, satoshis: 1000, script: '' },
        { txid: 'b', vout: 0, satoshis: 500, script: '' }
      ]

      const sorted = sortUtxosByValue(utxos)

      expect(utxos[0].satoshis).toBe(1000) // Original unchanged
      expect(sorted[0].satoshis).toBe(500)
    })
  })

  describe('selectCoins', () => {
    it('should return empty array if no UTXOs', () => {
      const result = selectCoins([], 1000)
      expect(result.selected).toEqual([])
      expect(result.total).toBe(0)
      expect(result.sufficient).toBe(false)
    })

    it('should select minimum UTXOs to cover amount', () => {
      const utxos: UTXO[] = [
        { txid: 'a', vout: 0, satoshis: 500, script: '' },
        { txid: 'b', vout: 0, satoshis: 600, script: '' },
        { txid: 'c', vout: 0, satoshis: 700, script: '' }
      ]

      const result = selectCoins(utxos, 1000)

      expect(result.sufficient).toBe(true)
      expect(result.total).toBeGreaterThanOrEqual(1000)
    })

    it('should add buffer for fees', () => {
      const utxos: UTXO[] = [
        { txid: 'a', vout: 0, satoshis: 1000, script: '' },
        { txid: 'b', vout: 0, satoshis: 500, script: '' }
      ]

      // Asking for 1000, but with 100 buffer, needs more
      const result = selectCoins(utxos, 1000, 100)

      expect(result.total).toBeGreaterThanOrEqual(1100)
    })

    it('should return insufficient if not enough funds', () => {
      const utxos: UTXO[] = [
        { txid: 'a', vout: 0, satoshis: 100, script: '' }
      ]

      const result = selectCoins(utxos, 1000)

      expect(result.sufficient).toBe(false)
      expect(result.total).toBe(100)
    })
  })

  describe('selectCoinsMultiKey', () => {
    it('should work with ExtendedUTXOs', () => {
      const utxos: ExtendedUTXO[] = [
        { txid: 'a', vout: 0, satoshis: 500, script: '', wif: 'wif1', address: 'addr1' },
        { txid: 'b', vout: 0, satoshis: 600, script: '', wif: 'wif2', address: 'addr2' }
      ]

      const result = selectCoinsMultiKey(utxos, 1000)

      expect(result.sufficient).toBe(true)
      expect(result.selected[0].wif).toBeDefined()
    })
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/domain/transaction/coinSelection.test.ts
```

Expected: FAIL with "Cannot find module './coinSelection'"

**Step 3: Implement coin selection functions**

Create `src/domain/transaction/coinSelection.ts`:

```typescript
/**
 * Pure coin selection algorithms
 * No side effects, no database access
 */

import type { UTXO, ExtendedUTXO } from '../types'

export interface CoinSelectionResult<T extends UTXO = UTXO> {
  selected: T[]
  total: number
  sufficient: boolean
}

/**
 * Sort UTXOs by value (smallest first for efficient coin selection)
 * Pure function - returns new array
 */
export function sortUtxosByValue<T extends UTXO>(utxos: T[]): T[] {
  return [...utxos].sort((a, b) => a.satoshis - b.satoshis)
}

/**
 * Select coins using greedy algorithm (smallest first)
 * Pure function - no side effects
 *
 * @param utxos - Available UTXOs to select from
 * @param targetAmount - Amount needed in satoshis
 * @param buffer - Extra amount to ensure sufficient for fees (default 100)
 */
export function selectCoins(
  utxos: UTXO[],
  targetAmount: number,
  buffer: number = 100
): CoinSelectionResult<UTXO> {
  if (utxos.length === 0) {
    return { selected: [], total: 0, sufficient: false }
  }

  const sorted = sortUtxosByValue(utxos)
  const selected: UTXO[] = []
  let total = 0
  const target = targetAmount + buffer

  for (const utxo of sorted) {
    selected.push(utxo)
    total += utxo.satoshis

    if (total >= target) {
      break
    }
  }

  return {
    selected,
    total,
    sufficient: total >= targetAmount
  }
}

/**
 * Select coins from ExtendedUTXOs (multi-key support)
 * Pure function - no side effects
 */
export function selectCoinsMultiKey(
  utxos: ExtendedUTXO[],
  targetAmount: number,
  buffer: number = 100
): CoinSelectionResult<ExtendedUTXO> {
  if (utxos.length === 0) {
    return { selected: [], total: 0, sufficient: false }
  }

  const sorted = sortUtxosByValue(utxos)
  const selected: ExtendedUTXO[] = []
  let total = 0
  const target = targetAmount + buffer

  for (const utxo of sorted) {
    selected.push(utxo)
    total += utxo.satoshis

    if (total >= target) {
      break
    }
  }

  return {
    selected,
    total,
    sufficient: total >= targetAmount
  }
}

/**
 * Calculate if change output is needed
 * Pure function
 */
export function needsChangeOutput(
  totalInput: number,
  sendAmount: number,
  fee: number,
  dustThreshold: number = 1 // BSV has no dust limit, but we use 1 sat minimum
): boolean {
  const change = totalInput - sendAmount - fee
  return change >= dustThreshold
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/domain/transaction/coinSelection.test.ts
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/domain/transaction/coinSelection.ts src/domain/transaction/coinSelection.test.ts
git commit -m "feat(domain): add pure coin selection algorithms with tests"
```

---

## Phase 2: Infrastructure Layer Setup

### Task 2.1: Create Infrastructure Directory Structure

**Files:**
- Create: `src/infrastructure/index.ts`
- Create: `src/infrastructure/api/index.ts`
- Create: `src/infrastructure/database/index.ts`
- Create: `src/infrastructure/storage/index.ts`

**Step 1: Create the infrastructure directory structure**

```bash
mkdir -p src/infrastructure/api src/infrastructure/database src/infrastructure/storage src/infrastructure/broadcast
```

**Step 2: Create infrastructure barrel exports**

Create `src/infrastructure/index.ts`:

```typescript
/**
 * Infrastructure Layer - I/O and Side Effects
 *
 * This layer handles all external interactions:
 * - Database operations
 * - API calls (WhatsOnChain, GorillaPool)
 * - File storage
 * - Transaction broadcasting
 *
 * Functions here have side effects and should be injected
 * into domain logic when needed.
 */

export * from './api'
export * from './database'
export * from './storage'
```

Create `src/infrastructure/api/index.ts`:

```typescript
/**
 * API Clients - External service integrations
 */

export * from './wocClient'
export * from './feeService'
```

Create `src/infrastructure/database/index.ts`:

```typescript
/**
 * Database - Repository pattern for SQLite operations
 */

export * from './connection'
export * from './utxoRepository'
```

Create `src/infrastructure/storage/index.ts`:

```typescript
/**
 * Storage - LocalStorage and encrypted file operations
 */

export * from './localStorage'
export * from './feeRateStore'
```

**Step 3: Commit**

```bash
git add src/infrastructure/
git commit -m "feat: add infrastructure layer foundation"
```

---

### Task 2.2: Create WhatsOnChain API Client

**Files:**
- Create: `src/infrastructure/api/wocClient.ts`
- Create: `src/infrastructure/api/wocClient.test.ts`

**Step 1: Write failing tests for WoC client**

Create `src/infrastructure/api/wocClient.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  WocClient,
  createWocClient,
  DEFAULT_WOC_CONFIG
} from './wocClient'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('WocClient', () => {
  let client: WocClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = createWocClient()
  })

  describe('getBlockHeight', () => {
    it('should fetch current block height', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ blocks: 850000 })
      })

      const height = await client.getBlockHeight()

      expect(height).toBe(850000)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/chain/info'),
        expect.any(Object)
      )
    })

    it('should return 0 on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const height = await client.getBlockHeight()

      expect(height).toBe(0)
    })
  })

  describe('getBalance', () => {
    it('should fetch address balance', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ confirmed: 10000, unconfirmed: 500 })
      })

      const balance = await client.getBalance('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')

      expect(balance).toBe(10500)
    })

    it('should return 0 on error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      })

      const balance = await client.getBalance('invalid')

      expect(balance).toBe(0)
    })
  })

  describe('getUtxos', () => {
    it('should fetch UTXOs for address', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { tx_hash: 'abc123', tx_pos: 0, value: 10000 }
        ])
      })

      const utxos = await client.getUtxos('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')

      expect(utxos).toHaveLength(1)
      expect(utxos[0].txid).toBe('abc123')
      expect(utxos[0].vout).toBe(0)
      expect(utxos[0].satoshis).toBe(10000)
    })

    it('should return empty array on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const utxos = await client.getUtxos('invalid')

      expect(utxos).toEqual([])
    })
  })

  describe('custom config', () => {
    it('should use custom base URL', async () => {
      const customClient = createWocClient({
        baseUrl: 'https://custom.api.com'
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ blocks: 1 })
      })

      await customClient.getBlockHeight()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://custom.api.com'),
        expect.any(Object)
      )
    })
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/infrastructure/api/wocClient.test.ts
```

Expected: FAIL with "Cannot find module './wocClient'"

**Step 3: Implement WoC client**

Create `src/infrastructure/api/wocClient.ts`:

```typescript
/**
 * WhatsOnChain API Client
 * Handles all WoC API interactions with proper error handling
 */

import { P2PKH } from '@bsv/sdk'
import type { UTXO } from '../../domain/types'

export interface WocConfig {
  baseUrl: string
  timeout: number
}

export const DEFAULT_WOC_CONFIG: WocConfig = {
  baseUrl: 'https://api.whatsonchain.com/v1/bsv/main',
  timeout: 30000
}

export interface WocClient {
  getBlockHeight(): Promise<number>
  getBalance(address: string): Promise<number>
  getUtxos(address: string): Promise<UTXO[]>
  getTransactionHistory(address: string): Promise<{ tx_hash: string; height: number }[]>
  getTransactionDetails(txid: string): Promise<any | null>
  broadcastTransaction(txHex: string): Promise<string>
}

/**
 * Create a WhatsOnChain API client
 * Returns an object with methods - allows dependency injection
 */
export function createWocClient(config: Partial<WocConfig> = {}): WocClient {
  const cfg: WocConfig = { ...DEFAULT_WOC_CONFIG, ...config }

  const fetchWithTimeout = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), cfg.timeout)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      })
      return response
    } finally {
      clearTimeout(timeoutId)
    }
  }

  return {
    async getBlockHeight(): Promise<number> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/chain/info`)
        if (!response.ok) return 0
        const data = await response.json()
        return data.blocks ?? 0
      } catch {
        return 0
      }
    },

    async getBalance(address: string): Promise<number> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/address/${address}/balance`)
        if (!response.ok) return 0
        const data = await response.json()
        if (typeof data.confirmed !== 'number' || typeof data.unconfirmed !== 'number') {
          return 0
        }
        return data.confirmed + data.unconfirmed
      } catch {
        return 0
      }
    },

    async getUtxos(address: string): Promise<UTXO[]> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/address/${address}/unspent`)
        if (!response.ok) return []
        const data = await response.json()
        if (!Array.isArray(data)) return []

        // Generate the P2PKH locking script for this address
        const lockingScript = new P2PKH().lock(address)

        return data.map((utxo: any) => ({
          txid: utxo.tx_hash,
          vout: utxo.tx_pos,
          satoshis: utxo.value,
          script: lockingScript.toHex()
        }))
      } catch {
        return []
      }
    },

    async getTransactionHistory(address: string): Promise<{ tx_hash: string; height: number }[]> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/address/${address}/history`)
        if (!response.ok) return []
        const data = await response.json()
        if (!Array.isArray(data)) return []
        return data
      } catch {
        return []
      }
    },

    async getTransactionDetails(txid: string): Promise<any | null> {
      try {
        const response = await fetchWithTimeout(`${cfg.baseUrl}/tx/${txid}`)
        if (!response.ok) return null
        return await response.json()
      } catch {
        return null
      }
    },

    async broadcastTransaction(txHex: string): Promise<string> {
      const response = await fetchWithTimeout(`${cfg.baseUrl}/tx/raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txhex: txHex })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Broadcast failed: ${errorText}`)
      }

      // WoC returns the txid as plain text
      const txid = await response.text()
      return txid.replace(/"/g, '') // Remove quotes if present
    }
  }
}

// Default client instance for convenience
let defaultClient: WocClient | null = null

export function getWocClient(): WocClient {
  if (!defaultClient) {
    defaultClient = createWocClient()
  }
  return defaultClient
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/infrastructure/api/wocClient.test.ts
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/infrastructure/api/wocClient.ts src/infrastructure/api/wocClient.test.ts
git commit -m "feat(infrastructure): add WhatsOnChain API client with tests"
```

---

### Task 2.3: Create Fee Rate Service

**Files:**
- Create: `src/infrastructure/api/feeService.ts`
- Create: `src/infrastructure/api/feeService.test.ts`

**Step 1: Write failing tests for fee service**

Create `src/infrastructure/api/feeService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  FeeService,
  createFeeService
} from './feeService'
import { DEFAULT_FEE_RATE } from '../../domain/transaction/fees'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('FeeService', () => {
  let service: FeeService

  beforeEach(() => {
    vi.clearAllMocks()
    // Clear localStorage
    localStorage.clear()
    service = createFeeService()
  })

  describe('fetchDynamicFeeRate', () => {
    it('should fetch fee rate from GorillaPool', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payload: JSON.stringify({
            fees: [
              { feeType: 'standard', miningFee: { satoshis: 50, bytes: 1000 } }
            ]
          })
        })
      })

      const rate = await service.fetchDynamicFeeRate()

      expect(rate).toBe(0.05) // 50/1000
    })

    it('should return default rate on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const rate = await service.fetchDynamicFeeRate()

      expect(rate).toBe(DEFAULT_FEE_RATE)
    })

    it('should clamp rate to valid range', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payload: JSON.stringify({
            fees: [
              { feeType: 'standard', miningFee: { satoshis: 5000, bytes: 1000 } } // 5 sat/byte, too high
            ]
          })
        })
      })

      const rate = await service.fetchDynamicFeeRate()

      expect(rate).toBe(1.0) // Clamped to max
    })
  })

  describe('getFeeRate', () => {
    it('should return user override if set', () => {
      service.setFeeRate(0.1)

      const rate = service.getFeeRate()

      expect(rate).toBe(0.1)
    })

    it('should return default rate if no override', () => {
      const rate = service.getFeeRate()

      expect(rate).toBe(DEFAULT_FEE_RATE)
    })
  })

  describe('setFeeRate / clearFeeRateOverride', () => {
    it('should persist fee rate override', () => {
      service.setFeeRate(0.2)

      const rate = service.getFeeRate()

      expect(rate).toBe(0.2)
    })

    it('should clear override', () => {
      service.setFeeRate(0.2)
      service.clearFeeRateOverride()

      const rate = service.getFeeRate()

      expect(rate).toBe(DEFAULT_FEE_RATE)
    })
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/infrastructure/api/feeService.test.ts
```

Expected: FAIL with "Cannot find module './feeService'"

**Step 3: Implement fee service**

Create `src/infrastructure/api/feeService.ts`:

```typescript
/**
 * Fee Rate Service
 * Fetches dynamic fee rates and manages user overrides
 */

import {
  DEFAULT_FEE_RATE,
  MIN_FEE_RATE,
  MAX_FEE_RATE,
  clampFeeRate
} from '../../domain/transaction/fees'

const STORAGE_KEY = 'simply_sats_fee_rate'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export interface FeeService {
  fetchDynamicFeeRate(): Promise<number>
  getFeeRate(): number
  getFeeRateAsync(): Promise<number>
  setFeeRate(rate: number): void
  clearFeeRateOverride(): void
}

export interface FeeServiceConfig {
  mapiUrl: string
  timeout: number
}

const DEFAULT_CONFIG: FeeServiceConfig = {
  mapiUrl: 'https://mapi.gorillapool.io/mapi/feeQuote',
  timeout: 10000
}

/**
 * Create a fee rate service
 */
export function createFeeService(config: Partial<FeeServiceConfig> = {}): FeeService {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // Internal cache
  let cachedRate: { rate: number; timestamp: number } | null = null

  return {
    async fetchDynamicFeeRate(): Promise<number> {
      // Check cache first
      if (cachedRate && Date.now() - cachedRate.timestamp < CACHE_TTL_MS) {
        return cachedRate.rate
      }

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), cfg.timeout)

        const response = await fetch(cfg.mapiUrl, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (response.ok) {
          const result = await response.json()
          const payload = typeof result.payload === 'string'
            ? JSON.parse(result.payload)
            : result.payload

          if (payload?.fees) {
            const standardFee = payload.fees.find((f: { feeType: string }) => f.feeType === 'standard')
            if (standardFee?.miningFee) {
              const ratePerByte = standardFee.miningFee.satoshis / standardFee.miningFee.bytes
              const clampedRate = clampFeeRate(ratePerByte)

              // Cache the result
              cachedRate = { rate: clampedRate, timestamp: Date.now() }
              return clampedRate
            }
          }
        }
      } catch {
        // Fall through to default
      }

      return DEFAULT_FEE_RATE
    },

    getFeeRate(): number {
      // Check for user override first
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const rate = parseFloat(stored)
        if (!isNaN(rate) && rate > 0) {
          return rate
        }
      }

      // Use cached dynamic rate if available
      if (cachedRate && Date.now() - cachedRate.timestamp < CACHE_TTL_MS) {
        return cachedRate.rate
      }

      return DEFAULT_FEE_RATE
    },

    async getFeeRateAsync(): Promise<number> {
      // Check for user override first
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const rate = parseFloat(stored)
        if (!isNaN(rate) && rate > 0) {
          return rate
        }
      }

      // Fetch dynamic rate
      return this.fetchDynamicFeeRate()
    },

    setFeeRate(rate: number): void {
      localStorage.setItem(STORAGE_KEY, String(rate))
    },

    clearFeeRateOverride(): void {
      localStorage.removeItem(STORAGE_KEY)
    }
  }
}

// Default service instance
let defaultService: FeeService | null = null

export function getFeeService(): FeeService {
  if (!defaultService) {
    defaultService = createFeeService()
  }
  return defaultService
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- --run src/infrastructure/api/feeService.test.ts
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/infrastructure/api/feeService.ts src/infrastructure/api/feeService.test.ts
git commit -m "feat(infrastructure): add fee rate service with caching and tests"
```

---

## Phase 3: Adapter Layer - Bridge Old and New

### Task 3.1: Create Adapter for Wallet Service

**Files:**
- Create: `src/adapters/walletAdapter.ts`
- Modify: `src/services/wallet.ts` (thin changes to use adapters)

**Step 1: Create adapters directory**

```bash
mkdir -p src/adapters
```

**Step 2: Create wallet adapter that bridges old and new**

Create `src/adapters/walletAdapter.ts`:

```typescript
/**
 * Wallet Adapter
 *
 * Bridges the old wallet.ts service with new domain layer.
 * Old code can import from here and get new implementations.
 * Once migration is complete, old services can be removed.
 */

// Re-export domain layer functions with same signatures as old code
export {
  deriveWalletKeys as restoreWallet,
  deriveKeysFromPath,
  keysFromWif,
  WALLET_PATHS
} from '../domain/wallet/keyDerivation'

export {
  validateMnemonic,
  normalizeMnemonic,
  isValidBSVAddress
} from '../domain/wallet/validation'

export {
  calculateTxFee,
  calculateLockFee,
  calculateMaxSend,
  calculateExactFee,
  feeFromBytes,
  DEFAULT_FEE_RATE
} from '../domain/transaction/fees'

export {
  selectCoins,
  selectCoinsMultiKey,
  sortUtxosByValue
} from '../domain/transaction/coinSelection'

// Re-export types
export type {
  WalletKeys,
  KeyPair,
  UTXO,
  ExtendedUTXO,
  FeeEstimate,
  MaxSendResult
} from '../domain/types'

// Infrastructure adapters
export { createWocClient, getWocClient } from '../infrastructure/api/wocClient'
export { createFeeService, getFeeService } from '../infrastructure/api/feeService'

/**
 * Create wallet from new mnemonic
 * Thin wrapper that generates mnemonic then uses domain layer
 */
import * as bip39 from 'bip39'
import { deriveWalletKeys } from '../domain/wallet/keyDerivation'
import type { WalletKeys } from '../domain/types'

export function createWallet(): WalletKeys {
  const mnemonic = bip39.generateMnemonic()
  return deriveWalletKeys(mnemonic)
}
```

**Step 3: Create adapters barrel export**

Create `src/adapters/index.ts`:

```typescript
/**
 * Adapters Layer
 *
 * Bridges old service code with new domain/infrastructure layers.
 * Import from here to get new implementations with old interfaces.
 */

export * from './walletAdapter'
```

**Step 4: Commit**

```bash
git add src/adapters/
git commit -m "feat: add adapter layer to bridge old and new architecture"
```

---

### Task 3.2: Update Domain Exports

**Files:**
- Modify: `src/domain/wallet/index.ts`
- Modify: `src/domain/transaction/index.ts`

**Step 1: Update wallet domain exports**

Update `src/domain/wallet/index.ts`:

```typescript
/**
 * Wallet Domain - Key derivation, signing, encryption
 */

export {
  deriveKeysFromPath,
  deriveWalletKeys,
  keysFromWif,
  WALLET_PATHS
} from './keyDerivation'

export {
  normalizeMnemonic,
  validateMnemonic,
  isValidBSVAddress,
  isValidTxid,
  isValidSatoshiAmount
} from './validation'
```

**Step 2: Update transaction domain exports**

Update `src/domain/transaction/index.ts`:

```typescript
/**
 * Transaction Domain - TX building, fee calculation, coin selection
 */

export {
  calculateTxFee,
  calculateLockFee,
  calculateMaxSend,
  calculateExactFee,
  feeFromBytes,
  varintSize,
  clampFeeRate,
  P2PKH_INPUT_SIZE,
  P2PKH_OUTPUT_SIZE,
  TX_OVERHEAD,
  DEFAULT_FEE_RATE,
  MIN_FEE_RATE,
  MAX_FEE_RATE
} from './fees'

export {
  selectCoins,
  selectCoinsMultiKey,
  sortUtxosByValue,
  needsChangeOutput,
  type CoinSelectionResult
} from './coinSelection'
```

**Step 3: Commit**

```bash
git add src/domain/
git commit -m "chore: update domain layer exports"
```

---

## Phase 4: Split WalletContext (Future Tasks)

> Note: These tasks are outlined but implementation details will be added after Phase 1-3 are complete and validated.

### Task 4.1: Create NetworkContext
Extract network-related state (blockHeight, overlayHealthy, overlayNodeCount, syncing) into dedicated context.

### Task 4.2: Create UIContext
Extract UI-related state (copyFeedback, toasts, displayInSats) into dedicated context.

### Task 4.3: Create AccountsContext
Extract multi-account state (accounts, activeAccount, switchAccount) into dedicated context.

### Task 4.4: Create TokensContext
Extract token-related state (tokenBalances, tokensSyncing, refreshTokens) into dedicated context.

### Task 4.5: Slim Down WalletContext
After extracting other contexts, WalletContext handles only core wallet state (wallet, balance, utxos, ordinals, locks).

---

## Phase 5: Migrate Components (Future Tasks)

### Task 5.1: Update SendModal to use new domain layer
### Task 5.2: Update LockModal to use new domain layer
### Task 5.3: Update sync.ts to use new infrastructure layer
### Task 5.4: Update wallet.ts to delegate to adapters

---

## Verification Checklist

After each phase, verify:

- [ ] All tests pass: `npm test -- --run`
- [ ] App still runs: `npm run dev` (in separate terminal)
- [ ] No TypeScript errors: `npm run typecheck` (if available) or check IDE
- [ ] Old code still works (hybrid approach - old and new coexist)

---

## Notes for Implementer

1. **Don't break existing code** - The hybrid approach means old services keep working. New code is additive.

2. **Test first** - Every new file should have corresponding tests. Run tests before and after each task.

3. **Small commits** - Each task should result in one atomic commit that doesn't break the build.

4. **Check imports** - When creating new files, make sure the barrel exports (index.ts files) include them.

5. **Domain is pure** - Functions in `src/domain/` must have no side effects. No fetch, no localStorage, no database. All inputs explicit, all outputs deterministic.

6. **Infrastructure handles I/O** - All API calls, database operations, and storage go in `src/infrastructure/`.

7. **Adapters bridge** - `src/adapters/` provides the same function signatures as old code but uses new implementations. This allows gradual migration.
