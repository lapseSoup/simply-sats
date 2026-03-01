// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { listOrdinal, cancelOrdinalListing, purchaseOrdinal } from './marketplace'

describe('listOrdinal', () => {
  it('throws "not yet available" error', async () => {
    await expect(
      listOrdinal(
        'L1RMEbBkMJ3JKzn3e3cE9Fm4XLKP5Pmjbsci7dqASiJVTCTxhsWi',
        { txid: 'a'.repeat(64), vout: 0, satoshis: 1, script: '' },
        'KxDQjJwvLdNNGhsmmjvnsjp4bfFmrp4zzfNCPkxSnVmfbbzqDnkx',
        [],
        '1PayAddress',
        '1OrdAddress',
        50000
      )
    ).rejects.toThrow('not yet available')
  })
})

describe('cancelOrdinalListing', () => {
  it('throws "not yet available" error', async () => {
    await expect(
      cancelOrdinalListing(
        'L1RMEbBkMJ3JKzn3e3cE9Fm4XLKP5Pmjbsci7dqASiJVTCTxhsWi',
        { txid: 'a'.repeat(64), vout: 0, satoshis: 1, script: '' },
        'KxDQjJwvLdNNGhsmmjvnsjp4bfFmrp4zzfNCPkxSnVmfbbzqDnkx',
        []
      )
    ).rejects.toThrow('not yet available')
  })
})

describe('purchaseOrdinal', () => {
  it('throws "not yet available" error', async () => {
    await expect(
      purchaseOrdinal({
        paymentWif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73NUBBy7Y',
        paymentUtxos: [],
        ordAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf',
        listingUtxo: { txid: 'a'.repeat(64), vout: 0, satoshis: 1, script: '' },
        payout: 'dW5sb2Nrc2NyaXB0',
        priceSats: 10000,
      })
    ).rejects.toThrow('not yet available')
  })
})
