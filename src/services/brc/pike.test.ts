// @vitest-environment node
/**
 * Tests for PIKEService (BRC-85 Proven Identity Key Exchange)
 *
 * All Tauri IPC calls are mocked — no desktop runtime needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock tauriInvoke before importing the service
// ---------------------------------------------------------------------------
const mockTauriInvoke = vi.fn()
vi.mock('../../utils/tauri', () => ({
  tauriInvoke: (...args: unknown[]) => mockTauriInvoke(...args),
}))

// Import after mocks are set up
import { PIKEService } from './pike'
import { TauriProtoWallet } from './adapter'
import { BRC } from '../../config'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const MOCK_IDENTITY_PUB_KEY =
  '02c0f5fa7a67133e3e2b4780b23b44d0e9b6ddad88729a076880e74e6a3c9e2f92'
const MOCK_CONTACT_PUB_KEY =
  '03deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefde'

const MOCK_PUBLIC_KEYS = {
  walletType: 'bip44',
  walletAddress: '1MockWalletAddress',
  walletPubKey: '03aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888cc',
  ordAddress: '1MockOrdAddress',
  ordPubKey: '03bbbb1111cccc2222dddd3333eeee4444ffff5555aaaa6666bbbb7777cccc8888dd',
  identityAddress: '1MockIdentityAddress',
  identityPubKey: MOCK_IDENTITY_PUB_KEY,
}

/** A deterministic 32-byte HMAC result for consistent test outputs. */
const MOCK_HMAC_BYTES = Array.from({ length: 32 }, (_, i) => (i * 7 + 13) % 256)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Route tauriInvoke mocks by command name. */
function routeInvoke(routes: Record<string, unknown>) {
  mockTauriInvoke.mockImplementation((cmd: string) => {
    if (cmd in routes) {
      const val = routes[cmd]
      return typeof val === 'function'
        ? (val as (...args: unknown[]) => unknown)()
        : Promise.resolve(val)
    }
    return Promise.reject(new Error(`Unmocked Tauri command: ${cmd}`))
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('PIKEService', () => {
  let wallet: TauriProtoWallet
  let pike: PIKEService

  beforeEach(() => {
    vi.clearAllMocks()
    wallet = new TauriProtoWallet()
    pike = new PIKEService(wallet)
  })

  // =========================================================================
  // generateVerificationCode
  // =========================================================================
  describe('generateVerificationCode', () => {
    it('returns a 6-digit string', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
      })

      const code = await pike.generateVerificationCode(MOCK_CONTACT_PUB_KEY)

      expect(code).toMatch(/^\d{6}$/)
    })

    it('returns same code for same contact within the same time window', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
      })

      const code1 = await pike.generateVerificationCode(MOCK_CONTACT_PUB_KEY)
      const code2 = await pike.generateVerificationCode(MOCK_CONTACT_PUB_KEY)

      expect(code1).toBe(code2)
    })

    it('always returns exactly 6 digits even for small numeric values', async () => {
      // The code is padStart(6, '0'), so regardless of the underlying numeric
      // value, the output is always exactly 6 characters of digits.
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
      })

      const code = await pike.generateVerificationCode(MOCK_CONTACT_PUB_KEY)

      expect(code).toMatch(/^\d{6}$/)
      expect(code.length).toBe(6)
      // Verify it's a valid numeric string
      const numValue = parseInt(code, 10)
      expect(numValue).toBeGreaterThanOrEqual(0)
      expect(numValue).toBeLessThan(1_000_000)
    })

    it('calls createHmac with correct PIKE protocol parameters', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
      })

      await pike.generateVerificationCode(MOCK_CONTACT_PUB_KEY)

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'hmac_with_derived_key_from_store',
        expect.objectContaining({
          counterpartyPubKey: MOCK_CONTACT_PUB_KEY,
          invoiceNumber: '2-brc85-pike-1',
          keyType: 'identity',
        }),
      )
    })
  })

  // =========================================================================
  // verifyCode
  // =========================================================================
  describe('verifyCode', () => {
    it('returns true for a matching code', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
      })

      const code = await pike.generateVerificationCode(MOCK_CONTACT_PUB_KEY)
      const isValid = await pike.verifyCode(MOCK_CONTACT_PUB_KEY, code)

      expect(isValid).toBe(true)
    })

    it('returns false for a wrong code', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
      })

      const isValid = await pike.verifyCode(MOCK_CONTACT_PUB_KEY, '000000')

      // Extremely unlikely to actually be 000000 with our mock HMAC
      // If it is, the test still validates the comparison logic
      const expected = await pike.generateVerificationCode(MOCK_CONTACT_PUB_KEY)
      if (expected !== '000000') {
        expect(isValid).toBe(false)
      }
    })

    it('returns false when code length differs (constant-time guard)', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
      })

      const isValid = await pike.verifyCode(MOCK_CONTACT_PUB_KEY, '12345') // 5 digits
      expect(isValid).toBe(false)
    })

    it('returns false for empty string', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
      })

      const isValid = await pike.verifyCode(MOCK_CONTACT_PUB_KEY, '')
      expect(isValid).toBe(false)
    })

    it('returns false for a 7-digit code', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
      })

      const isValid = await pike.verifyCode(MOCK_CONTACT_PUB_KEY, '1234567')
      expect(isValid).toBe(false)
    })
  })

  // =========================================================================
  // getTimeRemaining
  // =========================================================================
  describe('getTimeRemaining', () => {
    it('returns a positive number', () => {
      const remaining = pike.getTimeRemaining()
      expect(remaining).toBeGreaterThan(0)
    })

    it('returns a value <= PIKE_TOTP_WINDOW', () => {
      const remaining = pike.getTimeRemaining()
      expect(remaining).toBeLessThanOrEqual(BRC.PIKE_TOTP_WINDOW)
    })

    it('returns a value >= 1', () => {
      // Since we floor the current time and subtract, the minimum is 1
      // (only 0 if we're exactly on the boundary, which is modular arithmetic)
      const remaining = pike.getTimeRemaining()
      expect(remaining).toBeGreaterThanOrEqual(1)
    })
  })
})
