// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetBalance, mockGetUtxos, mockGetTransactionHistory, mockGetTransactionDetails } = vi.hoisted(() => ({
  mockGetBalance: vi.fn(),
  mockGetUtxos: vi.fn(),
  mockGetTransactionHistory: vi.fn(),
  mockGetTransactionDetails: vi.fn(),
}))

const { mockGetBalanceFromDatabase, mockGetSpendableUtxosFromDatabase } = vi.hoisted(() => ({
  mockGetBalanceFromDatabase: vi.fn(),
  mockGetSpendableUtxosFromDatabase: vi.fn(),
}))

vi.mock('../../infrastructure/api/wocClient', () => ({
  getWocClient: () => ({
    getBalance: mockGetBalance,
    getUtxos: mockGetUtxos,
    getTransactionHistory: mockGetTransactionHistory,
    getTransactionDetails: mockGetTransactionDetails,
  })
}))

vi.mock('../sync', () => ({
  getBalanceFromDatabase: mockGetBalanceFromDatabase,
  getSpendableUtxosFromDatabase: mockGetSpendableUtxosFromDatabase,
  BASKETS: { DEFAULT: 'default', LOCKS: 'locks', DERIVED: 'derived' },
}))

vi.mock('../logger', () => ({
  walletLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import {
  getBalance,
  getBalanceFromDB,
  getUTXOsFromDB,
  getUTXOs,
  getTransactionHistory,
  getTransactionDetails,
  calculateTxAmount,
} from './balance'

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------- getBalance ----------

describe('getBalance', () => {
  it('delegates to wocClient', async () => {
    mockGetBalance.mockResolvedValueOnce(50000)

    const result = await getBalance('1TestAddr')
    expect(result).toBe(50000)
    expect(mockGetBalance).toHaveBeenCalledWith('1TestAddr')
  })
})

// ---------- getBalanceFromDB ----------

describe('getBalanceFromDB', () => {
  it('returns balance from database', async () => {
    mockGetBalanceFromDatabase.mockResolvedValueOnce(25000)

    const result = await getBalanceFromDB('default')
    expect(result).toBe(25000)
    expect(mockGetBalanceFromDatabase).toHaveBeenCalledWith('default')
  })

  it('returns 0 on database error', async () => {
    mockGetBalanceFromDatabase.mockRejectedValueOnce(new Error('DB failed'))

    const result = await getBalanceFromDB()
    expect(result).toBe(0)
  })

  it('passes basket parameter', async () => {
    mockGetBalanceFromDatabase.mockResolvedValueOnce(100)

    await getBalanceFromDB('derived')
    expect(mockGetBalanceFromDatabase).toHaveBeenCalledWith('derived')
  })
})

// ---------- getUTXOsFromDB ----------

describe('getUTXOsFromDB', () => {
  it('returns mapped UTXOs from database', async () => {
    mockGetSpendableUtxosFromDatabase.mockResolvedValueOnce([
      { txid: 'tx1', vout: 0, satoshis: 1000, lockingScript: 'ls1' }
    ])

    const result = await getUTXOsFromDB('derived')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ txid: 'tx1', vout: 0, satoshis: 1000, script: 'ls1' })
  })

  it('returns empty array on database error', async () => {
    mockGetSpendableUtxosFromDatabase.mockRejectedValueOnce(new Error('DB failed'))

    const result = await getUTXOsFromDB()
    expect(result).toEqual([])
  })

  it('defaults to default basket', async () => {
    mockGetSpendableUtxosFromDatabase.mockResolvedValueOnce([])

    await getUTXOsFromDB()
    expect(mockGetSpendableUtxosFromDatabase).toHaveBeenCalledWith('default')
  })
})

// ---------- getUTXOs ----------

describe('getUTXOs', () => {
  it('delegates to wocClient', async () => {
    const utxos = [{ txid: 'tx1', vout: 0, satoshis: 5000, script: 'ls1' }]
    mockGetUtxos.mockResolvedValueOnce(utxos)

    const result = await getUTXOs('1Addr')
    expect(result).toEqual(utxos)
    expect(mockGetUtxos).toHaveBeenCalledWith('1Addr')
  })
})

// ---------- getTransactionHistory ----------

describe('getTransactionHistory', () => {
  it('returns mapped history items', async () => {
    mockGetTransactionHistory.mockResolvedValueOnce([
      { tx_hash: 'abc123', height: 800000 }
    ])

    const result = await getTransactionHistory('1Addr')
    expect(result).toEqual([{ tx_hash: 'abc123', height: 800000 }])
  })
})

// ---------- getTransactionDetails ----------

describe('getTransactionDetails', () => {
  it('returns transaction details', async () => {
    const txDetails = { txid: 'tx1', vin: [], vout: [] }
    mockGetTransactionDetails.mockResolvedValueOnce(txDetails)

    const result = await getTransactionDetails('tx1')
    expect(result).toMatchObject({ txid: 'tx1' })
  })
})

// ---------- calculateTxAmount ----------

describe('calculateTxAmount', () => {
  it('returns 0 for null txDetails', async () => {
    const result = await calculateTxAmount(null, '1Addr')
    expect(result).toBe(0)
  })

  it('returns 0 when vin or vout is missing', async () => {
    const result = await calculateTxAmount({ txid: 'tx1' } as never, '1Addr')
    expect(result).toBe(0)
  })

  it('calculates positive amount for received tx', async () => {
    const tx = {
      txid: 'tx1',
      vin: [{ txid: 'prevTx', vout: 0, scriptSig: { asm: '', hex: '' }, sequence: 0xffffffff }],
      vout: [
        { value: 0.0001, n: 0, scriptPubKey: { asm: '', hex: '', type: 'pubkeyhash', addresses: ['1MyAddr'] } }
      ]
    }
    // prevTx lookup: output not ours
    mockGetTransactionDetails.mockResolvedValueOnce({
      txid: 'prevTx',
      vout: [{ value: 0.00005, n: 0, scriptPubKey: { asm: '', hex: '', type: 'pubkeyhash', addresses: ['1Other'] } }]
    })

    const result = await calculateTxAmount(tx as never, '1MyAddr')
    expect(result).toBe(10000) // 0.0001 BTC received, 0 sent
  })

  it('calculates negative amount for sent tx using prevout', async () => {
    const tx = {
      txid: 'tx1',
      vin: [{
        txid: 'prevTx',
        vout: 0,
        scriptSig: { asm: '', hex: '' },
        sequence: 0xffffffff,
        prevout: { value: 0.0005, scriptPubKey: { addresses: ['1MyAddr'] } }
      }],
      vout: [
        { value: 0.0003, n: 0, scriptPubKey: { asm: '', hex: '', type: 'pubkeyhash', addresses: ['1Other'] } },
        { value: 0.0001, n: 1, scriptPubKey: { asm: '', hex: '', type: 'pubkeyhash', addresses: ['1MyAddr'] } } // change
      ]
    }

    // With prevout available, no need to fetch previous tx
    const result = await calculateTxAmount(tx as never, '1MyAddr')
    // Received: 10000 (change), Sent: 50000 (input) => -40000
    expect(result).toBe(-40000)
  })

  it('handles array of addresses', async () => {
    const tx = {
      txid: 'tx1',
      vin: [],
      vout: [
        { value: 0.0001, n: 0, scriptPubKey: { asm: '', hex: '', type: 'pubkeyhash', addresses: ['1Addr2'] } }
      ]
    }

    const result = await calculateTxAmount(tx as never, ['1Addr1', '1Addr2'])
    expect(result).toBe(10000)
  })

  it('handles fetch failure for previous tx gracefully', async () => {
    const tx = {
      txid: 'tx1',
      vin: [{ txid: 'prevTx', vout: 0, scriptSig: { asm: '', hex: '' }, sequence: 0xffffffff }],
      vout: [
        { value: 0.0001, n: 0, scriptPubKey: { asm: '', hex: '', type: 'pubkeyhash', addresses: ['1MyAddr'] } }
      ]
    }
    mockGetTransactionDetails.mockRejectedValueOnce(new Error('Network error'))

    const result = await calculateTxAmount(tx as never, '1MyAddr')
    // Only received amount counted, sent skipped due to fetch failure
    expect(result).toBe(10000)
  })

  it('returns 0 for tx with no matching addresses', async () => {
    const tx = {
      txid: 'tx1',
      vin: [{ txid: 'prevTx', vout: 0, scriptSig: { asm: '', hex: '' }, sequence: 0xffffffff }],
      vout: [
        { value: 0.0001, n: 0, scriptPubKey: { asm: '', hex: '', type: 'pubkeyhash', addresses: ['1Other'] } }
      ]
    }
    mockGetTransactionDetails.mockResolvedValueOnce({
      txid: 'prevTx',
      vout: [{ value: 0.00005, n: 0, scriptPubKey: { asm: '', hex: '', type: 'pubkeyhash', addresses: ['1Other2'] } }]
    })

    const result = await calculateTxAmount(tx as never, '1MyAddr')
    expect(result).toBe(0)
  })
})
