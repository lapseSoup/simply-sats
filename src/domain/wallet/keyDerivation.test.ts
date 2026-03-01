import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  deriveWalletKeys,
  keysFromWif,
  WALLET_PATHS
} from './keyDerivation'

// Mock the tauri utility module
const mockTauriInvoke = vi.fn()
const mockIsTauri = vi.fn(() => true)
vi.mock('../../utils/tauri', () => ({
  isTauri: () => mockIsTauri(),
  tauriInvoke: (...args: unknown[]) => mockTauriInvoke(...args),
}))

// Known test mnemonic (DO NOT use in production)
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('Key Derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('WALLET_PATHS', () => {
    it('should have correct Yours wallet paths', () => {
      expect(WALLET_PATHS.yours.wallet).toBe("m/44'/236'/0'/1/0")
      expect(WALLET_PATHS.yours.ordinals).toBe("m/44'/236'/1'/0/0")
      expect(WALLET_PATHS.yours.identity).toBe("m/0'/236'/0'/0/0")
    })
  })

  describe('deriveWalletKeys', () => {
    it('should call Tauri derive_wallet_keys command', async () => {
      const mockResult = {
        mnemonic: TEST_MNEMONIC,
        walletType: 'yours',
        walletWif: 'L1walletWif',
        walletAddress: '1WalletAddr',
        walletPubKey: '02walletpubkey',
        ordWif: 'L1ordWif',
        ordAddress: '1OrdAddr',
        ordPubKey: '02ordpubkey',
        identityWif: 'L1identityWif',
        identityAddress: '1IdentityAddr',
        identityPubKey: '02identitypubkey',
        accountIndex: 0
      }
      mockTauriInvoke.mockResolvedValueOnce(mockResult)

      const walletKeys = await deriveWalletKeys(TEST_MNEMONIC)

      expect(mockTauriInvoke).toHaveBeenCalledWith('derive_wallet_keys', { mnemonic: TEST_MNEMONIC })
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
      const mockResult = {
        mnemonic: TEST_MNEMONIC,
        walletType: 'yours',
        walletWif: 'L1walletWif',
        walletAddress: '1WalletAddr',
        walletPubKey: '02walletpubkey',
        ordWif: 'L1ordWif',
        ordAddress: '1OrdAddr',
        ordPubKey: '02ordpubkey',
        identityWif: 'L1identityWif',
        identityAddress: '1IdentityAddr',
        identityPubKey: '02identitypubkey',
        accountIndex: 0
      }
      mockTauriInvoke.mockResolvedValueOnce(mockResult)

      const walletKeys = await deriveWalletKeys(TEST_MNEMONIC)

      expect(walletKeys.walletAddress).not.toBe(walletKeys.ordAddress)
      expect(walletKeys.walletAddress).not.toBe(walletKeys.identityAddress)
      expect(walletKeys.ordAddress).not.toBe(walletKeys.identityAddress)
    })

    it('should throw when Tauri is unavailable', async () => {
      mockIsTauri.mockReturnValueOnce(false)

      await expect(deriveWalletKeys(TEST_MNEMONIC)).rejects.toThrow('requires the Tauri runtime')
    })
  })

  describe('keysFromWif', () => {
    it('should call Tauri keys_from_wif command', async () => {
      const testWif = 'L1HKVVLHXiUhecWnwFYF6L3shkf1E12HUmuZTESvBXUdx3yqVP1D'
      const mockResult = {
        wif: testWif,
        address: '1DeriveAddr',
        pubKey: '02derivepubkey'
      }
      mockTauriInvoke.mockResolvedValueOnce(mockResult)

      const keys = await keysFromWif(testWif)

      expect(mockTauriInvoke).toHaveBeenCalledWith('keys_from_wif', { wif: testWif })
      expect(keys.wif).toBe(testWif)
      expect(keys.address).toBe('1DeriveAddr')
      expect(keys.pubKey).toBe('02derivepubkey')
    })

    it('should throw when Tauri is unavailable', async () => {
      mockIsTauri.mockReturnValueOnce(false)

      await expect(keysFromWif('L1test')).rejects.toThrow('requires the Tauri runtime')
    })
  })
})
