// @vitest-environment node
/**
 * Tests for useWalletActions hook
 *
 * Covers the security-critical restore and import flows:
 *   - handleRestoreWallet: password validation, save path selection, state updates
 *   - handleImportJSON: password validation, save path selection, state updates
 *   - handleCreateWallet: password enforcement, unprotected path
 *
 * These are the orchestration paths that RestoreModal and OnboardingFlow rely on.
 * The underlying crypto (restoreWallet, saveWallet, encrypt) is tested in their
 * own unit test files; this file tests the hook's integration and security invariants.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------- Hoisted mock state ----------

const {
  mockRestoreWallet,
  mockCreateWallet,
  mockImportFromJSON,
  mockSaveWallet,
  mockSaveWalletUnprotected,
  mockMigrateToMultiAccount,
  mockRefreshAccounts,
  mockGetActiveAccount,
  mockSetWallet,
  mockSetIsLocked,
  mockSetSessionPassword,
  mockSetContacts,
  mockSetFeeRateKBState,
  mockResetSync,
  mockSetLocks,
  mockResetTokens,
  mockResetAccounts,
  mockSetAutoLockMinutesState,
  mockSetActiveAccountState,
} = vi.hoisted(() => ({
  mockRestoreWallet: vi.fn(),
  mockCreateWallet: vi.fn(),
  mockImportFromJSON: vi.fn(),
  mockSaveWallet: vi.fn(),
  mockSaveWalletUnprotected: vi.fn(),
  mockMigrateToMultiAccount: vi.fn(),
  mockRefreshAccounts: vi.fn(),
  mockGetActiveAccount: vi.fn(),
  mockSetWallet: vi.fn(),
  mockSetIsLocked: vi.fn(),
  mockSetSessionPassword: vi.fn(),
  mockSetContacts: vi.fn(),
  mockSetFeeRateKBState: vi.fn(),
  mockResetSync: vi.fn(),
  mockSetLocks: vi.fn(),
  mockResetTokens: vi.fn(),
  mockResetAccounts: vi.fn(),
  mockSetAutoLockMinutesState: vi.fn(),
  mockSetActiveAccountState: vi.fn(),
}))

// ---------- Mocks ----------

vi.mock('../services/wallet', () => ({
  restoreWallet: (...args: unknown[]) => mockRestoreWallet(...args),
  createWallet: (...args: unknown[]) => mockCreateWallet(...args),
  importFromJSON: (...args: unknown[]) => mockImportFromJSON(...args),
  saveWallet: (...args: unknown[]) => mockSaveWallet(...args),
  saveWalletUnprotected: (...args: unknown[]) => mockSaveWalletUnprotected(...args),
}))

vi.mock('../services/accounts', () => ({
  migrateToMultiAccount: (...args: unknown[]) => mockMigrateToMultiAccount(...args),
  getActiveAccount: (...args: unknown[]) => mockGetActiveAccount(...args),
}))

vi.mock('../services/database', () => ({
  clearDatabase: vi.fn(),
}))

vi.mock('../services/secureStorage', () => ({
  clearAllSimplySatsStorage: vi.fn(),
}))

vi.mock('../services/autoLock', () => ({
  stopAutoLock: vi.fn(),
  initAutoLock: vi.fn(),
}))

vi.mock('../services/auditLog', () => ({
  audit: {
    walletCreated: vi.fn(),
    walletRestored: vi.fn(),
  },
}))

vi.mock('../services/logger', () => ({
  walletLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/sessionPasswordStore', () => ({
  setSessionPassword: vi.fn(),
  clearSessionPassword: vi.fn(),
  NO_PASSWORD: '',
}))

vi.mock('../utils/passwordValidation', () => ({
  validatePassword: (pwd: string) => {
    if (pwd.length < 14) {
      return { isValid: false, errors: ['Password must be at least 14 characters'], score: 0 }
    }
    return { isValid: true, errors: [], score: 3 }
  },
  MIN_PASSWORD_LENGTH: 14,
}))

// useCallback/useRef require React — but we test the inner functions directly
// by invoking useWalletActions without a React rendering context
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useCallback: (fn: unknown) => fn,
    useRef: (initialValue: unknown) => ({ current: initialValue }),
  }
})

import { useWalletActions } from './useWalletActions'
import type { WalletKeys } from '../services/wallet'

// ---------- Test fixtures ----------

const testKeys: WalletKeys = {
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  walletType: 'yours',
  walletWif: 'L1RrrnXkcKut5DEMwtDthjwRcTTwED36thyL1DebVrKuwvohjMNi',
  walletAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  walletPubKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  ordWif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn',
  ordAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
  ordPubKey: '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
  identityWif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU74NMTptX4',
  identityAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3',
  identityPubKey: '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
}

const VALID_PASSWORD = 'StrongPassword123!'
const WEAK_PASSWORD = 'short'
const VALID_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

function useMakeActions() {
  return useWalletActions({
    setWallet: mockSetWallet,
    setIsLocked: mockSetIsLocked,
    setSessionPassword: mockSetSessionPassword,
    setContacts: mockSetContacts as () => void,
    setFeeRateKBState: mockSetFeeRateKBState,
    refreshAccounts: mockRefreshAccounts,
    setActiveAccountState: mockSetActiveAccountState,
    resetSync: mockResetSync,
    setLocks: mockSetLocks as () => void,
    resetTokens: mockResetTokens,
    resetAccounts: mockResetAccounts,
    setAutoLockMinutesState: mockSetAutoLockMinutesState,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRefreshAccounts.mockResolvedValue(undefined)
  mockMigrateToMultiAccount.mockResolvedValue(undefined)
  mockSaveWallet.mockResolvedValue(undefined)
  mockSaveWalletUnprotected.mockResolvedValue(undefined)
  mockGetActiveAccount.mockResolvedValue({ id: 1 })
})

// =============================================================================
// handleRestoreWallet
// =============================================================================

describe('handleRestoreWallet', () => {
  it('restores wallet with password — uses saveWallet (encrypted path)', async () => {
    mockRestoreWallet.mockResolvedValueOnce({ ok: true, value: testKeys })

    const { handleRestoreWallet } = useMakeActions()
    const result = await handleRestoreWallet(VALID_MNEMONIC, VALID_PASSWORD)

    expect(result).toBe(true)
    expect(mockSaveWallet).toHaveBeenCalledWith(testKeys, VALID_PASSWORD)
    expect(mockSaveWalletUnprotected).not.toHaveBeenCalled()
  })

  it('restores wallet without password — uses saveWalletUnprotected', async () => {
    mockRestoreWallet.mockResolvedValueOnce({ ok: true, value: testKeys })

    const { handleRestoreWallet } = useMakeActions()
    const result = await handleRestoreWallet(VALID_MNEMONIC, null)

    expect(result).toBe(true)
    expect(mockSaveWalletUnprotected).toHaveBeenCalledWith(testKeys)
    expect(mockSaveWallet).not.toHaveBeenCalled()
  })

  it('rejects weak password before calling restoreWallet', async () => {
    const { handleRestoreWallet } = useMakeActions()

    await expect(handleRestoreWallet(VALID_MNEMONIC, WEAK_PASSWORD))
      .rejects.toThrow('at least 14 characters')

    expect(mockRestoreWallet).not.toHaveBeenCalled()
    expect(mockSaveWallet).not.toHaveBeenCalled()
  })

  it('stores keys in React state WITHOUT mnemonic', async () => {
    mockRestoreWallet.mockResolvedValueOnce({ ok: true, value: testKeys })

    const { handleRestoreWallet } = useMakeActions()
    await handleRestoreWallet(VALID_MNEMONIC, VALID_PASSWORD)

    // Mnemonic must not be stored in React state (it lives in Rust key store)
    expect(mockSetWallet).toHaveBeenCalledWith({ ...testKeys, mnemonic: '' })
  })

  it('sets session password after successful restore', async () => {
    mockRestoreWallet.mockResolvedValueOnce({ ok: true, value: testKeys })

    const { handleRestoreWallet } = useMakeActions()
    await handleRestoreWallet(VALID_MNEMONIC, VALID_PASSWORD)

    expect(mockSetSessionPassword).toHaveBeenCalledWith(VALID_PASSWORD)
  })

  it('sets empty session password for unprotected restore', async () => {
    mockRestoreWallet.mockResolvedValueOnce({ ok: true, value: testKeys })

    const { handleRestoreWallet } = useMakeActions()
    await handleRestoreWallet(VALID_MNEMONIC, null)

    expect(mockSetSessionPassword).toHaveBeenCalledWith('')
  })

  it('returns false (not throw) when restoreWallet fails', async () => {
    mockRestoreWallet.mockResolvedValueOnce({ ok: false, error: new Error('Invalid mnemonic') })

    const { handleRestoreWallet } = useMakeActions()
    const result = await handleRestoreWallet(VALID_MNEMONIC, VALID_PASSWORD)

    expect(result).toBe(false)
    expect(mockSetWallet).not.toHaveBeenCalled()
  })

  it('trims mnemonic before passing to restoreWallet', async () => {
    mockRestoreWallet.mockResolvedValueOnce({ ok: true, value: testKeys })

    const { handleRestoreWallet } = useMakeActions()
    await handleRestoreWallet(`  ${VALID_MNEMONIC}  `, VALID_PASSWORD)

    expect(mockRestoreWallet).toHaveBeenCalledWith(VALID_MNEMONIC)
  })

  it('calls migrateToMultiAccount with mnemonic and password', async () => {
    mockRestoreWallet.mockResolvedValueOnce({ ok: true, value: testKeys })

    const { handleRestoreWallet } = useMakeActions()
    await handleRestoreWallet(VALID_MNEMONIC, VALID_PASSWORD)

    expect(mockMigrateToMultiAccount).toHaveBeenCalledWith(
      { ...testKeys, mnemonic: VALID_MNEMONIC },
      VALID_PASSWORD
    )
  })
})

// =============================================================================
// handleImportJSON
// =============================================================================

describe('handleImportJSON', () => {
  const mockJSON = '{"mnemonic":"abandon..."}'

  it('imports with password — uses saveWallet (encrypted path)', async () => {
    mockImportFromJSON.mockResolvedValueOnce({ ok: true, value: testKeys })

    const { handleImportJSON } = useMakeActions()
    const result = await handleImportJSON(mockJSON, VALID_PASSWORD)

    expect(result).toBe(true)
    expect(mockSaveWallet).toHaveBeenCalledWith(testKeys, VALID_PASSWORD)
    expect(mockSaveWalletUnprotected).not.toHaveBeenCalled()
  })

  it('imports without password — uses saveWalletUnprotected', async () => {
    mockImportFromJSON.mockResolvedValueOnce({ ok: true, value: testKeys })

    const { handleImportJSON } = useMakeActions()
    const result = await handleImportJSON(mockJSON, null)

    expect(result).toBe(true)
    expect(mockSaveWalletUnprotected).toHaveBeenCalledWith(testKeys)
    expect(mockSaveWallet).not.toHaveBeenCalled()
  })

  it('rejects weak password before calling importFromJSON', async () => {
    const { handleImportJSON } = useMakeActions()

    await expect(handleImportJSON(mockJSON, WEAK_PASSWORD))
      .rejects.toThrow('at least 14 characters')

    expect(mockImportFromJSON).not.toHaveBeenCalled()
  })

  it('returns false when importFromJSON fails', async () => {
    mockImportFromJSON.mockResolvedValueOnce({ ok: false, error: new Error('Invalid JSON') })

    const { handleImportJSON } = useMakeActions()
    const result = await handleImportJSON('not-valid-json', VALID_PASSWORD)

    expect(result).toBe(false)
    expect(mockSetWallet).not.toHaveBeenCalled()
  })

  it('sets session password after successful import', async () => {
    mockImportFromJSON.mockResolvedValueOnce({ ok: true, value: testKeys })

    const { handleImportJSON } = useMakeActions()
    await handleImportJSON(mockJSON, VALID_PASSWORD)

    expect(mockSetSessionPassword).toHaveBeenCalledWith(VALID_PASSWORD)
  })
})

// =============================================================================
// handleCreateWallet
// =============================================================================

describe('handleCreateWallet', () => {
  it('creates wallet with password — uses saveWallet', async () => {
    mockCreateWallet.mockResolvedValueOnce({ ok: true, value: testKeys })

    const { handleCreateWallet } = useMakeActions()
    const mnemonic = await handleCreateWallet(VALID_PASSWORD)

    expect(mnemonic).toBe(testKeys.mnemonic)
    expect(mockSaveWallet).toHaveBeenCalledWith(testKeys, VALID_PASSWORD)
    expect(mockSaveWalletUnprotected).not.toHaveBeenCalled()
  })

  it('creates wallet without password — uses saveWalletUnprotected', async () => {
    mockCreateWallet.mockResolvedValueOnce({ ok: true, value: testKeys })

    const { handleCreateWallet } = useMakeActions()
    const mnemonic = await handleCreateWallet(null)

    expect(mnemonic).toBe(testKeys.mnemonic)
    expect(mockSaveWalletUnprotected).toHaveBeenCalledWith(testKeys)
    expect(mockSaveWallet).not.toHaveBeenCalled()
  })

  it('rejects weak password before calling createWallet', async () => {
    const { handleCreateWallet } = useMakeActions()

    await expect(handleCreateWallet(WEAK_PASSWORD))
      .rejects.toThrow('at least 14 characters')

    expect(mockCreateWallet).not.toHaveBeenCalled()
  })

  it('stores keys in React state WITHOUT mnemonic', async () => {
    mockCreateWallet.mockResolvedValueOnce({ ok: true, value: testKeys })

    const { handleCreateWallet } = useMakeActions()
    await handleCreateWallet(VALID_PASSWORD)

    expect(mockSetWallet).toHaveBeenCalledWith({ ...testKeys, mnemonic: '' })
  })

  it('returns null when createWallet fails', async () => {
    mockCreateWallet.mockResolvedValueOnce({ ok: false, error: new Error('Key derivation failed') })

    const { handleCreateWallet } = useMakeActions()
    const result = await handleCreateWallet(VALID_PASSWORD)

    expect(result).toBeNull()
    expect(mockSetWallet).not.toHaveBeenCalled()
  })
})
