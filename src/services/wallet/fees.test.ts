// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockGpMapiGet } = vi.hoisted(() => ({
  mockGpMapiGet: vi.fn(),
}))

vi.mock('../../infrastructure/api/clients', () => ({
  gpMapiApi: { get: mockGpMapiGet }
}))

vi.mock('../logger', () => ({
  walletLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

// Mock localStorage — override the setup.ts mock with our own store for isolated testing
const localStorageStore: Record<string, string> = {}
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value }),
  removeItem: vi.fn((key: string) => { delete localStorageStore[key] }),
}
vi.stubGlobal('localStorage', mockLocalStorage)

import {
  getFeeRate,
  setFeeRate,
  clearFeeRateOverride,
  getFeeRatePerKB,
  setFeeRateFromKB,
  feeFromBytes,
  calculateTxFee,
  calculateLockFee,
  calculateMaxSend,
  calculateExactFee,
  fetchDynamicFeeRate,
  getFeeRateAsync,
} from './fees'

beforeEach(() => {
  vi.clearAllMocks()
  // Clear localStorage store
  for (const key in localStorageStore) {
    delete localStorageStore[key]
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------- getFeeRate ----------

describe('getFeeRate', () => {
  it('returns default rate when no override stored', () => {
    const rate = getFeeRate()
    expect(rate).toBe(0.1) // DEFAULT_FEE_RATE
  })

  it('returns stored user rate', () => {
    localStorageStore['simply_sats_fee_rate'] = '0.5'
    const rate = getFeeRate()
    expect(rate).toBe(0.5)
  })

  it('clamps stored rate to MIN_FEE_RATE', () => {
    localStorageStore['simply_sats_fee_rate'] = '0.0001'
    const rate = getFeeRate()
    expect(rate).toBe(0.001) // MIN_FEE_RATE
  })

  it('clamps stored rate to MAX_FEE_RATE', () => {
    localStorageStore['simply_sats_fee_rate'] = '5.0'
    const rate = getFeeRate()
    expect(rate).toBe(1.0) // MAX_FEE_RATE
  })

  it('ignores invalid stored values', () => {
    localStorageStore['simply_sats_fee_rate'] = 'abc'
    const rate = getFeeRate()
    expect(rate).toBe(0.1) // falls through to default
  })

  it('ignores zero stored value', () => {
    localStorageStore['simply_sats_fee_rate'] = '0'
    const rate = getFeeRate()
    expect(rate).toBe(0.1) // falls through to default
  })

  it('ignores negative stored value', () => {
    localStorageStore['simply_sats_fee_rate'] = '-1'
    const rate = getFeeRate()
    expect(rate).toBe(0.1) // falls through to default
  })
})

// ---------- setFeeRate ----------

describe('setFeeRate', () => {
  it('stores the fee rate in localStorage', () => {
    setFeeRate(0.5)
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('simply_sats_fee_rate', '0.5')
  })
})

// ---------- clearFeeRateOverride ----------

describe('clearFeeRateOverride', () => {
  it('removes the stored fee rate', () => {
    clearFeeRateOverride()
    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('simply_sats_fee_rate')
  })
})

// ---------- getFeeRatePerKB ----------

describe('getFeeRatePerKB', () => {
  it('returns rate * 1000 rounded', () => {
    // Default rate is 0.1 sat/byte = 100 sat/KB
    const rate = getFeeRatePerKB()
    expect(rate).toBe(100)
  })

  it('converts user rate to KB', () => {
    localStorageStore['simply_sats_fee_rate'] = '0.5'
    const rate = getFeeRatePerKB()
    expect(rate).toBe(500)
  })
})

// ---------- setFeeRateFromKB ----------

describe('setFeeRateFromKB', () => {
  it('divides by 1000 before storing', () => {
    setFeeRateFromKB(500)
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('simply_sats_fee_rate', '0.5')
  })

  it('stores minimum rate from 1 sat/KB', () => {
    setFeeRateFromKB(1)
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('simply_sats_fee_rate', '0.001')
  })
})

// ---------- feeFromBytes ----------

describe('feeFromBytes', () => {
  it('calculates fee using default rate', () => {
    // 250 bytes * 0.1 sat/byte = 25 sats
    const fee = feeFromBytes(250)
    expect(fee).toBe(25)
  })

  it('calculates fee using custom rate', () => {
    // 100 bytes * 0.5 sat/byte = 50 sats
    const fee = feeFromBytes(100, 0.5)
    expect(fee).toBe(50)
  })

  it('returns minimum 1 sat fee', () => {
    const fee = feeFromBytes(1, 0.001)
    expect(fee).toBe(1)
  })

  it('rounds up fractional fees', () => {
    // 250 bytes * 0.05 sat/byte = 12.5 -> 13
    const fee = feeFromBytes(250, 0.05)
    expect(fee).toBe(13)
  })
})

// ---------- calculateTxFee ----------

describe('calculateTxFee', () => {
  it('calculates fee for standard P2PKH tx', () => {
    // 10 overhead + 1*148 input + 2*34 outputs = 226 bytes
    // 226 * 0.1 = 22.6 -> 23
    const fee = calculateTxFee(1, 2)
    expect(fee).toBe(23)
  })

  it('increases with more inputs', () => {
    const fee1 = calculateTxFee(1, 1)
    const fee2 = calculateTxFee(3, 1)
    expect(fee2).toBeGreaterThan(fee1)
  })

  it('includes extra bytes in calculation', () => {
    const feeNoExtra = calculateTxFee(1, 1)
    const feeWithExtra = calculateTxFee(1, 1, 100)
    expect(feeWithExtra).toBeGreaterThan(feeNoExtra)
  })
})

// ---------- calculateLockFee ----------

describe('calculateLockFee', () => {
  it('returns higher fee than standard tx due to large lock script', () => {
    const lockFee = calculateLockFee(1)
    const stdFee = calculateTxFee(1, 2)
    expect(lockFee).toBeGreaterThan(stdFee)
  })

  it('accepts custom timelock script size', () => {
    const fee1 = calculateLockFee(1, 500)
    const fee2 = calculateLockFee(1, 1500)
    expect(fee2).toBeGreaterThan(fee1)
  })
})

// ---------- calculateMaxSend ----------

describe('calculateMaxSend', () => {
  it('returns 0 for empty UTXOs', () => {
    const result = calculateMaxSend([])
    expect(result).toEqual({ maxSats: 0, fee: 0, numInputs: 0 })
  })

  it('calculates max send from single UTXO', () => {
    const utxos = [{ txid: 'tx1', vout: 0, satoshis: 10000, script: 'ls1' }]
    const result = calculateMaxSend(utxos)
    expect(result.maxSats).toBeGreaterThan(0)
    expect(result.maxSats).toBeLessThan(10000)
    expect(result.fee).toBeGreaterThan(0)
    expect(result.numInputs).toBe(1)
    expect(result.maxSats + result.fee).toBe(10000)
  })

  it('sums multiple UTXOs', () => {
    const utxos = [
      { txid: 'tx1', vout: 0, satoshis: 5000, script: 'ls1' },
      { txid: 'tx2', vout: 0, satoshis: 3000, script: 'ls2' },
    ]
    const result = calculateMaxSend(utxos)
    expect(result.numInputs).toBe(2)
    expect(result.maxSats + result.fee).toBe(8000)
  })
})

// ---------- calculateExactFee ----------

describe('calculateExactFee', () => {
  it('returns canSend=false for empty UTXOs', () => {
    const result = calculateExactFee(1000, [])
    expect(result.canSend).toBe(false)
  })

  it('returns canSend=false for 0 satoshis', () => {
    const result = calculateExactFee(0, [{ txid: 'tx1', vout: 0, satoshis: 5000, script: 'ls1' }])
    expect(result.canSend).toBe(false)
  })

  it('calculates fee with change output', () => {
    const utxos = [{ txid: 'tx1', vout: 0, satoshis: 10000, script: 'ls1' }]
    const result = calculateExactFee(5000, utxos)
    expect(result.canSend).toBe(true)
    expect(result.fee).toBeGreaterThan(0)
    expect(result.inputCount).toBe(1)
    expect(result.outputCount).toBe(2) // send + change
  })

  it('returns canSend=false when insufficient funds', () => {
    const utxos = [{ txid: 'tx1', vout: 0, satoshis: 100, script: 'ls1' }]
    const result = calculateExactFee(5000, utxos)
    expect(result.canSend).toBe(false)
  })
})

// ---------- fetchDynamicFeeRate ----------

describe('fetchDynamicFeeRate', () => {
  // The module caches fee rates for 5 minutes (FEE_RATE_CACHE_TTL).
  // Use fake timers and set Date.now() to a unique time well beyond any prior
  // cached timestamp so each test starts with an expired cache.
  let timeCounter = Date.now() + 10 * 60 * 1000

  beforeEach(() => {
    // Each test advances "now" far enough that any prior cache entry is expired
    timeCounter += 10 * 60 * 1000
    vi.useFakeTimers({ now: timeCounter })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns parsed fee rate from mAPI response', async () => {
    mockGpMapiGet.mockResolvedValueOnce({
      ok: true,
      value: {
        payload: JSON.stringify({
          fees: [{ feeType: 'standard', miningFee: { satoshis: 50, bytes: 1000 } }]
        })
      }
    })

    const rate = await fetchDynamicFeeRate()
    expect(rate).toBe(0.05) // 50/1000
  })

  it('returns default rate on network error', async () => {
    mockGpMapiGet.mockRejectedValueOnce(new Error('Network error'))

    const rate = await fetchDynamicFeeRate()
    expect(rate).toBe(0.1) // DEFAULT_FEE_RATE
  })

  it('returns default rate when API returns non-ok result', async () => {
    mockGpMapiGet.mockResolvedValueOnce({ ok: false, error: 'Server error' })

    const rate = await fetchDynamicFeeRate()
    expect(rate).toBe(0.1)
  })

  it('handles pre-parsed payload object', async () => {
    mockGpMapiGet.mockResolvedValueOnce({
      ok: true,
      value: {
        payload: {
          fees: [{ feeType: 'standard', miningFee: { satoshis: 100, bytes: 1000 } }]
        }
      }
    })

    const rate = await fetchDynamicFeeRate()
    expect(rate).toBe(0.1) // 100/1000
  })

  it('clamps rate to MIN_FEE_RATE', async () => {
    mockGpMapiGet.mockResolvedValueOnce({
      ok: true,
      value: {
        payload: JSON.stringify({
          fees: [{ feeType: 'standard', miningFee: { satoshis: 0, bytes: 1000 } }]
        })
      }
    })

    const rate = await fetchDynamicFeeRate()
    expect(rate).toBe(0.001) // MIN_FEE_RATE
  })

  it('clamps rate to MAX_FEE_RATE', async () => {
    mockGpMapiGet.mockResolvedValueOnce({
      ok: true,
      value: {
        payload: JSON.stringify({
          fees: [{ feeType: 'standard', miningFee: { satoshis: 5000, bytes: 1000 } }]
        })
      }
    })

    const rate = await fetchDynamicFeeRate()
    expect(rate).toBe(1.0) // MAX_FEE_RATE
  })

  it('returns default when no standard fee found', async () => {
    mockGpMapiGet.mockResolvedValueOnce({
      ok: true,
      value: {
        payload: JSON.stringify({
          fees: [{ feeType: 'data', miningFee: { satoshis: 50, bytes: 1000 } }]
        })
      }
    })

    const rate = await fetchDynamicFeeRate()
    expect(rate).toBe(0.1) // DEFAULT_FEE_RATE
  })
})

// ---------- getFeeRateAsync ----------

describe('getFeeRateAsync', () => {
  let asyncTimeCounter = Date.now() + 100 * 60 * 1000

  beforeEach(() => {
    asyncTimeCounter += 10 * 60 * 1000
    vi.useFakeTimers({ now: asyncTimeCounter })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns user override when set', async () => {
    localStorageStore['simply_sats_fee_rate'] = '0.3'
    const rate = await getFeeRateAsync()
    expect(rate).toBe(0.3)
    expect(mockGpMapiGet).not.toHaveBeenCalled()
  })

  it('fetches dynamic rate when no user override', async () => {
    mockGpMapiGet.mockResolvedValueOnce({
      ok: true,
      value: {
        payload: JSON.stringify({
          fees: [{ feeType: 'standard', miningFee: { satoshis: 50, bytes: 1000 } }]
        })
      }
    })

    const rate = await getFeeRateAsync()
    expect(rate).toBe(0.05)
  })
})
