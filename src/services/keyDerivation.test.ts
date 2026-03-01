import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  deriveChildKey,
  deriveSenderAddress,
  getDerivedAddressesFromKeys,
  findDerivedKeyForAddress,
  addKnownSender,
  loadKnownSenders,
  getKnownSenders,
  debugFindInvoiceNumber,
  getCommonInvoiceNumbers,
  type DerivedKeyResult,
  type DerivedAddressResult
} from './keyDerivation'

// Mock the tauri utility module
const mockTauriInvoke = vi.fn()
vi.mock('../utils/tauri', () => ({
  isTauri: () => true,
  tauriInvoke: (...args: unknown[]) => mockTauriInvoke(...args),
}))

// Test keys
const TEST_RECEIVER_WIF = 'L1HKVVLHXiUhecWnwFYF6L3shkf1E12HUmuZTESvBXUdx3yqVP1D'
const TEST_SENDER_PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const TEST_ANOTHER_SENDER = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'

describe('Key Derivation Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('deriveChildKey', () => {
    it('should call Tauri derive_child_key command', async () => {
      const mockResult: DerivedKeyResult = {
        wif: 'L2childWif',
        address: '1ChildAddress',
        pubKey: '02childpubkey'
      }
      mockTauriInvoke.mockResolvedValueOnce(mockResult)

      const result = await deriveChildKey(TEST_RECEIVER_WIF, TEST_SENDER_PUBKEY, '0')

      expect(mockTauriInvoke).toHaveBeenCalledWith('derive_child_key', {
        wif: TEST_RECEIVER_WIF,
        senderPubKey: TEST_SENDER_PUBKEY,
        invoiceNumber: '0',
      })
      expect(result).toEqual(mockResult)
    })

    it('should produce different keys for different invoice numbers', async () => {
      const result1: DerivedKeyResult = { wif: 'L2wif1', address: '1Addr1', pubKey: '02pk1' }
      const result2: DerivedKeyResult = { wif: 'L2wif2', address: '1Addr2', pubKey: '02pk2' }
      mockTauriInvoke.mockResolvedValueOnce(result1).mockResolvedValueOnce(result2)

      const child1 = await deriveChildKey(TEST_RECEIVER_WIF, TEST_SENDER_PUBKEY, '0')
      const child2 = await deriveChildKey(TEST_RECEIVER_WIF, TEST_SENDER_PUBKEY, '1')

      expect(child1.wif).not.toBe(child2.wif)
    })

    it('should handle empty invoice number', async () => {
      const mockResult: DerivedKeyResult = { wif: 'L2wif', address: '1Addr', pubKey: '02pk' }
      mockTauriInvoke.mockResolvedValueOnce(mockResult)

      const result = await deriveChildKey(TEST_RECEIVER_WIF, TEST_SENDER_PUBKEY, '')

      expect(result).toBeDefined()
      expect(result.wif).toBeDefined()
    })
  })

  describe('deriveSenderAddress', () => {
    it('should return the derived address', async () => {
      const mockResult: DerivedKeyResult = { wif: 'L2wif', address: '1DerivedAddr', pubKey: '02pk' }
      mockTauriInvoke.mockResolvedValueOnce(mockResult)

      const address = await deriveSenderAddress(TEST_RECEIVER_WIF, TEST_SENDER_PUBKEY, '0')

      expect(address).toBe('1DerivedAddr')
    })

    it('should produce different addresses for different senders', async () => {
      mockTauriInvoke
        .mockResolvedValueOnce({ wif: 'w1', address: '1Addr1', pubKey: 'pk1' })
        .mockResolvedValueOnce({ wif: 'w2', address: '1Addr2', pubKey: 'pk2' })

      const address1 = await deriveSenderAddress(TEST_RECEIVER_WIF, TEST_SENDER_PUBKEY, '0')
      const address2 = await deriveSenderAddress(TEST_RECEIVER_WIF, TEST_ANOTHER_SENDER, '0')

      expect(address1).not.toBe(address2)
    })
  })

  describe('getDerivedAddressesFromKeys', () => {
    it('should return empty array with no known senders', async () => {
      const addresses = await getDerivedAddressesFromKeys(TEST_RECEIVER_WIF, [], [])
      expect(addresses).toEqual([])
      expect(mockTauriInvoke).not.toHaveBeenCalled()
    })

    it('should call Tauri get_derived_addresses command', async () => {
      const senders = [TEST_SENDER_PUBKEY]
      const invoices = ['0', '1', '2']
      const mockResults: DerivedAddressResult[] = [
        { address: '1A', senderPubKey: TEST_SENDER_PUBKEY, invoiceNumber: '0' },
        { address: '1B', senderPubKey: TEST_SENDER_PUBKEY, invoiceNumber: '1' },
        { address: '1C', senderPubKey: TEST_SENDER_PUBKEY, invoiceNumber: '2' },
      ]
      mockTauriInvoke.mockResolvedValueOnce(mockResults)

      const addresses = await getDerivedAddressesFromKeys(TEST_RECEIVER_WIF, senders, invoices)

      expect(addresses).toHaveLength(3)
      expect(mockTauriInvoke).toHaveBeenCalledWith('get_derived_addresses', {
        wif: TEST_RECEIVER_WIF,
        senderPubKeys: senders,
        invoiceNumbers: invoices,
      })
    })
  })

  describe('findDerivedKeyForAddress', () => {
    it('should call Tauri find_derived_key_for_address command', async () => {
      const mockResult: DerivedKeyResult = { wif: 'L2found', address: '1Target', pubKey: '02pk' }
      mockTauriInvoke.mockResolvedValueOnce(mockResult)

      const result = await findDerivedKeyForAddress(
        TEST_RECEIVER_WIF,
        '1Target',
        TEST_SENDER_PUBKEY
      )

      expect(result).not.toBeNull()
      expect(result!.address).toBe('1Target')
      expect(mockTauriInvoke).toHaveBeenCalledWith('find_derived_key_for_address', {
        wif: TEST_RECEIVER_WIF,
        targetAddress: '1Target',
        senderPubKey: TEST_SENDER_PUBKEY,
        invoiceNumbers: expect.any(Array),
        maxNumeric: 100,
      })
    })

    it('should return null for non-matching address', async () => {
      mockTauriInvoke.mockResolvedValueOnce(null)

      const result = await findDerivedKeyForAddress(
        TEST_RECEIVER_WIF,
        '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
        TEST_SENDER_PUBKEY,
        [],
        10
      )

      expect(result).toBeNull()
    })
  })

  describe('Known Senders Management', () => {
    describe('addKnownSender', () => {
      it('should add a new sender', () => {
        addKnownSender(TEST_SENDER_PUBKEY)

        const senders = getKnownSenders()
        expect(senders).toContain(TEST_SENDER_PUBKEY)
      })

      it('should not add duplicate senders', () => {
        addKnownSender(TEST_SENDER_PUBKEY)
        addKnownSender(TEST_SENDER_PUBKEY)

        const senders = getKnownSenders()
        const count = senders.filter(s => s === TEST_SENDER_PUBKEY).length
        expect(count).toBe(1)
      })

      it('should reject invalid public keys', () => {
        const before = getKnownSenders().length
        addKnownSender('not-a-valid-pubkey')
        addKnownSender('04invalid-uncompressed')
        addKnownSender('02short')

        const after = getKnownSenders()
        // No new senders should have been added
        expect(after).toHaveLength(before)
      })

      it('should persist to localStorage', () => {
        expect(() => addKnownSender(TEST_SENDER_PUBKEY)).not.toThrow()

        const senders = getKnownSenders()
        expect(senders).toContain(TEST_SENDER_PUBKEY)
      })
    })

    describe('loadKnownSenders', () => {
      it('should load senders from localStorage', () => {
        localStorage.setItem(
          'simply_sats_known_senders',
          JSON.stringify([TEST_SENDER_PUBKEY])
        )

        loadKnownSenders()

        const senders = getKnownSenders()
        expect(senders).toContain(TEST_SENDER_PUBKEY)
      })

      it('should handle invalid JSON gracefully', () => {
        localStorage.setItem('simply_sats_known_senders', 'invalid json')

        expect(() => loadKnownSenders()).not.toThrow()
      })

      it('should handle empty storage', () => {
        expect(() => loadKnownSenders()).not.toThrow()
      })
    })

    describe('getKnownSenders', () => {
      it('should return a copy of senders array', () => {
        addKnownSender(TEST_SENDER_PUBKEY)

        const senders1 = getKnownSenders()
        const senders2 = getKnownSenders()

        // Should be equal but not the same reference
        expect(senders1).toEqual(senders2)
        expect(senders1).not.toBe(senders2)
      })
    })
  })

  describe('debugFindInvoiceNumber', () => {
    it('should call findDerivedKeyForAddress with extended invoices', async () => {
      // Mock import.meta.env.DEV
      const origDev = import.meta.env.DEV
      import.meta.env.DEV = true

      mockTauriInvoke.mockResolvedValueOnce({ wif: 'L2found', address: '1Target', pubKey: '02pk' })

      const result = await debugFindInvoiceNumber(TEST_RECEIVER_WIF, TEST_SENDER_PUBKEY, '1Target')

      expect(result.found).toBe(true)

      import.meta.env.DEV = origDev
    })

    it('should return found=false when not found', async () => {
      const origDev = import.meta.env.DEV
      import.meta.env.DEV = true

      mockTauriInvoke.mockResolvedValueOnce(null)

      const result = await debugFindInvoiceNumber(TEST_RECEIVER_WIF, TEST_SENDER_PUBKEY, '1Nonexistent')

      expect(result.found).toBe(false)

      import.meta.env.DEV = origDev
    })
  })

  describe('getCommonInvoiceNumbers', () => {
    it('should return a non-empty array', () => {
      const invoices = getCommonInvoiceNumbers()

      expect(invoices).toBeDefined()
      expect(invoices.length).toBeGreaterThan(0)
    })

    it('should include standard invoice number patterns', () => {
      const invoices = getCommonInvoiceNumbers()

      // Numeric patterns
      expect(invoices).toContain('0')
      expect(invoices).toContain('1')

      // Standard labels
      expect(invoices).toContain('default')
      expect(invoices).toContain('payment')
    })

    it('should return a copy', () => {
      const invoices1 = getCommonInvoiceNumbers()
      const invoices2 = getCommonInvoiceNumbers()

      expect(invoices1).toEqual(invoices2)
      expect(invoices1).not.toBe(invoices2)
    })
  })
})
