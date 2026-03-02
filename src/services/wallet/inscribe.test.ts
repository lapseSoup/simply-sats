// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildInscriptionTx } from './inscribe'

// Mock the tauri utility module
vi.mock('../../utils/tauri', () => ({
  isTauri: vi.fn(),
  tauriInvoke: vi.fn()
}))

describe('buildInscriptionTx', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('throws when not in Tauri environment', async () => {
    const { isTauri } = await import('../../utils/tauri')
    vi.mocked(isTauri).mockReturnValue(false)

    await expect(buildInscriptionTx({
      paymentWif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73NUBBy7Y',
      paymentUtxos: [],
      content: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
      destinationAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    })).rejects.toThrow('requires Tauri runtime')
  })

  it('invokes build_inscription_tx Tauri command with correct params', async () => {
    const { isTauri, tauriInvoke } = await import('../../utils/tauri')
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(tauriInvoke).mockResolvedValue({
      rawTx: 'deadbeef',
      txid: 'abc123',
      fee: 10,
      change: 9989,
      changeAddress: '1TestAddress',
      spentOutpoints: [{ txid: 'aaa', vout: 0 }]
    })

    const content = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])
    const result = await buildInscriptionTx({
      paymentWif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73NUBBy7Y',
      paymentUtxos: [{ txid: 'aaa', vout: 0, satoshis: 10000, script: '76a91400' }],
      content,
      contentType: 'text/plain',
      destinationAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    })

    expect(result).toBe('abc123')
    expect(tauriInvoke).toHaveBeenCalledWith('build_inscription_tx', {
      wif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73NUBBy7Y',
      content: [0x48, 0x65, 0x6c, 0x6c, 0x6f],
      contentType: 'text/plain',
      destAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      fundingUtxos: [{ txid: 'aaa', vout: 0, satoshis: 10000, script: '76a91400' }],
      feeRate: 0.05
    })
  })

  it('passes empty string for missing UTXO script', async () => {
    const { isTauri, tauriInvoke } = await import('../../utils/tauri')
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(tauriInvoke).mockResolvedValue({
      rawTx: 'cafe',
      txid: 'def456',
      fee: 5,
      change: 4994,
      changeAddress: '1Addr',
      spentOutpoints: []
    })

    // UTXO without script field
    const utxo = { txid: 'bbb', vout: 1, satoshis: 5000 }

    await buildInscriptionTx({
      paymentWif: 'L1secret',
      paymentUtxos: [utxo as import('./types').UTXO],
      content: new Uint8Array([1]),
      contentType: 'application/octet-stream',
      destinationAddress: '1Dest',
    })

    const callArgs = vi.mocked(tauriInvoke).mock.calls[0]![1] as Record<string, unknown>
    const fundingUtxos = callArgs!.fundingUtxos as Array<{ script: string }>
    expect(fundingUtxos[0]!.script).toBe('')
  })
})
