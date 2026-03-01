// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildInscriptionTx } from './inscribe'

describe('buildInscriptionTx', () => {
  it('throws "not yet available" error', async () => {
    await expect(buildInscriptionTx({
      paymentWif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73NUBBy7Y',
      paymentUtxos: [],
      content: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
      destinationAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf',
    })).rejects.toThrow('not yet available')
  })
})
