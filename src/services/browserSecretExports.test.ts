import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBrowserEncryptedDatabaseBackup, buildBrowserEncryptedKeyExport } from './browserSecretExports'
import { encrypt } from './crypto'
import type { ActiveWallet } from '../domain/types'
import type { DatabaseBackup } from '../infrastructure/database'

vi.mock('./crypto', () => ({
  encrypt: vi.fn(async (data: string, _password: string) => ({
    ciphertext: Buffer.from(data).toString('base64'),
    iv: 'mock-iv',
    salt: 'mock-salt',
    iterations: 100000,
    version: 1
  }))
}))

const mockedEncrypt = vi.mocked(encrypt)

function makeWallet(overrides: Partial<ActiveWallet> = {}): ActiveWallet {
  return {
    walletType: 'yours',
    mnemonic: 'test mnemonic words 1',
    walletWif: 'wallet-wif',
    walletAddress: 'wallet-address',
    walletPubKey: 'wallet-pubkey',
    ordWif: 'ord-wif',
    ordAddress: 'ord-address',
    ordPubKey: 'ord-pubkey',
    identityWif: 'identity-wif',
    identityAddress: 'identity-address',
    identityPubKey: 'identity-pubkey',
    ...overrides
  }
}

const emptyBackup: DatabaseBackup = {
  version: 4,
  exportedAt: 123,
  utxos: [],
  transactions: [],
  locks: [],
  baskets: [],
  syncState: [],
  derivedAddresses: [],
  contacts: []
}

describe('browserSecretExports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds an encrypted browser key export from private wallet material', async () => {
    const wallet = makeWallet()

    const result = await buildBrowserEncryptedKeyExport(wallet, 'password12345')

    expect(result.format).toBe('simply-sats-keys-encrypted')
    expect(result.version).toBe(1)
    expect(mockedEncrypt).toHaveBeenCalledTimes(1)

    const [payload] = mockedEncrypt.mock.calls[0]!
    const parsed = JSON.parse(payload as string) as Record<string, unknown>
    expect(parsed.format).toBe('simply-sats')
    expect(parsed.mnemonic).toBe(wallet.mnemonic)
  })

  it('builds an encrypted browser database backup from private wallet material', async () => {
    const wallet = makeWallet()

    await buildBrowserEncryptedDatabaseBackup(wallet, 'password12345', emptyBackup)

    expect(mockedEncrypt).toHaveBeenCalledTimes(1)

    const [payload] = mockedEncrypt.mock.calls[0]!
    const parsed = JSON.parse(payload as string) as Record<string, unknown>
    expect(parsed.format).toBe('simply-sats-full')
    expect(parsed.database).toEqual(emptyBackup)
  })

  it('rejects browser export when private material is unavailable', async () => {
    const wallet = makeWallet({
      mnemonic: undefined,
      walletWif: undefined,
      ordWif: undefined,
      identityWif: undefined
    })

    await expect(buildBrowserEncryptedKeyExport(wallet, 'password12345'))
      .rejects.toThrow('Private keys are unavailable in this session')

    expect(mockedEncrypt).not.toHaveBeenCalled()
  })
})
