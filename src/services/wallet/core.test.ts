// @vitest-environment node

/**
 * Tests for Wallet Core (core.ts)
 *
 * Covers: createWallet, restoreWallet, importFromShaullet,
 *         importFrom1SatOrdinals, importFromJSON, verifyMnemonicMatchesWallet
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockGenerateMnemonic,
  mockDeriveWalletKeys,
  mockValidateMnemonic,
  mockKeysFromWif,
} = vi.hoisted(() => ({
  mockGenerateMnemonic: vi.fn(),
  mockDeriveWalletKeys: vi.fn(),
  mockValidateMnemonic: vi.fn(),
  mockKeysFromWif: vi.fn(),
}))

vi.mock('bip39', () => ({
  generateMnemonic: () => mockGenerateMnemonic(),
}))

vi.mock('../../domain/wallet/keyDerivation', () => ({
  deriveWalletKeys: (...args: unknown[]) => mockDeriveWalletKeys(...args),
  keysFromWif: (...args: unknown[]) => mockKeysFromWif(...args),
  WALLET_PATHS: { WALLET: "m/44'/236'/0'/0/0", ORDINALS: "m/44'/236'/0'/1/0", IDENTITY: "m/44'/236'/0'/2/0" },
}))

vi.mock('../../domain/wallet/validation', () => ({
  validateMnemonic: (...args: unknown[]) => mockValidateMnemonic(...args),
}))

vi.mock('../logger', () => ({
  walletLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../errors', () => {
  class AppError extends Error {
    code: number
    context?: Record<string, unknown>
    constructor(msg: string, code: number, ctx?: Record<string, unknown>) {
      super(msg)
      this.name = 'AppError'
      this.code = code
      this.context = ctx
    }
  }
  return {
    AppError,
    ErrorCodes: {
      INVALID_MNEMONIC: -32012,
      ENCRYPTION_ERROR: -32010,
    },
  }
})

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  createWallet,
  restoreWallet,
  importFromShaullet,
  importFrom1SatOrdinals,
  importFromJSON,
  verifyMnemonicMatchesWallet,
} from './core'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

function makeWalletKeys(overrides: Record<string, unknown> = {}) {
  return {
    mnemonic: VALID_MNEMONIC,
    walletType: 'yours',
    walletWif: 'L1walletWif',
    walletAddress: '1WalletAddr',
    walletPubKey: '02' + 'a'.repeat(64),
    ordWif: 'L2ordWif',
    ordAddress: '1OrdAddr',
    ordPubKey: '02' + 'b'.repeat(64),
    identityWif: 'L3identityWif',
    identityAddress: '1IdentityAddr',
    identityPubKey: '02' + 'c'.repeat(64),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Wallet Core', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockValidateMnemonic.mockReturnValue({
      isValid: true,
      normalizedMnemonic: VALID_MNEMONIC,
    })
    mockDeriveWalletKeys.mockResolvedValue(makeWalletKeys())
    mockKeysFromWif.mockReturnValue({
      wif: 'L1importedWif',
      address: '1ImportedAddr',
      pubKey: '02' + 'd'.repeat(64),
    })
  })

  // =========================================================================
  // createWallet
  // =========================================================================

  describe('createWallet', () => {
    it('should generate mnemonic and return wallet keys', async () => {
      mockGenerateMnemonic.mockReturnValue(VALID_MNEMONIC)

      const keys = await createWallet()

      expect(keys.mnemonic).toBe(VALID_MNEMONIC)
      expect(keys.walletAddress).toBe('1WalletAddr')
      expect(mockGenerateMnemonic).toHaveBeenCalledOnce()
      expect(mockDeriveWalletKeys).toHaveBeenCalledWith(VALID_MNEMONIC)
    })
  })

  // =========================================================================
  // restoreWallet
  // =========================================================================

  describe('restoreWallet', () => {
    it('should restore wallet from valid mnemonic', async () => {
      const keys = await restoreWallet(VALID_MNEMONIC)

      expect(keys.walletAddress).toBe('1WalletAddr')
      expect(mockValidateMnemonic).toHaveBeenCalledWith(VALID_MNEMONIC)
      expect(mockDeriveWalletKeys).toHaveBeenCalledWith(VALID_MNEMONIC)
    })

    it('should throw on invalid mnemonic', async () => {
      mockValidateMnemonic.mockReturnValue({
        isValid: false,
        error: 'Invalid checksum',
      })

      await expect(restoreWallet('bad mnemonic phrase'))
        .rejects.toThrow('Invalid checksum')
    })

    it('should throw when validation returns no normalized mnemonic', async () => {
      mockValidateMnemonic.mockReturnValue({
        isValid: true,
        normalizedMnemonic: undefined,
      })

      await expect(restoreWallet(VALID_MNEMONIC))
        .rejects.toThrow()
    })

    it('should throw when key derivation fails', async () => {
      mockDeriveWalletKeys.mockRejectedValue(new Error('Derivation error'))

      await expect(restoreWallet(VALID_MNEMONIC))
        .rejects.toThrow('Failed to derive wallet keys from mnemonic')
    })
  })

  // =========================================================================
  // importFromShaullet
  // =========================================================================

  describe('importFromShaullet', () => {
    it('should import from Shaullet backup with mnemonic', async () => {
      const backup = JSON.stringify({ mnemonic: VALID_MNEMONIC })

      const keys = await importFromShaullet(backup)

      expect(keys.walletAddress).toBe('1WalletAddr')
      expect(mockDeriveWalletKeys).toHaveBeenCalledWith(VALID_MNEMONIC)
    })

    it('should import from Shaullet backup with WIF', async () => {
      const backup = JSON.stringify({ keys: { wif: 'L1testWif' } })

      const keys = await importFromShaullet(backup)

      expect(keys.walletWif).toBe('L1importedWif')
      expect(keys.mnemonic).toBe('')
      expect(mockKeysFromWif).toHaveBeenCalledWith('L1testWif')
    })

    it('should throw on invalid JSON', async () => {
      await expect(importFromShaullet('not json'))
        .rejects.toThrow('Invalid JSON format')
    })

    it('should throw on invalid backup format (no mnemonic or wif)', async () => {
      const backup = JSON.stringify({ foo: 'bar' })

      await expect(importFromShaullet(backup))
        .rejects.toThrow('Invalid Shaullet backup format')
    })
  })

  // =========================================================================
  // importFrom1SatOrdinals
  // =========================================================================

  describe('importFrom1SatOrdinals', () => {
    it('should import from 1Sat backup with mnemonic', async () => {
      const backup = JSON.stringify({ mnemonic: VALID_MNEMONIC })

      const keys = await importFrom1SatOrdinals(backup)

      expect(keys.walletAddress).toBe('1WalletAddr')
    })

    it('should import from 1Sat backup with payPk and ordPk', async () => {
      mockKeysFromWif
        .mockResolvedValueOnce({ wif: 'payWif', address: '1PayAddr', pubKey: '02' + 'e'.repeat(64) })
        .mockResolvedValueOnce({ wif: 'ordWif', address: '1OrdAddr', pubKey: '02' + 'f'.repeat(64) })

      const backup = JSON.stringify({ payPk: 'payWif', ordPk: 'ordWif' })

      const keys = await importFrom1SatOrdinals(backup)

      expect(keys.walletWif).toBe('payWif')
      expect(keys.ordWif).toBe('ordWif')
      expect(keys.mnemonic).toBe('')
    })

    it('should use ordPk as primary when payPk is missing', async () => {
      mockKeysFromWif
        .mockResolvedValueOnce({ wif: 'ordWif', address: '1OrdAddr', pubKey: '02' + 'f'.repeat(64) })

      const backup = JSON.stringify({ ordPk: 'ordWif' })

      const keys = await importFrom1SatOrdinals(backup)

      expect(keys.walletWif).toBe('ordWif')
      expect(keys.ordWif).toBe('ordWif')
    })

    it('should throw on invalid JSON', async () => {
      await expect(importFrom1SatOrdinals('not json'))
        .rejects.toThrow('Invalid JSON format')
    })

    it('should throw on invalid 1Sat backup format', async () => {
      const backup = JSON.stringify({ foo: 'bar' })

      await expect(importFrom1SatOrdinals(backup))
        .rejects.toThrow('Invalid 1Sat Ordinals backup format')
    })
  })

  // =========================================================================
  // importFromJSON
  // =========================================================================

  describe('importFromJSON', () => {
    it('should detect and import 1Sat format (has ordPk)', async () => {
      mockKeysFromWif
        .mockResolvedValueOnce({ wif: 'ordWif', address: '1OrdAddr', pubKey: '02' + 'f'.repeat(64) })

      const backup = JSON.stringify({ ordPk: 'ordWif' })

      const keys = await importFromJSON(backup)

      expect(keys.walletWif).toBe('ordWif')
    })

    it('should detect and import Shaullet format (has mnemonic)', async () => {
      const backup = JSON.stringify({ mnemonic: VALID_MNEMONIC })

      const keys = await importFromJSON(backup)

      expect(keys.walletAddress).toBe('1WalletAddr')
    })

    it('should detect and import Shaullet format (has keys object)', async () => {
      const backup = JSON.stringify({ keys: { wif: 'L1testWif' } })

      const keys = await importFromJSON(backup)

      expect(keys.walletWif).toBe('L1importedWif')
    })

    it('should throw on unknown format', async () => {
      const backup = JSON.stringify({ unknown: 'format' })

      await expect(importFromJSON(backup))
        .rejects.toThrow('Unknown backup format')
    })

    it('should throw on invalid JSON', async () => {
      await expect(importFromJSON('not json'))
        .rejects.toThrow('Invalid JSON format')
    })
  })

  // =========================================================================
  // verifyMnemonicMatchesWallet
  // =========================================================================

  describe('verifyMnemonicMatchesWallet', () => {
    it('should return valid when addresses match', async () => {
      const result = await verifyMnemonicMatchesWallet(VALID_MNEMONIC, '1WalletAddr')

      expect(result.valid).toBe(true)
      expect(result.derivedAddress).toBe('1WalletAddr')
    })

    it('should return invalid when addresses do not match', async () => {
      const result = await verifyMnemonicMatchesWallet(VALID_MNEMONIC, '1DifferentAddr')

      expect(result.valid).toBe(false)
      expect(result.derivedAddress).toBe('1WalletAddr')
    })

    it('should throw when mnemonic is invalid', async () => {
      mockValidateMnemonic.mockReturnValue({
        isValid: false,
        error: 'Bad mnemonic',
      })

      await expect(verifyMnemonicMatchesWallet('bad phrase', '1Addr'))
        .rejects.toThrow()
    })
  })
})
