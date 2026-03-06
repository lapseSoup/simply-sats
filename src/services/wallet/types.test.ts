import { describe, it, expect, vi } from 'vitest'
import { isUnprotectedData, sanitizeWalletForSession, toSessionWallet } from './types'

vi.mock('../../utils/tauri', () => ({
  isTauri: vi.fn()
}))

describe('isUnprotectedData', () => {
  it('returns true for valid unprotected data', () => {
    const data = { version: 0, mode: 'unprotected', keys: { mnemonic: 'test' } }
    expect(isUnprotectedData(data)).toBe(true)
  })

  it('returns false for EncryptedData', () => {
    const data = { version: 1, ciphertext: 'x', iv: 'y', salt: 'z', iterations: 600000 }
    expect(isUnprotectedData(data)).toBe(false)
  })

  it('returns false for null', () => {
    expect(isUnprotectedData(null)).toBe(false)
  })

  it('returns false for wrong version', () => {
    const data = { version: 1, mode: 'unprotected', keys: {} }
    expect(isUnprotectedData(data)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isUnprotectedData(undefined)).toBe(false)
  })

  it('returns false for missing mode', () => {
    const data = { version: 0, keys: {} }
    expect(isUnprotectedData(data)).toBe(false)
  })

  it('returns false for missing keys', () => {
    const data = { version: 0, mode: 'unprotected' }
    expect(isUnprotectedData(data)).toBe(false)
  })
})

describe('sanitizeWalletForSession', () => {
  it('strips mnemonic and WIFs in Tauri', async () => {
    const { isTauri } = await import('../../utils/tauri')
    vi.mocked(isTauri).mockReturnValue(true)

    expect(sanitizeWalletForSession({
      mnemonic: 'seed words',
      walletType: 'yours',
      walletWif: 'wallet-wif',
      walletAddress: '1wallet',
      walletPubKey: 'wallet-pub',
      ordWif: 'ord-wif',
      ordAddress: '1ord',
      ordPubKey: 'ord-pub',
      identityWif: 'identity-wif',
      identityAddress: '1identity',
      identityPubKey: 'identity-pub',
      accountIndex: 2
    })).toEqual({
      walletType: 'yours',
      walletAddress: '1wallet',
      walletPubKey: 'wallet-pub',
      ordAddress: '1ord',
      ordPubKey: 'ord-pub',
      identityAddress: '1identity',
      identityPubKey: 'identity-pub',
      accountIndex: 2
    })
  })

  it('preserves keys outside Tauri for browser fallback paths', async () => {
    const { isTauri } = await import('../../utils/tauri')
    vi.mocked(isTauri).mockReturnValue(false)

    const keys = {
      mnemonic: 'seed words',
      walletType: 'yours' as const,
      walletWif: 'wallet-wif',
      walletAddress: '1wallet',
      walletPubKey: 'wallet-pub',
      ordWif: 'ord-wif',
      ordAddress: '1ord',
      ordPubKey: 'ord-pub',
      identityWif: 'identity-wif',
      identityAddress: '1identity',
      identityPubKey: 'identity-pub'
    }

    expect(sanitizeWalletForSession(keys)).toBe(keys)
  })
})

describe('toSessionWallet', () => {
  it('maps public keys into the public session wallet shape', () => {
    expect(toSessionWallet({
      walletType: 'yours',
      walletAddress: '1wallet',
      walletPubKey: 'wallet-pub',
      ordAddress: '1ord',
      ordPubKey: 'ord-pub',
      identityAddress: '1identity',
      identityPubKey: 'identity-pub'
    }, 4)).toEqual({
      walletType: 'yours',
      walletAddress: '1wallet',
      walletPubKey: 'wallet-pub',
      ordAddress: '1ord',
      ordPubKey: 'ord-pub',
      identityAddress: '1identity',
      identityPubKey: 'identity-pub',
      accountIndex: 4
    })
  })
})
