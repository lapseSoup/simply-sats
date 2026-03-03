// @vitest-environment node

/**
 * Tests for Token Transfers (transfers.ts)
 *
 * Covers: transferToken validation & orchestration, sendToken UTXO selection & delegation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const {
  mockIsValidBSVAddress,
  mockTauriInvoke,
  mockBroadcastTransaction,
  mockCalculateTxFee,
  mockRecordSentTransaction,
  mockMarkUtxosSpent,
  mockGetTokenUtxosForSend,
  mockP2pkhLockingScriptHex,
  mockIsTauri,
} = vi.hoisted(() => ({
  mockIsValidBSVAddress: vi.fn(),
  mockTauriInvoke: vi.fn(),
  mockBroadcastTransaction: vi.fn(),
  mockCalculateTxFee: vi.fn().mockReturnValue(200),
  mockRecordSentTransaction: vi.fn(),
  mockMarkUtxosSpent: vi.fn(),
  mockGetTokenUtxosForSend: vi.fn(),
  mockP2pkhLockingScriptHex: vi.fn((addr: string) => `script_${addr}`),
  mockIsTauri: vi.fn().mockReturnValue(true),
}))

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../domain/wallet/validation', () => ({
  isValidBSVAddress: (...args: unknown[]) => mockIsValidBSVAddress(...args),
}))

vi.mock('../../utils/tauri', () => ({
  isTauri: () => mockIsTauri(),
  tauriInvoke: (...args: unknown[]) => mockTauriInvoke(...args),
}))

vi.mock('../wallet', () => ({
  broadcastTransaction: (...args: unknown[]) => mockBroadcastTransaction(...args),
  calculateTxFee: (...args: unknown[]) => mockCalculateTxFee(...args),
}))

vi.mock('../sync', () => ({
  recordSentTransaction: (...args: unknown[]) => mockRecordSentTransaction(...args),
  markUtxosSpent: (...args: unknown[]) => mockMarkUtxosSpent(...args),
}))

vi.mock('./fetching', () => ({
  getTokenUtxosForSend: (...args: unknown[]) => mockGetTokenUtxosForSend(...args),
}))

vi.mock('../../domain/transaction/builder', () => ({
  p2pkhLockingScriptHex: (addr: string) => mockP2pkhLockingScriptHex(addr),
}))

vi.mock('../logger', () => ({
  tokenLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Import under test (must come after vi.mock calls)
// ---------------------------------------------------------------------------

import { transferToken, sendToken } from './transfers'
import type { TokenUTXO } from './fetching'
import type { UTXO } from '../wallet'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTokenUTXO(overrides: Partial<TokenUTXO> = {}): TokenUTXO {
  return {
    txid: 'aaa111',
    vout: 0,
    satoshis: 1,
    script: 'tokenscript',
    height: 800000,
    idx: 0,
    tick: 'TEST',
    amt: '1000',
    status: 1,
    ...overrides,
  }
}

function makeFundingUTXO(overrides: Partial<UTXO> = {}): UTXO {
  return {
    txid: 'bbb222',
    vout: 0,
    satoshis: 10000,
    script: 'fundingscript',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests: transferToken
// ---------------------------------------------------------------------------

describe('transferToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsValidBSVAddress.mockReturnValue(true)
    mockIsTauri.mockReturnValue(true)
    mockCalculateTxFee.mockReturnValue(200)
    mockTauriInvoke.mockResolvedValue({ address: '1SomeAddr' })
    mockBroadcastTransaction.mockResolvedValue('txid_result_123')
    mockRecordSentTransaction.mockResolvedValue(undefined)
    mockMarkUtxosSpent.mockResolvedValue(undefined)
  })

  it('rejects an invalid recipient address', async () => {
    mockIsValidBSVAddress.mockReturnValue(false)

    const result = await transferToken(
      'tokenWif',
      [makeTokenUTXO()],
      'TEST',
      'bsv20',
      '100',
      'INVALID_ADDR',
      'fundingWif',
      [makeFundingUTXO()],
      '1ChangeAddr'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Invalid recipient address')
    }
    // Should not proceed to Tauri invoke
    expect(mockTauriInvoke).not.toHaveBeenCalled()
  })

  it('rejects zero amount', async () => {
    const result = await transferToken(
      'tokenWif',
      [makeTokenUTXO()],
      'TEST',
      'bsv20',
      '0',
      '1ValidAddr',
      'fundingWif',
      [makeFundingUTXO()],
      '1ChangeAddr'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Invalid amount')
    }
  })

  it('rejects non-numeric amount string', async () => {
    const result = await transferToken(
      'tokenWif',
      [makeTokenUTXO()],
      'TEST',
      'bsv20',
      'abc',
      '1ValidAddr',
      'fundingWif',
      [makeFundingUTXO()],
      '1ChangeAddr'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Invalid amount')
    }
  })

  it('rejects negative amount', async () => {
    const result = await transferToken(
      'tokenWif',
      [makeTokenUTXO()],
      'TEST',
      'bsv20',
      '-5',
      '1ValidAddr',
      'fundingWif',
      [makeFundingUTXO()],
      '1ChangeAddr'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Invalid amount')
    }
  })

  it('returns error when Tauri runtime is not available', async () => {
    mockIsTauri.mockReturnValue(false)

    const result = await transferToken(
      'tokenWif',
      [makeTokenUTXO()],
      'TEST',
      'bsv20',
      '100',
      '1ValidAddr',
      'fundingWif',
      [makeFundingUTXO()],
      '1ChangeAddr'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Tauri runtime')
    }
  })

  it('returns error when token balance is insufficient', async () => {
    const tokenUtxo = makeTokenUTXO({ amt: '50' })

    mockTauriInvoke.mockResolvedValue({ address: '1SomeAddr' })

    const result = await transferToken(
      'tokenWif',
      [tokenUtxo],
      'TEST',
      'bsv20',
      '100',
      '1ValidAddr',
      'fundingWif',
      [makeFundingUTXO()],
      '1ChangeAddr'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Insufficient token balance')
    }
  })

  it('completes a successful token transfer', async () => {
    const tokenUtxo = makeTokenUTXO({ amt: '500' })
    const fundingUtxo = makeFundingUTXO({ satoshis: 10000 })

    // First call: keys_from_wif for token, second: keys_from_wif for funding,
    // third: build_token_transfer_tx
    mockTauriInvoke
      .mockResolvedValueOnce({ address: '1TokenAddr' })   // token key info
      .mockResolvedValueOnce({ address: '1FundingAddr' })  // funding key info
      .mockResolvedValueOnce({ rawTx: 'rawhex', txid: 'built_txid', fee: 200, change: 9800 }) // build tx

    mockBroadcastTransaction.mockResolvedValue('final_txid_abc')

    const result = await transferToken(
      'tokenWif',
      [tokenUtxo],
      'TEST',
      'bsv20',
      '500',
      '1RecipientAddr',
      'fundingWif',
      [fundingUtxo],
      '1ChangeAddr'
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.txid).toBe('final_txid_abc')
    }

    // Verify broadcast was called with the raw tx
    expect(mockBroadcastTransaction).toHaveBeenCalledWith('rawhex')

    // Verify UTXOs were marked as spent
    expect(mockMarkUtxosSpent).toHaveBeenCalledTimes(2) // funding + token

    // Verify transaction was recorded
    expect(mockRecordSentTransaction).toHaveBeenCalledWith(
      'final_txid_abc',
      'rawhex',
      'Token transfer: 500 TEST',
      ['token-transfer'],
      9800
    )
  })

  it('returns error when funding UTXOs are insufficient for fee', async () => {
    const tokenUtxo = makeTokenUTXO({ amt: '100' })
    const tinyFunding = makeFundingUTXO({ satoshis: 1 }) // too small for any fee

    mockTauriInvoke.mockResolvedValue({ address: '1SomeAddr' })
    mockCalculateTxFee.mockReturnValue(500)

    const result = await transferToken(
      'tokenWif',
      [tokenUtxo],
      'TEST',
      'bsv20',
      '100',
      '1ValidAddr',
      'fundingWif',
      [tinyFunding],
      '1ChangeAddr'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Insufficient BSV for fee')
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: sendToken
// ---------------------------------------------------------------------------

describe('sendToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsValidBSVAddress.mockReturnValue(true)
    mockIsTauri.mockReturnValue(true)
    mockCalculateTxFee.mockReturnValue(200)
    mockTauriInvoke.mockResolvedValue({ address: '1SomeAddr' })
    mockBroadcastTransaction.mockResolvedValue('txid_send_123')
    mockRecordSentTransaction.mockResolvedValue(undefined)
    mockMarkUtxosSpent.mockResolvedValue(undefined)
  })

  it('returns error when no token UTXOs are found', async () => {
    mockGetTokenUtxosForSend.mockResolvedValue([])

    const result = await sendToken(
      '1WalletAddr',
      '1OrdAddr',
      'walletWif',
      'ordWif',
      [makeFundingUTXO()],
      'TEST',
      'bsv20',
      '100',
      '1RecipientAddr'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('No token UTXOs found')
    }
  })

  it('delegates to transferToken with wallet UTXOs when wallet has more tokens', async () => {
    const walletUtxo = makeTokenUTXO({ amt: '1000', txid: 'wallet_utxo' })
    const ordUtxo = makeTokenUTXO({ amt: '200', txid: 'ord_utxo' })
    const fundingUtxo = makeFundingUTXO({ satoshis: 50000 })

    mockGetTokenUtxosForSend
      .mockResolvedValueOnce([walletUtxo]) // walletAddress
      .mockResolvedValueOnce([ordUtxo])    // ordAddress

    // Mocks for the transferToken call that sendToken delegates to:
    // keys_from_wif (token), keys_from_wif (funding), build_token_transfer_tx
    mockTauriInvoke
      .mockResolvedValueOnce({ address: '1WalletAddr' })
      .mockResolvedValueOnce({ address: '1FundAddr' })
      .mockResolvedValueOnce({ rawTx: 'rawhex', txid: 'tx1', fee: 200, change: 49800 })

    mockBroadcastTransaction.mockResolvedValue('send_txid')

    const result = await sendToken(
      '1WalletAddr',
      '1OrdAddr',
      'walletWif',
      'ordWif',
      [fundingUtxo],
      'TEST',
      'bsv20',
      '500',
      '1RecipientAddr'
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.txid).toBe('send_txid')
    }

    // Verify getTokenUtxosForSend was called for both addresses
    expect(mockGetTokenUtxosForSend).toHaveBeenCalledTimes(2)
    expect(mockGetTokenUtxosForSend).toHaveBeenCalledWith('1WalletAddr', 'TEST', 'bsv20')
    expect(mockGetTokenUtxosForSend).toHaveBeenCalledWith('1OrdAddr', 'TEST', 'bsv20')
  })

  it('returns insufficient balance error when neither address has enough tokens', async () => {
    const walletUtxo = makeTokenUTXO({ amt: '30', txid: 'w1' })
    const ordUtxo = makeTokenUTXO({ amt: '20', txid: 'o1' })

    mockGetTokenUtxosForSend
      .mockResolvedValueOnce([walletUtxo])
      .mockResolvedValueOnce([ordUtxo])

    // transferToken will be called internally and will fail on insufficient balance.
    // But sendToken checks itself first when selectedTotal < amountNeeded
    // walletTotal=30 > ordTotal=20, so wallet is selected, selectedTotal=30 < 100
    // combinedTotal=50 < 100 => insufficient balance

    const result = await sendToken(
      '1WalletAddr',
      '1OrdAddr',
      'walletWif',
      'ordWif',
      [makeFundingUTXO()],
      'TEST',
      'bsv20',
      '100',
      '1RecipientAddr'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Insufficient token balance')
    }
  })
})
