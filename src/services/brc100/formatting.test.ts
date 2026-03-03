// @vitest-environment node
/**
 * Tests for BRC-100 formatting — buildAndBroadcastAction
 *
 * S-106: Verifies that custom locking scripts are forwarded to
 * build_custom_output_tx_from_store, and P2PKH-only outputs use
 * the optimized build_multi_output_p2pkh_tx_from_store path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock tauri invoke — capture the command and args
const mockInvoke = vi.fn()
vi.mock('../../utils/tauri', () => ({
  isTauri: () => true,
  tauriInvoke: (...args: unknown[]) => mockInvoke(...args),
}))

// Mock wallet services
vi.mock('../wallet', () => ({
  getUTXOs: vi.fn(async () => [
    { txid: 'a'.repeat(64), vout: 0, satoshis: 50000, script: '76a914' + '00'.repeat(20) + '88ac' },
  ]),
  calculateTxFee: vi.fn(() => 100),
}))

// Mock database
vi.mock('../database', () => ({
  addUTXO: vi.fn(async () => ({ ok: true, value: undefined })),
  markUTXOSpent: vi.fn(async () => ({ ok: true, value: undefined })),
  addTransaction: vi.fn(async () => ({ ok: true, value: undefined })),
}))

// Mock coin selection
vi.mock('../../domain/transaction/coinSelection', () => ({
  selectCoins: vi.fn(() => ({
    sufficient: true,
    selected: [{ txid: 'a'.repeat(64), vout: 0, satoshis: 50000, script: '76a914' + '00'.repeat(20) + '88ac' }],
    total: 50000,
  })),
}))

// Mock overlay broadcast
vi.mock('../overlay', () => ({
  broadcastWithOverlay: vi.fn(async () => ({
    txid: 'tx' + '0'.repeat(62),
    overlayResults: [{ accepted: true }],
    minerBroadcast: { ok: true },
  })),
  TOPICS: { DEFAULT: 'tm_default', WROOTZ_LOCKS: 'tm_locks', ORDINALS: 'tm_ordinals' },
}))

// Mock inscription utilities
vi.mock('../inscription', () => ({
  parseInscription: vi.fn(() => ({ isValid: false })),
  isInscriptionScript: vi.fn(() => false),
}))

// Mock BRC-100 utils
vi.mock('./utils', () => ({
  isInscriptionTransaction: vi.fn(() => false),
}))

// Mock sync/cancellation
vi.mock('../cancellation', () => ({
  acquireSyncLock: vi.fn(async () => vi.fn()), // returns release function
}))

// Mock accounts
vi.mock('../accounts', () => ({
  getActiveAccount: vi.fn(async () => ({ id: 1 })),
}))

// Mock p2pkhLockingScriptHex
const WALLET_SCRIPT = '76a914' + '00'.repeat(20) + '88ac'
vi.mock('../../domain/transaction/builder', () => ({
  p2pkhLockingScriptHex: vi.fn(() => WALLET_SCRIPT),
}))

// Mock sync baskets
vi.mock('../sync', () => ({
  BASKETS: { DEFAULT: 'default', ORDINALS: 'ordinals' },
}))

// Mock logger
vi.mock('../logger', () => ({
  brc100Logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Now import the function under test
import { buildAndBroadcastAction } from './formatting'
import type { WalletKeys } from '../wallet/types'
import type { CreateActionRequest } from './types'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockKeys: WalletKeys = {
  walletAddress: '1TestAddr',
  walletPubKey: '02' + 'aa'.repeat(32),
  walletWif: 'L1test' + 'a'.repeat(46),
  walletType: 'yours',
  ordAddress: '1OrdAddr',
  ordPubKey: '02' + 'bb'.repeat(32),
  ordWif: 'L1test' + 'b'.repeat(46),
  identityKey: '02' + 'cc'.repeat(32),
  identityPubKey: '02' + 'cc'.repeat(32),
  identityAddress: '1IdAddr',
  identityWif: 'L1test' + 'c'.repeat(46),
  mnemonic: 'test mnemonic phrase for unit testing purposes only not real words at all',
  accountIndex: 0,
}

function makeActionRequest(overrides: Partial<CreateActionRequest> = {}): CreateActionRequest {
  return {
    description: 'test action',
    outputs: [
      { lockingScript: 'aabb0011deadbeef', satoshis: 1000 },
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildAndBroadcastAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: invoke returns a built tx
    mockInvoke.mockResolvedValue({
      rawTx: '01000000' + '00'.repeat(50),
      txid: 'tx' + '0'.repeat(62),
      fee: 50,
      change: 1000,
      changeAddress: '1TestAddr',
      spentOutpoints: [],
    })
  })

  it('uses build_custom_output_tx_from_store for non-P2PKH scripts', async () => {
    const customScript = 'aabb0011deadbeef' // not a P2PKH script
    const request = makeActionRequest({
      outputs: [{ lockingScript: customScript, satoshis: 2000 }],
    })

    const result = await buildAndBroadcastAction(mockKeys, request)
    expect(result.ok).toBe(true)

    // Should have called the custom output builder
    expect(mockInvoke).toHaveBeenCalledWith(
      'build_custom_output_tx_from_store',
      expect.objectContaining({
        outputs: [{ satoshis: 2000, lockingScriptHex: customScript }],
      }),
    )
  })

  it('uses build_multi_output_p2pkh_tx_from_store when all outputs are wallet P2PKH', async () => {
    const request = makeActionRequest({
      outputs: [
        { lockingScript: WALLET_SCRIPT, satoshis: 1000 },
        { lockingScript: WALLET_SCRIPT, satoshis: 2000 },
      ],
    })

    const result = await buildAndBroadcastAction(mockKeys, request)
    expect(result.ok).toBe(true)

    // Should have called the P2PKH multi-output builder
    expect(mockInvoke).toHaveBeenCalledWith(
      'build_multi_output_p2pkh_tx_from_store',
      expect.objectContaining({
        outputs: [
          { address: '1TestAddr', satoshis: 1000 },
          { address: '1TestAddr', satoshis: 2000 },
        ],
      }),
    )
  })

  it('uses custom path when at least one output has a non-P2PKH script', async () => {
    const request = makeActionRequest({
      outputs: [
        { lockingScript: WALLET_SCRIPT, satoshis: 1000 },
        { lockingScript: 'deadbeef', satoshis: 500 },
      ],
    })

    const result = await buildAndBroadcastAction(mockKeys, request)
    expect(result.ok).toBe(true)

    expect(mockInvoke).toHaveBeenCalledWith(
      'build_custom_output_tx_from_store',
      expect.objectContaining({
        outputs: [
          { satoshis: 1000, lockingScriptHex: WALLET_SCRIPT },
          { satoshis: 500, lockingScriptHex: 'deadbeef' },
        ],
      }),
    )
  })

  it('passes selectedUtxos with correct format', async () => {
    const request = makeActionRequest({
      outputs: [{ lockingScript: 'cafe', satoshis: 100 }],
    })

    await buildAndBroadcastAction(mockKeys, request)

    const invokeCall = mockInvoke.mock.calls[0]!
    const args = invokeCall[1] as Record<string, unknown>
    const utxos = args.selectedUtxos as Array<Record<string, unknown>>

    expect(utxos[0]).toEqual(expect.objectContaining({
      txid: 'a'.repeat(64),
      vout: 0,
      satoshis: 50000,
    }))
  })
})
