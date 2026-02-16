// @vitest-environment node
/**
 * Tests for Backup Recovery Service
 *
 * Tests: readBackupFolder path handling, decryptBackupAccount,
 * decryptAllAccounts, fetchLiveUtxos, fetchAllBalances,
 * calculateSweepEstimate, addRecoveredAccount.
 *
 * Heavy external dependencies (sql.js, Tauri FS, BSV SDK, WoC) are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------- Hoisted mock state ----------

const {
  mockDecrypt,
  mockIsEncryptedData,
  mockGetUtxos,
  mockCreateAccount,
  mockBroadcastTransaction,
} = vi.hoisted(() => ({
  mockDecrypt: vi.fn(),
  mockIsEncryptedData: vi.fn(() => true),
  mockGetUtxos: vi.fn(),
  mockCreateAccount: vi.fn(),
  mockBroadcastTransaction: vi.fn(),
}))

// ---------- Mocks ----------

vi.mock('sql.js', () => ({
  default: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
}))

vi.mock('./crypto', () => ({
  decrypt: mockDecrypt,
  isEncryptedData: mockIsEncryptedData,
}))

vi.mock('./accounts', () => ({
  createAccount: mockCreateAccount,
}))

vi.mock('../infrastructure/api/wocClient', () => ({
  getWocClient: () => ({
    getUtxos: mockGetUtxos,
  }),
}))

vi.mock('./wallet/transactions', () => ({
  broadcastTransaction: mockBroadcastTransaction,
}))

vi.mock('./logger', () => ({
  walletLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Mock @bsv/sdk classes used in executeSweep
vi.mock('@bsv/sdk', () => ({
  PrivateKey: { fromWif: vi.fn(() => ({ toPublicKey: () => ({ toString: () => 'pubkey' }) })) },
  P2PKH: vi.fn(() => ({
    lock: vi.fn(() => ({ toHex: () => 'lockhex' })),
    unlock: vi.fn(),
  })),
  Transaction: vi.fn(() => ({
    addInput: vi.fn(),
    addOutput: vi.fn(),
    sign: vi.fn(),
  })),
}))

import type { RecoveredAccount } from './backupRecovery'
import {
  readBackupFolder,
  decryptBackupAccount,
  decryptAllAccounts,
  fetchLiveUtxos,
  fetchAllBalances,
  calculateSweepEstimate,
  addRecoveredAccount,
} from './backupRecovery'
import type { WalletKeys, UTXO } from './wallet/types'

// ---------- Test fixtures ----------

const testKeys: WalletKeys = {
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  walletType: 'yours',
  walletWif: 'L1RrrnXkcKut5DEMwtDthjwRcTTwED36thyL1DebVrKuwvohjMNi',
  walletAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  walletPubKey: '02abc',
  ordWif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn',
  ordAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
  ordPubKey: '02def',
  identityWif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU74NMTptX4',
  identityAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3',
  identityPubKey: '02ghi',
}

const makeAccount = (overrides: Partial<RecoveredAccount> = {}): RecoveredAccount => ({
  id: 1,
  name: 'Main Account',
  identityAddress: '1TestAddr',
  encryptedKeys: JSON.stringify({ version: 1, ciphertext: 'enc', iv: 'iv', salt: 'salt', iterations: 600000 }),
  createdAt: 1700000000000,
  ...overrides,
})

const makeUtxo = (sats: number, txid = 'tx' + sats): UTXO => ({
  txid,
  vout: 0,
  satoshis: sats,
  script: '76a914abcdef88ac',
})

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------- readBackupFolder ----------

describe('readBackupFolder', () => {
  it('should reject paths containing ".."', async () => {
    await expect(readBackupFolder('/some/../../evil/path'))
      .rejects.toThrow('directory traversal not allowed')
  })

  it('should reject paths with embedded ".." in folder name', async () => {
    await expect(readBackupFolder('/Users/me/backups/../../../etc'))
      .rejects.toThrow('directory traversal not allowed')
  })
})

// ---------- decryptBackupAccount ----------

describe('decryptBackupAccount', () => {
  it('should decrypt and return wallet keys', async () => {
    mockDecrypt.mockResolvedValueOnce(JSON.stringify(testKeys))

    const account = makeAccount()
    const keys = await decryptBackupAccount(account, 'password123')

    expect(keys).toEqual(testKeys)
    expect(mockDecrypt).toHaveBeenCalledTimes(1)
  })

  it('should throw for invalid encrypted data format', async () => {
    mockIsEncryptedData.mockReturnValueOnce(false)

    const account = makeAccount({ encryptedKeys: JSON.stringify({ bad: 'data' }) })

    await expect(decryptBackupAccount(account, 'password'))
      .rejects.toThrow('Invalid encrypted data format')
  })

  it('should throw when decrypted keys lack required fields', async () => {
    mockDecrypt.mockResolvedValueOnce(JSON.stringify({ walletWif: 'L123' }))

    const account = makeAccount()

    await expect(decryptBackupAccount(account, 'password'))
      .rejects.toThrow('missing required fields')
  })

  it('should propagate decrypt errors (wrong password)', async () => {
    mockDecrypt.mockRejectedValueOnce(new Error('Decryption failed'))

    const account = makeAccount()

    await expect(decryptBackupAccount(account, 'wrong-password'))
      .rejects.toThrow('Decryption failed')
  })
})

// ---------- decryptAllAccounts ----------

describe('decryptAllAccounts', () => {
  it('should decrypt all accounts and return them with keys', async () => {
    mockDecrypt.mockResolvedValue(JSON.stringify(testKeys))

    const accounts = [makeAccount({ id: 1 }), makeAccount({ id: 2, name: 'Second' })]
    const result = await decryptAllAccounts(accounts, 'password')

    expect(result).toHaveLength(2)
    expect(result[0]!.decryptedKeys).toEqual(testKeys)
    expect(result[1]!.decryptedKeys).toEqual(testKeys)
  })

  it('should throw with account name when one fails', async () => {
    mockDecrypt
      .mockResolvedValueOnce(JSON.stringify(testKeys))
      .mockRejectedValueOnce(new Error('Decryption failed'))

    const accounts = [
      makeAccount({ id: 1, name: 'Good Account' }),
      makeAccount({ id: 2, name: 'Bad Account' }),
    ]

    await expect(decryptAllAccounts(accounts, 'password'))
      .rejects.toThrow('Failed to decrypt account "Bad Account"')
  })
})

// ---------- fetchLiveUtxos ----------

describe('fetchLiveUtxos', () => {
  it('should fetch UTXOs from all three addresses', async () => {
    mockGetUtxos
      .mockResolvedValueOnce([makeUtxo(1000)])   // wallet
      .mockResolvedValueOnce([makeUtxo(2000)])   // ordinals
      .mockResolvedValueOnce([makeUtxo(3000)])   // identity

    const utxos = await fetchLiveUtxos(testKeys)

    expect(utxos).toHaveLength(3)
    expect(mockGetUtxos).toHaveBeenCalledTimes(3)
    expect(mockGetUtxos).toHaveBeenCalledWith(testKeys.walletAddress)
    expect(mockGetUtxos).toHaveBeenCalledWith(testKeys.ordAddress)
    expect(mockGetUtxos).toHaveBeenCalledWith(testKeys.identityAddress)
  })

  it('should continue if one address fails', async () => {
    mockGetUtxos
      .mockResolvedValueOnce([makeUtxo(1000)])
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce([makeUtxo(3000)])

    const utxos = await fetchLiveUtxos(testKeys)
    expect(utxos).toHaveLength(2)
  })

  it('should return empty array when all addresses have no UTXOs', async () => {
    mockGetUtxos.mockResolvedValue([])
    const utxos = await fetchLiveUtxos(testKeys)
    expect(utxos).toEqual([])
  })
})

// ---------- fetchAllBalances ----------

describe('fetchAllBalances', () => {
  it('should populate liveUtxos and liveBalance for decrypted accounts', async () => {
    mockGetUtxos
      .mockResolvedValueOnce([makeUtxo(5000)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeUtxo(3000)])

    const accounts = [makeAccount({ decryptedKeys: testKeys })]
    const result = await fetchAllBalances(accounts)

    expect(result[0]!.liveUtxos).toHaveLength(2)
    expect(result[0]!.liveBalance).toBe(8000)
  })

  it('should skip accounts without decrypted keys', async () => {
    const accounts = [makeAccount()] // no decryptedKeys
    const result = await fetchAllBalances(accounts)

    expect(result[0]!.liveUtxos).toBeUndefined()
    expect(result[0]!.liveBalance).toBeUndefined()
    expect(mockGetUtxos).not.toHaveBeenCalled()
  })

  it('should set balance to 0 when fetch fails', async () => {
    mockGetUtxos.mockRejectedValue(new Error('Network error'))

    const accounts = [makeAccount({ decryptedKeys: testKeys })]
    const result = await fetchAllBalances(accounts)

    expect(result[0]!.liveUtxos).toEqual([])
    expect(result[0]!.liveBalance).toBe(0)
  })
})

// ---------- calculateSweepEstimate ----------

describe('calculateSweepEstimate', () => {
  it('should return dust estimate for empty UTXOs', () => {
    const estimate = calculateSweepEstimate([])

    expect(estimate.totalSats).toBe(0)
    expect(estimate.fee).toBe(0)
    expect(estimate.netSats).toBe(0)
    expect(estimate.numInputs).toBe(0)
    expect(estimate.isDust).toBe(true)
  })

  it('should return dust estimate when total is 0', () => {
    const estimate = calculateSweepEstimate([makeUtxo(0)])
    expect(estimate.isDust).toBe(true)
  })

  it('should calculate valid estimate for normal UTXOs', () => {
    const utxos = [makeUtxo(100000), makeUtxo(200000)]
    const estimate = calculateSweepEstimate(utxos)

    expect(estimate.totalSats).toBe(300000)
    expect(estimate.fee).toBeGreaterThan(0)
    expect(estimate.netSats).toBeLessThan(300000)
    expect(estimate.netSats).toBeGreaterThan(0)
    expect(estimate.numInputs).toBe(2)
    expect(estimate.isDust).toBe(false)
  })

  it('should accept custom fee rate', () => {
    const utxos = [makeUtxo(50000)]
    const lowFee = calculateSweepEstimate(utxos, 0.05)
    const highFee = calculateSweepEstimate(utxos, 1.0)

    expect(highFee.fee).toBeGreaterThan(lowFee.fee)
    expect(highFee.netSats).toBeLessThan(lowFee.netSats)
  })

  it('should detect dust when fee exceeds balance', () => {
    // Very small UTXO with high fee rate
    const utxos = [makeUtxo(1)] // 1 satoshi
    const estimate = calculateSweepEstimate(utxos, 10.0)

    expect(estimate.isDust).toBe(true)
  })
})

// ---------- addRecoveredAccount ----------

describe('addRecoveredAccount', () => {
  it('should create account with "(Imported)" suffix', async () => {
    mockCreateAccount.mockResolvedValueOnce(42)

    const id = await addRecoveredAccount(testKeys, 'My Wallet', 'currentPassword')

    expect(id).toBe(42)
    expect(mockCreateAccount).toHaveBeenCalledWith(
      'My Wallet (Imported)',
      testKeys,
      'currentPassword'
    )
  })

  it('should throw when createAccount returns null/falsy', async () => {
    mockCreateAccount.mockResolvedValueOnce(null)

    await expect(addRecoveredAccount(testKeys, 'Wallet', 'password'))
      .rejects.toThrow('Failed to create account')
  })
})
