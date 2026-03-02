// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../utils/tauri', () => ({
  isTauri: vi.fn(() => true),
  tauriInvoke: vi.fn(),
}))

import { listOrdinal, cancelOrdinalListing, purchaseOrdinal } from './marketplace'
import { isTauri, tauriInvoke } from '../../utils/tauri'

const mockIsTauri = vi.mocked(isTauri)
const mockTauriInvoke = vi.mocked(tauriInvoke)

beforeEach(() => {
  vi.clearAllMocks()
  mockIsTauri.mockReturnValue(true)
})

const dummyUtxo = { txid: 'a'.repeat(64), vout: 0, satoshis: 1, script: '' }
const dummyPaymentUtxo = { txid: 'b'.repeat(64), vout: 0, satoshis: 100000, script: '' }

describe('listOrdinal', () => {
  it('invokes create_ordinal_listing and returns txid on success', async () => {
    mockTauriInvoke.mockResolvedValue({ rawTx: 'deadbeef', txid: 'abc123' })

    const result = await listOrdinal(
      'ordWif',
      dummyUtxo,
      'payWif',
      [dummyPaymentUtxo],
      'payAddr',
      'ordAddr',
      50000,
    )

    expect(result).toEqual({ ok: true, value: 'abc123' })
    expect(mockTauriInvoke).toHaveBeenCalledWith('create_ordinal_listing', {
      ordWif: 'ordWif',
      ordinalUtxo: { txid: 'a'.repeat(64), vout: 0, satoshis: 1, script: '' },
      paymentWif: 'payWif',
      paymentUtxos: [{ txid: 'b'.repeat(64), vout: 0, satoshis: 100000, script: '' }],
      payAddress: 'payAddr',
      ordAddress: 'ordAddr',
      priceSats: 50000,
    })
  })

  it('returns err when Tauri invoke fails', async () => {
    mockTauriInvoke.mockRejectedValue(new Error('signing failed'))

    const result = await listOrdinal(
      'ordWif',
      dummyUtxo,
      'payWif',
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
      'ordWif',
      dummyUtxo,
      'payWif',
      [],
      'payAddr',
      'ordAddr',
      50000,
    )

    expect(result).toEqual({ ok: false, error: 'Marketplace requires Tauri runtime' })
    expect(mockTauriInvoke).not.toHaveBeenCalled()
  })
})

describe('cancelOrdinalListing', () => {
  it('invokes cancel_ordinal_listing and returns txid', async () => {
    mockTauriInvoke.mockResolvedValue({ rawTx: 'cafebabe', txid: 'def456' })

    const txid = await cancelOrdinalListing(
      'ordWif',
      dummyUtxo,
      'payWif',
      [dummyPaymentUtxo],
    )

    expect(txid).toBe('def456')
    expect(mockTauriInvoke).toHaveBeenCalledWith('cancel_ordinal_listing', {
      ordWif: 'ordWif',
      listingUtxo: { txid: 'a'.repeat(64), vout: 0, satoshis: 1, script: '' },
      paymentWif: 'payWif',
      paymentUtxos: [{ txid: 'b'.repeat(64), vout: 0, satoshis: 100000, script: '' }],
    })
  })

  it('throws when not in Tauri runtime', async () => {
    mockIsTauri.mockReturnValue(false)

    await expect(
      cancelOrdinalListing('ordWif', dummyUtxo, 'payWif', []),
    ).rejects.toThrow('Marketplace requires Tauri runtime')
  })
})

describe('purchaseOrdinal', () => {
  it('invokes purchase_ordinal and returns txid', async () => {
    mockTauriInvoke.mockResolvedValue({ rawTx: 'baadf00d', txid: 'ghi789' })

    const txid = await purchaseOrdinal({
      paymentWif: 'payWif',
      paymentUtxos: [dummyPaymentUtxo],
      ordAddress: '1BuyerOrdAddress',
      listingUtxo: dummyUtxo,
      payout: 'dW5sb2Nrc2NyaXB0', // base64
      priceSats: 10000,
    })

    expect(txid).toBe('ghi789')
    expect(mockTauriInvoke).toHaveBeenCalledWith('purchase_ordinal', {
      paymentWif: 'payWif',
      paymentUtxos: [{ txid: 'b'.repeat(64), vout: 0, satoshis: 100000, script: '' }],
      ordAddress: '1BuyerOrdAddress',
      listingUtxo: { txid: 'a'.repeat(64), vout: 0, satoshis: 1, script: '' },
      payout: 'dW5sb2Nrc2NyaXB0',
      priceSats: 10000,
    })
  })

  it('throws when not in Tauri runtime', async () => {
    mockIsTauri.mockReturnValue(false)

    await expect(
      purchaseOrdinal({
        paymentWif: 'payWif',
        paymentUtxos: [],
        ordAddress: '1Addr',
        listingUtxo: dummyUtxo,
        payout: 'dW5sb2Nrc2NyaXB0',
        priceSats: 10000,
      }),
    ).rejects.toThrow('Marketplace requires Tauri runtime')
  })
})
