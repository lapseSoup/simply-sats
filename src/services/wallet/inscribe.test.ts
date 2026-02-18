// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { buildInscriptionTx } from './inscribe'

vi.mock('./transactions', () => ({ broadcastTransaction: vi.fn().mockResolvedValue('a'.repeat(64)) }))
vi.mock('../sync', () => ({
  recordSentTransaction: vi.fn().mockResolvedValue(undefined),
  markUtxosPendingSpend: vi.fn().mockResolvedValue({ ok: true }),
  confirmUtxosSpent: vi.fn().mockResolvedValue({ ok: true }),
  rollbackPendingSpend: vi.fn().mockResolvedValue(undefined),
}))

describe('buildInscriptionTx', () => {
  it('throws if no funding UTXOs provided', async () => {
    await expect(buildInscriptionTx({
      paymentWif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73NUBBy7Y',
      paymentUtxos: [],
      content: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
      destinationAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf',
    })).rejects.toThrow('No funding UTXOs')
  })
})
