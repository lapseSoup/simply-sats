import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as bip39 from 'bip39'
import {
  createWallet,
  restoreWallet,
  importFromShaullet,
  importFrom1SatOrdinals,
  importFromJSON,
  getBalance,
  getUTXOs,
  getTransactionHistory,
  getTransactionDetails,
  calculateTxAmount,
  calculateTxFee,
  calculateMaxSend,
  calculateExactFee,
  getFeeRate,
  setFeeRate,
  feeFromBytes,
  saveWallet,
  changePassword,
  type UTXO,
  type WocTransaction,
  type WocTxInput
} from './wallet'

// Test mnemonic for deterministic testing
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const TEST_MNEMONIC_INVALID = 'invalid mnemonic phrase that should fail validation check'

describe('Wallet Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('createWallet', () => {
    it('should create a new wallet with valid keys', () => {
      const wallet = createWallet()

      expect(wallet).toBeDefined()
      expect(wallet.mnemonic).toBeDefined()
      expect(wallet.mnemonic.split(' ')).toHaveLength(12)
      expect(bip39.validateMnemonic(wallet.mnemonic)).toBe(true)

      // Check all key types are present
      expect(wallet.walletWif).toBeDefined()
      expect(wallet.walletAddress).toBeDefined()
      expect(wallet.walletPubKey).toBeDefined()
      expect(wallet.ordWif).toBeDefined()
      expect(wallet.ordAddress).toBeDefined()
      expect(wallet.ordPubKey).toBeDefined()
      expect(wallet.identityWif).toBeDefined()
      expect(wallet.identityAddress).toBeDefined()
      expect(wallet.identityPubKey).toBeDefined()

      // Verify wallet type
      expect(wallet.walletType).toBe('yours')
    })

    it('should generate unique wallets each time', () => {
      const wallet1 = createWallet()
      const wallet2 = createWallet()

      expect(wallet1.mnemonic).not.toBe(wallet2.mnemonic)
      expect(wallet1.walletAddress).not.toBe(wallet2.walletAddress)
    })
  })

  describe('restoreWallet', () => {
    it('should restore wallet from valid mnemonic', () => {
      const wallet = restoreWallet(TEST_MNEMONIC)

      expect(wallet.mnemonic).toBe(TEST_MNEMONIC)
      expect(wallet.walletType).toBe('yours')
      expect(wallet.walletAddress).toBeDefined()
      expect(wallet.walletWif).toBeDefined()
    })

    it('should produce deterministic keys from same mnemonic', () => {
      const wallet1 = restoreWallet(TEST_MNEMONIC)
      const wallet2 = restoreWallet(TEST_MNEMONIC)

      expect(wallet1.walletWif).toBe(wallet2.walletWif)
      expect(wallet1.walletAddress).toBe(wallet2.walletAddress)
      expect(wallet1.walletPubKey).toBe(wallet2.walletPubKey)
      expect(wallet1.ordWif).toBe(wallet2.ordWif)
      expect(wallet1.identityWif).toBe(wallet2.identityWif)
    })

    it('should normalize mnemonic (lowercase, trim spaces)', () => {
      const wallet1 = restoreWallet(TEST_MNEMONIC)
      const wallet2 = restoreWallet('  ' + TEST_MNEMONIC.toUpperCase() + '  ')

      expect(wallet1.walletAddress).toBe(wallet2.walletAddress)
    })

    it('should handle multiple spaces between words', () => {
      const normalMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const spacedMnemonic = 'abandon  abandon   abandon    abandon abandon abandon abandon abandon abandon abandon abandon about'

      const wallet1 = restoreWallet(normalMnemonic)
      const wallet2 = restoreWallet(spacedMnemonic)

      expect(wallet1.walletAddress).toBe(wallet2.walletAddress)
    })

    it('should throw error for invalid mnemonic', () => {
      expect(() => restoreWallet(TEST_MNEMONIC_INVALID)).toThrow('Invalid mnemonic phrase')
    })

    it('should throw error for empty mnemonic', () => {
      expect(() => restoreWallet('')).toThrow()
    })

    it('should throw error for wrong word count', () => {
      expect(() => restoreWallet('abandon abandon abandon')).toThrow()
    })
  })

  describe('importFromShaullet', () => {
    it('should import from Shaullet backup with mnemonic', () => {
      const backup = JSON.stringify({ mnemonic: TEST_MNEMONIC })
      const wallet = importFromShaullet(backup)

      expect(wallet.mnemonic).toBe(TEST_MNEMONIC)
      expect(wallet.walletType).toBe('yours')
    })

    it('should import from Shaullet backup with WIF', () => {
      // This is a test WIF (not real funds!)
      const testWif = 'L1HKVVLHXiUhecWnwFYF6L3shkf1E12HUmuZTESvBXUdx3yqVP1D'
      const backup = JSON.stringify({ keys: { wif: testWif } })
      const wallet = importFromShaullet(backup)

      expect(wallet.mnemonic).toBe('')
      expect(wallet.walletWif).toBe(testWif)
      // When importing from WIF only, same key is used for all purposes
      expect(wallet.ordWif).toBe(testWif)
      expect(wallet.identityWif).toBe(testWif)
    })

    it('should throw for invalid Shaullet format', () => {
      const badBackup = JSON.stringify({ foo: 'bar' })
      expect(() => importFromShaullet(badBackup)).toThrow('Invalid Shaullet backup format')
    })

    it('should throw for invalid JSON', () => {
      expect(() => importFromShaullet('not json')).toThrow('Invalid JSON format')
    })
  })

  describe('importFrom1SatOrdinals', () => {
    it('should import from 1Sat backup with mnemonic', () => {
      const backup = JSON.stringify({ mnemonic: TEST_MNEMONIC })
      const wallet = importFrom1SatOrdinals(backup)

      expect(wallet.mnemonic).toBe(TEST_MNEMONIC)
    })

    it('should import from 1Sat backup with separate keys', () => {
      const testPayWif = 'L1HKVVLHXiUhecWnwFYF6L3shkf1E12HUmuZTESvBXUdx3yqVP1D'
      const testOrdWif = 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn'
      const backup = JSON.stringify({ payPk: testPayWif, ordPk: testOrdWif })
      const wallet = importFrom1SatOrdinals(backup)

      expect(wallet.walletWif).toBe(testPayWif)
      expect(wallet.ordWif).toBe(testOrdWif)
    })

    it('should throw for invalid 1Sat format', () => {
      const badBackup = JSON.stringify({ foo: 'bar' })
      expect(() => importFrom1SatOrdinals(badBackup)).toThrow('Invalid 1Sat Ordinals backup format')
    })
  })

  describe('importFromJSON', () => {
    it('should auto-detect Shaullet format', () => {
      const backup = JSON.stringify({ mnemonic: TEST_MNEMONIC })
      const wallet = importFromJSON(backup)

      expect(wallet.mnemonic).toBe(TEST_MNEMONIC)
    })

    it('should auto-detect 1Sat Ordinals format', () => {
      const testWif = 'L1HKVVLHXiUhecWnwFYF6L3shkf1E12HUmuZTESvBXUdx3yqVP1D'
      const backup = JSON.stringify({ payPk: testWif })
      const wallet = importFromJSON(backup)

      expect(wallet.walletWif).toBe(testWif)
    })

    it('should throw for unknown format', () => {
      const backup = JSON.stringify({ unknownField: 'value' })
      expect(() => importFromJSON(backup)).toThrow('Unknown backup format')
    })
  })

  describe('Fee Calculations', () => {
    describe('getFeeRate / setFeeRate', () => {
      it('should return default fee rate when not set', () => {
        const rate = getFeeRate()
        expect(rate).toBe(0.1) // Default rate (0.1 sat/byte)
      })

      it('should persist and retrieve custom fee rate', () => {
        setFeeRate(0.5)
        expect(getFeeRate()).toBe(0.5)
      })

      it('should ignore invalid stored values', () => {
        localStorage.setItem('simply_sats_fee_rate', 'invalid')
        expect(getFeeRate()).toBe(0.1) // Should return default
      })
    })

    describe('feeFromBytes', () => {
      it('should calculate fee from byte size', () => {
        // At 0.071 sat/byte, 1000 bytes = 71 sats
        const fee = feeFromBytes(1000, 0.071)
        expect(fee).toBe(71)
      })

      it('should return minimum of 1 sat', () => {
        const fee = feeFromBytes(1, 0.001)
        expect(fee).toBe(1)
      })

      it('should use configured fee rate when not specified', () => {
        setFeeRate(0.1)
        const fee = feeFromBytes(1000)
        expect(fee).toBe(100)
      })
    })

    describe('calculateTxFee', () => {
      it('should calculate fee for standard P2PKH transaction', () => {
        // 1 input, 2 outputs
        const fee = calculateTxFee(1, 2)
        // TX_OVERHEAD(10) + 1*INPUT(148) + 2*OUTPUT(34) = 226 bytes
        // At 0.071 sat/byte = ~16 sats
        expect(fee).toBeGreaterThan(0)
        expect(fee).toBeLessThan(50)
      })

      it('should scale with input count', () => {
        const fee1 = calculateTxFee(1, 2)
        const fee5 = calculateTxFee(5, 2)

        expect(fee5).toBeGreaterThan(fee1)
      })

      it('should include extra bytes in calculation', () => {
        const feeBase = calculateTxFee(1, 1, 0)
        const feeExtra = calculateTxFee(1, 1, 100)

        expect(feeExtra).toBeGreaterThan(feeBase)
      })
    })

    describe('calculateMaxSend', () => {
      it('should return 0 for empty UTXOs', () => {
        const result = calculateMaxSend([])

        expect(result.maxSats).toBe(0)
        expect(result.fee).toBe(0)
        expect(result.numInputs).toBe(0)
      })

      it('should calculate max sendable amount', () => {
        const utxos: UTXO[] = [
          { txid: 'abc', vout: 0, satoshis: 10000, script: '76a914...' }
        ]

        const result = calculateMaxSend(utxos)

        expect(result.numInputs).toBe(1)
        expect(result.fee).toBeGreaterThan(0)
        expect(result.maxSats).toBe(10000 - result.fee)
        expect(result.maxSats).toBeLessThan(10000)
      })

      it('should aggregate multiple UTXOs', () => {
        const utxos: UTXO[] = [
          { txid: 'abc', vout: 0, satoshis: 5000, script: '76a914...' },
          { txid: 'def', vout: 1, satoshis: 5000, script: '76a914...' }
        ]

        const result = calculateMaxSend(utxos)

        expect(result.numInputs).toBe(2)
        // Total is 10000, minus fee for 2 inputs
        expect(result.maxSats).toBeLessThan(10000)
        expect(result.maxSats).toBeGreaterThan(9000)
      })
    })

    describe('calculateExactFee', () => {
      it('should return canSend false for insufficient funds', () => {
        const utxos: UTXO[] = [
          { txid: 'abc', vout: 0, satoshis: 100, script: '76a914...' }
        ]

        const result = calculateExactFee(10000, utxos)

        expect(result.canSend).toBe(false)
      })

      it('should calculate exact fee for specific amount', () => {
        const utxos: UTXO[] = [
          { txid: 'abc', vout: 0, satoshis: 10000, script: '76a914...' }
        ]

        const result = calculateExactFee(5000, utxos)

        expect(result.canSend).toBe(true)
        expect(result.inputCount).toBe(1)
        expect(result.outputCount).toBe(2) // recipient + change
        expect(result.fee).toBeGreaterThan(0)
      })

      it('should handle no change output case', () => {
        const utxos: UTXO[] = [
          { txid: 'abc', vout: 0, satoshis: 1000, script: '76a914...' }
        ]

        // Try to send almost all (leaving less than 100 for change)
        const result = calculateExactFee(950, utxos)

        expect(result.outputCount).toBe(1) // No change needed
      })
    })
  })

  describe('API Functions', () => {
    describe('getBalance', () => {
      it('should fetch balance from WhatsOnChain', async () => {
        const mockResponse = { confirmed: 10000, unconfirmed: 500 }
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockResponse)
        } as Response)

        const balance = await getBalance('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')

        expect(balance).toBe(10500)
        // wocClient uses fetchWithTimeout which adds AbortController signal
        expect(fetch).toHaveBeenCalledWith(
          'https://api.whatsonchain.com/v1/bsv/main/address/1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2/balance',
          expect.objectContaining({ signal: expect.any(AbortSignal) })
        )
      })

      it('should return 0 on API error', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        } as Response)

        const balance = await getBalance('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')

        expect(balance).toBe(0)
      })

      it('should return 0 on network error', async () => {
        vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'))

        const balance = await getBalance('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')

        expect(balance).toBe(0)
      })
    })

    describe('getUTXOs', () => {
      it('should fetch and format UTXOs', async () => {
        const mockUtxos = [
          { tx_hash: 'abc123', tx_pos: 0, value: 10000 },
          { tx_hash: 'def456', tx_pos: 1, value: 5000 }
        ]
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockUtxos)
        } as Response)

        const utxos = await getUTXOs('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')

        expect(utxos).toHaveLength(2)
        expect(utxos[0].txid).toBe('abc123')
        expect(utxos[0].vout).toBe(0)
        expect(utxos[0].satoshis).toBe(10000)
        expect(utxos[0].script).toBeDefined()
      })

      it('should return empty array on error', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: false,
          status: 404
        } as Response)

        const utxos = await getUTXOs('invalid')

        expect(utxos).toEqual([])
      })
    })

    describe('getTransactionHistory', () => {
      it('should fetch transaction history', async () => {
        const mockHistory = [
          { tx_hash: 'abc123', height: 100 },
          { tx_hash: 'def456', height: 101 }
        ]
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockHistory)
        } as Response)

        const history = await getTransactionHistory('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')

        expect(history).toHaveLength(2)
        expect(history[0].tx_hash).toBe('abc123')
      })

      it('should return empty array on error', async () => {
        vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'))

        const history = await getTransactionHistory('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')

        expect(history).toEqual([])
      })
    })

    describe('getTransactionDetails', () => {
      it('should fetch transaction details', async () => {
        const mockTx = {
          txid: 'abc123',
          vin: [{ txid: 'prev', vout: 0 }],
          vout: [{ value: 0.0001, scriptPubKey: { addresses: ['1abc'] } }]
        }
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTx)
        } as Response)

        const tx = await getTransactionDetails('abc123')

        expect(tx).toBeDefined()
        expect(tx?.txid).toBe('abc123')
      })

      it('should return null on error', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: false,
          status: 404
        } as Response)

        const tx = await getTransactionDetails('invalid')

        expect(tx).toBeNull()
      })
    })

    describe('calculateTxAmount', () => {
      it('should calculate positive amount for received tx', async () => {
        // Partial mock - only needs vin and vout for amount calculation
        const txDetails = {
          txid: 'abc',
          hash: 'abc',
          version: 1,
          size: 100,
          locktime: 0,
          vin: [] as WocTxInput[],
          vout: [
            { value: 0.0001, n: 0, scriptPubKey: { asm: '', hex: '', type: 'pubkeyhash', addresses: ['myaddress'] } }
          ]
        } satisfies WocTransaction

        const amount = await calculateTxAmount(txDetails, 'myaddress')

        expect(amount).toBe(10000) // 0.0001 BTC in sats
      })

      it('should support array of addresses', async () => {
        const txDetails = {
          txid: 'def',
          hash: 'def',
          version: 1,
          size: 100,
          locktime: 0,
          vin: [] as WocTxInput[],
          vout: [
            { value: 0.0001, n: 0, scriptPubKey: { asm: '', hex: '', type: 'pubkeyhash', addresses: ['addr1'] } },
            { value: 0.0002, n: 1, scriptPubKey: { asm: '', hex: '', type: 'pubkeyhash', addresses: ['addr2'] } }
          ]
        } satisfies WocTransaction

        const amount = await calculateTxAmount(txDetails, ['addr1', 'addr2'])

        expect(amount).toBe(30000) // 0.0003 BTC total
      })

      it('should return 0 for null/undefined tx', async () => {
        expect(await calculateTxAmount(null, 'addr')).toBe(0)
      })
    })
  })

  describe('Password Policy', () => {
    const mockWalletKeys = {
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      walletType: 'yours' as const,
      walletWif: 'L1234567890abcdef',
      walletAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
      walletPubKey: '02abcdef1234567890',
      ordWif: 'L1234567890abcdef',
      ordAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
      ordPubKey: '02abcdef1234567890',
      identityWif: 'L1234567890abcdef',
      identityAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
      identityPubKey: '02abcdef1234567890'
    }

    describe('saveWallet', () => {
      it('should reject passwords shorter than 14 characters', async () => {
        await expect(saveWallet(mockWalletKeys, 'short')).rejects.toThrow('Password must be at least 14 characters')
        await expect(saveWallet(mockWalletKeys, '1234567890123')).rejects.toThrow('Password must be at least 14 characters')
      })

      it('should reject empty passwords', async () => {
        await expect(saveWallet(mockWalletKeys, '')).rejects.toThrow('Password must be at least 14 characters')
      })
    })

    describe('changePassword', () => {
      it('should reject new passwords shorter than 14 characters', async () => {
        await expect(changePassword('oldpassword1234', 'short')).rejects.toThrow('Password must be at least 14 characters')
        await expect(changePassword('oldpassword1234', '1234567890123')).rejects.toThrow('Password must be at least 14 characters')
      })

      it('should reject empty new passwords', async () => {
        await expect(changePassword('oldpassword1234', '')).rejects.toThrow('Password must be at least 14 characters')
      })

      it('should fail gracefully when wallet not found', async () => {
        await expect(changePassword('wrongpassword', 'newpassword123')).rejects.toThrow('Wrong password or wallet not found')
      })
    })
  })

  describe('verifyMnemonicMatchesWallet', () => {
    it('should return valid: true when mnemonic matches wallet address', async () => {
      // Create wallet from known mnemonic
      const wallet = restoreWallet(TEST_MNEMONIC)

      // Import the verification function
      const { verifyMnemonicMatchesWallet } = await import('./wallet/core')

      // Verify with correct mnemonic
      const result = await verifyMnemonicMatchesWallet(TEST_MNEMONIC, wallet.walletAddress)

      expect(result.valid).toBe(true)
      expect(result.derivedAddress).toBe(wallet.walletAddress)
    })

    it('should return valid: false when mnemonic does not match wallet address', async () => {
      // Create wallet from known mnemonic
      const wallet = restoreWallet(TEST_MNEMONIC)

      // Import the verification function
      const { verifyMnemonicMatchesWallet } = await import('./wallet/core')

      // Use a different mnemonic
      const differentMnemonic = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'

      const result = await verifyMnemonicMatchesWallet(differentMnemonic, wallet.walletAddress)

      expect(result.valid).toBe(false)
      expect(result.derivedAddress).not.toBe(wallet.walletAddress)
    })

    it('should throw error for invalid mnemonic', async () => {
      const { verifyMnemonicMatchesWallet } = await import('./wallet/core')

      await expect(
        verifyMnemonicMatchesWallet('invalid mnemonic phrase', '1someaddress')
      ).rejects.toThrow()
    })

    it('should normalize mnemonic before verification', async () => {
      const wallet = restoreWallet(TEST_MNEMONIC)
      const { verifyMnemonicMatchesWallet } = await import('./wallet/core')

      // Test with uppercase and extra spaces
      const messyMnemonic = '  ABANDON ABANDON  ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABOUT  '

      const result = await verifyMnemonicMatchesWallet(messyMnemonic, wallet.walletAddress)

      expect(result.valid).toBe(true)
    })
  })
})
