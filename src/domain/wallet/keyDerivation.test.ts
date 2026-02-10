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
