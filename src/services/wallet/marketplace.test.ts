// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../utils/tauri', () => ({
  isTauri: vi.fn(() => true),
  tauriInvoke: vi.fn(),
}))

vi.mock('../../domain/wallet/validation', () => ({
  isValidBSVAddress: vi.fn(() => true),
}))

import { listOrdinal, cancelOrdinalListing, purchaseOrdinal } from './marketplace'
import { isTauri, tauriInvoke } from '../../utils/tauri'
import { isValidBSVAddress } from '../../domain/wallet/validation'

const mockIsTauri = vi.mocked(isTauri)
const mockTauriInvoke = vi.mocked(tauriInvoke)
const mockIsValidBSVAddress = vi.mocked(isValidBSVAddress)

beforeEach(() => {
  vi.clearAllMocks()
  mockIsTauri.mockReturnValue(true)
  mockIsValidBSVAddress.mockReturnValue(true)
})

const dummyUtxo = { txid: 'a'.repeat(64), vout: 0, satoshis: 1, script: '' }
const dummyPaymentUtxo = { txid: 'b'.repeat(64), vout: 0, satoshis: 100000, script: '' }

describe('listOrdinal', () => {
  it('invokes create_ordinal_listing_from_store and returns txid on success', async () => {
    mockTauriInvoke.mockResolvedValue({ rawTx: 'deadbeef', txid: 'abc123' })

    const result = await listOrdinal(
      dummyUtxo,
      [dummyPaymentUtxo],
      'payAddr',
      'ordAddr',
      50000,
    )

    expect(result).toEqual({ ok: true, value: 'abc123' })
    expect(mockTauriInvoke).toHaveBeenCalledWith('create_ordinal_listing_from_store', {
      ordinalUtxo: { txid: 'a'.repeat(64), vout: 0, satoshis: 1, script: '' },
      paymentUtxos: [{ txid: 'b'.repeat(64), vout: 0, satoshis: 100000, script: '' }],
      payAddress: 'payAddr',
      ordAddress: 'ordAddr',
      priceSats: 50000,
    })
  })

  it('returns err when Tauri invoke fails', async () => {
    mockTauriInvoke.mockRejectedValue(new Error('signing failed'))

    const result = await listOrdinal(
      dummyUtxo,
      [],
      'payAddr',
      'ordAddr',
      50000,
    )

    expect(result).toEqual({ ok: false, error: 'signing failed' })
  })

  it('returns err when not in Tauri runtime', async () => {
    mockIsTauri.mockReturnValue(false)

    const result = await listOrdinal(
      dummyUtxo,
      [],
      'payAddr',
      'ordAddr',
      50000,
    )

    expect(result).toEqual({ ok: false, error: 'Marketplace requires Tauri runtime' })
    expect(mockTauriInvoke).not.toHaveBeenCalled()
  })

  it('returns err for invalid pay address (S-64)', async () => {
    mockIsValidBSVAddress.mockReturnValue(false)

    const result = await listOrdinal(
      dummyUtxo,
      [dummyPaymentUtxo],
      'invalidAddr',
      'ordAddr',
      50000,
    )

    expect(result).toEqual({ ok: false, error: 'Invalid payment address' })
    expect(mockTauriInvoke).not.toHaveBeenCalled()
  })

  it('returns err for invalid price (S-70)', async () => {
    const result = await listOrdinal(
      dummyUtxo,
      [dummyPaymentUtxo],
      'payAddr',
      'ordAddr',
      -100,
    )

    expect(result.ok).toBe(false)
    expect(mockTauriInvoke).not.toHaveBeenCalled()
  })
})

describe('cancelOrdinalListing', () => {
  it('invokes cancel_ordinal_listing_from_store and returns Result with txid', async () => {
    mockTauriInvoke.mockResolvedValue({ rawTx: 'cafebabe', txid: 'def456' })

    const result = await cancelOrdinalListing(dummyUtxo, [dummyPaymentUtxo])

    expect(result).toEqual({ ok: true, value: 'def456' })
    expect(mockTauriInvoke).toHaveBeenCalledWith('cancel_ordinal_listing_from_store', {
      listingUtxo: { txid: 'a'.repeat(64), vout: 0, satoshis: 1, script: '' },
      paymentUtxos: [{ txid: 'b'.repeat(64), vout: 0, satoshis: 100000, script: '' }],
    })
  })

  it('returns err when not in Tauri runtime (B-55)', async () => {
    mockIsTauri.mockReturnValue(false)

    const result = await cancelOrdinalListing(dummyUtxo, [])

    expect(result).toEqual({ ok: false, error: 'Marketplace requires Tauri runtime' })
  })

  it('returns err when Tauri invoke fails', async () => {
    mockTauriInvoke.mockRejectedValue(new Error('unlock failed'))

    const result = await cancelOrdinalListing(dummyUtxo, [dummyPaymentUtxo])

    expect(result).toEqual({ ok: false, error: 'unlock failed' })
  })
})

describe('purchaseOrdinal', () => {
  it('invokes purchase_ordinal_from_store and returns Result with txid', async () => {
    mockTauriInvoke.mockResolvedValue({ rawTx: 'baadf00d', txid: 'ghi789' })

    const result = await purchaseOrdinal({
      paymentUtxos: [dummyPaymentUtxo],
      ordAddress: '1BuyerOrdAddress',
      listingUtxo: dummyUtxo,
      payout: 'dW5sb2Nrc2NyaXB0', // base64
      priceSats: 10000,
    })

    expect(result).toEqual({ ok: true, value: 'ghi789' })
    expect(mockTauriInvoke).toHaveBeenCalledWith('purchase_ordinal_from_store', {
      paymentUtxos: [{ txid: 'b'.repeat(64), vout: 0, satoshis: 100000, script: '' }],
      ordAddress: '1BuyerOrdAddress',
      listingUtxo: { txid: 'a'.repeat(64), vout: 0, satoshis: 1, script: '' },
      payout: 'dW5sb2Nrc2NyaXB0',
      priceSats: 10000,
    })
  })

  it('returns err when not in Tauri runtime (B-55)', async () => {
    mockIsTauri.mockReturnValue(false)

    const result = await purchaseOrdinal({
      paymentUtxos: [],
      ordAddress: '1Addr',
      listingUtxo: dummyUtxo,
      payout: 'dW5sb2Nrc2NyaXB0',
      priceSats: 10000,
    })

    expect(result).toEqual({ ok: false, error: 'Marketplace requires Tauri runtime' })
  })

  it('returns err for invalid ordAddress (S-64)', async () => {
    mockIsValidBSVAddress.mockReturnValue(false)

    const result = await purchaseOrdinal({
      paymentUtxos: [dummyPaymentUtxo],
      ordAddress: 'badAddr',
      listingUtxo: dummyUtxo,
      payout: 'dW5sb2Nrc2NyaXB0',
      priceSats: 10000,
    })

    expect(result).toEqual({ ok: false, error: 'Invalid ordinal destination address' })
  })

  it('returns err for invalid price (S-70)', async () => {
    const result = await purchaseOrdinal({
      paymentUtxos: [dummyPaymentUtxo],
      ordAddress: '1Addr',
      listingUtxo: dummyUtxo,
      payout: 'dW5sb2Nrc2NyaXB0',
      priceSats: 0,
    })

    expect(result.ok).toBe(false)
  })

  it('returns err when Tauri invoke fails', async () => {
    mockTauriInvoke.mockRejectedValue(new Error('purchase failed'))

    const result = await purchaseOrdinal({
      paymentUtxos: [dummyPaymentUtxo],
      ordAddress: '1Addr',
      listingUtxo: dummyUtxo,
      payout: 'dW5sb2Nrc2NyaXB0',
      priceSats: 10000,
    })

    expect(result).toEqual({ ok: false, error: 'purchase failed' })
  })
})
