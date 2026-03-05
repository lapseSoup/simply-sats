import { describe, it, expect } from 'vitest'
import { formatSatoshis } from './formatting'

describe('formatSatoshis', () => {
  describe('auto mode (default)', () => {
    it('formats zero sats', () => {
      expect(formatSatoshis(0)).toBe('0 sats')
    })

    it('formats small positive amounts under 1 BSV as sats', () => {
      expect(formatSatoshis(1)).toBe('1 sats')
      expect(formatSatoshis(500)).toBe('500 sats')
      expect(formatSatoshis(99_999_999)).toBe('99,999,999 sats')
    })

    it('formats exactly 1 BSV', () => {
      expect(formatSatoshis(100_000_000)).toBe('1.00000000 BSV')
    })

    it('formats large multi-BSV amounts', () => {
      expect(formatSatoshis(250_000_000)).toBe('2.50000000 BSV')
      expect(formatSatoshis(1_000_000_000)).toBe('10.00000000 BSV')
      expect(formatSatoshis(2_100_000_000_000_000)).toBe('21000000.00000000 BSV')
    })

    it('formats negative amounts under 1 BSV as sats with locale formatting', () => {
      // Negative amounts below ONE_BSV threshold use toLocaleString directly
      expect(formatSatoshis(-500)).toBe('-500 sats')
      expect(formatSatoshis(-99_999_999)).toBe('-99,999,999 sats')
    })

    it('formats negative amounts at or above 1 BSV with sign prefix', () => {
      expect(formatSatoshis(-100_000_000)).toBe('-1.00000000 BSV')
      expect(formatSatoshis(-250_000_000)).toBe('-2.50000000 BSV')
    })

    it('always shows 8 decimal places for BSV amounts', () => {
      const result = formatSatoshis(100_000_001)
      expect(result).toBe('1.00000001 BSV')
      // Verify exactly 8 decimal digits
      const decimals = result.split('.')[1].replace(' BSV', '')
      expect(decimals).toHaveLength(8)
    })
  })

  describe('short mode', () => {
    it('formats amounts under 1 BSV as sats (same as auto)', () => {
      expect(formatSatoshis(500, 'short')).toBe('500 sats')
      expect(formatSatoshis(0, 'short')).toBe('0 sats')
    })

    it('uses 4 decimal places for amounts >= 1 BSV', () => {
      expect(formatSatoshis(100_000_000, 'short')).toBe('1.0000 BSV')
      expect(formatSatoshis(350_000_000, 'short')).toBe('3.5000 BSV')
    })

    it('always hits the 4-decimal branch since absSats >= ONE_BSV means bsv >= 1.0', () => {
      // The 6-decimal and 8-decimal branches in short mode are unreachable
      // because absSats >= ONE_BSV guarantees bsv >= 1.0, so the first
      // check (bsv >= 1) always matches.
      expect(formatSatoshis(100_000_000, 'short')).toBe('1.0000 BSV')
      // 999_999_999 sats = 9.99999999 BSV, toFixed(4) rounds to 10.0000
      expect(formatSatoshis(999_999_999, 'short')).toBe('10.0000 BSV')
      expect(formatSatoshis(150_000_000, 'short')).toBe('1.5000 BSV')
    })

    it('formats negative BSV amounts in short mode', () => {
      expect(formatSatoshis(-200_000_000, 'short')).toBe('-2.0000 BSV')
    })
  })

  describe('edge cases', () => {
    it('handles NaN by showing as sats (NaN < ONE_BSV)', () => {
      const result = formatSatoshis(NaN)
      expect(result).toBe('NaN sats')
    })

    it('handles very large numbers', () => {
      // 21 million BSV in sats (max supply)
      const maxSupply = 21_000_000 * 100_000_000
      const result = formatSatoshis(maxSupply)
      expect(result).toContain('BSV')
      expect(result).toContain('21000000')
    })

    it('handles 1 sat (smallest unit)', () => {
      expect(formatSatoshis(1)).toBe('1 sats')
    })

    it('handles boundary at exactly ONE_BSV - 1', () => {
      expect(formatSatoshis(99_999_999)).toBe('99,999,999 sats')
    })

    it('handles boundary at exactly ONE_BSV', () => {
      expect(formatSatoshis(100_000_000)).toBe('1.00000000 BSV')
    })

    it('handles fractional satoshi values', () => {
      // While sats should be integers, test that non-integer input doesn't crash
      const result = formatSatoshis(1.5)
      expect(result).toBe('1.5 sats')
    })
  })
})
