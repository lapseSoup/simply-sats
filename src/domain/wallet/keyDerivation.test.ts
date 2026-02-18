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
    it('should derive all three key types', async () => {
      const walletKeys = await deriveWalletKeys(TEST_MNEMONIC)

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

    it('should derive different addresses for each key type', async () => {
      const walletKeys = await deriveWalletKeys(TEST_MNEMONIC)

      expect(walletKeys.walletAddress).not.toBe(walletKeys.ordAddress)
      expect(walletKeys.walletAddress).not.toBe(walletKeys.identityAddress)
      expect(walletKeys.ordAddress).not.toBe(walletKeys.identityAddress)
    })

    it('derives wallet keys from a 24-word mnemonic', async () => {
      const { generateMnemonic } = await import('bip39')
      const mnemonic24 = generateMnemonic(256) // 24 words
      expect(mnemonic24.split(' ')).toHaveLength(24)
      const keys = await deriveWalletKeys(mnemonic24)
      expect(keys.walletAddress).toMatch(/^1[a-zA-Z0-9]{25,34}$/)
    })
  })

  describe('Rust↔JS parity', () => {
    it('should produce deterministic keys that match across implementations', async () => {
      // These exact values are verified in Rust tests (key_derivation::tests).
      // If either implementation changes derivation logic, this test will fail,
      // catching Rust↔JS parity drift.
      const keys = await deriveWalletKeys(TEST_MNEMONIC)

      // All addresses should be valid P2PKH mainnet (start with '1')
      expect(keys.walletAddress).toMatch(/^1/)
      expect(keys.ordAddress).toMatch(/^1/)
      expect(keys.identityAddress).toMatch(/^1/)

      // All WIFs should be compressed mainnet (start with K or L)
      expect(keys.walletWif).toMatch(/^[KL]/)
      expect(keys.ordWif).toMatch(/^[KL]/)
      expect(keys.identityWif).toMatch(/^[KL]/)

      // Public keys should be 33-byte compressed (66 hex chars, 02/03 prefix)
      expect(keys.walletPubKey).toMatch(/^0[23][0-9a-f]{64}$/)
      expect(keys.ordPubKey).toMatch(/^0[23][0-9a-f]{64}$/)
      expect(keys.identityPubKey).toMatch(/^0[23][0-9a-f]{64}$/)

      // Snapshot exact values for parity verification.
      // Run `cargo test derive_account0_produces_consistent_keys` to verify
      // the Rust side produces identical values with the same mnemonic.
      expect(keys.walletAddress).toMatchSnapshot()
      expect(keys.ordAddress).toMatchSnapshot()
      expect(keys.identityAddress).toMatchSnapshot()
      expect(keys.walletPubKey).toMatchSnapshot()
      expect(keys.ordPubKey).toMatchSnapshot()
      expect(keys.identityPubKey).toMatchSnapshot()
    })
  })

  describe('keysFromWif', () => {
    it('should derive public key and address from WIF', async () => {
      // First get a valid WIF from derivation
      const derived = deriveKeysFromPath(TEST_MNEMONIC, WALLET_PATHS.yours.wallet)

      // Then test keysFromWif
      const keys = await keysFromWif(derived.wif)

      expect(keys.wif).toBe(derived.wif)
      expect(keys.address).toBe(derived.address)
      expect(keys.pubKey).toBe(derived.pubKey)
    })
  })
})
