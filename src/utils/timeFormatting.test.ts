import { describe, it, expect } from 'vitest'
import { formatTimeRemaining, AVERAGE_BLOCK_TIME_SECONDS } from './timeFormatting'

describe('formatTimeRemaining', () => {
  describe('zero and negative seconds', () => {
    it('returns "Ready!" for zero seconds', () => {
      expect(formatTimeRemaining(0)).toBe('Ready!')
    })

    it('returns "Ready!" for negative seconds', () => {
      expect(formatTimeRemaining(-1)).toBe('Ready!')
      expect(formatTimeRemaining(-3600)).toBe('Ready!')
    })
  })

  describe('sub-minute values', () => {
    it('returns "<1m" for 1 second', () => {
      expect(formatTimeRemaining(1)).toBe('<1m')
    })

    it('returns "<1m" for 30 seconds', () => {
      expect(formatTimeRemaining(30)).toBe('<1m')
    })

    it('returns "<1m" for 59 seconds', () => {
      expect(formatTimeRemaining(59)).toBe('<1m')
    })
  })

  describe('minute values', () => {
    it('formats exactly 1 minute', () => {
      expect(formatTimeRemaining(60)).toBe('~1m')
    })

    it('formats multiple minutes', () => {
      expect(formatTimeRemaining(300)).toBe('~5m')
    })

    it('formats 59 minutes', () => {
      expect(formatTimeRemaining(3599)).toBe('~59m')
    })

    it('drops leftover seconds (floors to minutes)', () => {
      // 2 minutes 45 seconds -> ~2m (seconds are not shown)
      expect(formatTimeRemaining(165)).toBe('~2m')
    })
  })

  describe('hour values', () => {
    it('formats exactly 1 hour', () => {
      expect(formatTimeRemaining(3600)).toBe('~1h 0m')
    })

    it('formats hours with minutes', () => {
      // 1 hour 30 minutes = 5400 seconds
      expect(formatTimeRemaining(5400)).toBe('~1h 30m')
    })

    it('formats multiple hours', () => {
      // 5 hours = 18000 seconds
      expect(formatTimeRemaining(18000)).toBe('~5h 0m')
    })

    it('formats 23 hours 59 minutes', () => {
      // 23h 59m = 86340 seconds
      expect(formatTimeRemaining(86340)).toBe('~23h 59m')
    })
  })

  describe('day values', () => {
    it('formats exactly 1 day', () => {
      expect(formatTimeRemaining(86400)).toBe('~1d 0h')
    })

    it('formats days with hours', () => {
      // 1 day 5 hours = 86400 + 18000 = 104400 seconds
      expect(formatTimeRemaining(104400)).toBe('~1d 5h')
    })

    it('formats 6 days as days+hours (below week threshold)', () => {
      // 6 days = 518400 seconds (still below 7-day week threshold)
      expect(formatTimeRemaining(518400)).toBe('~6d 0h')
    })

    it('shows days and hours but drops minutes', () => {
      // 2 days 3 hours 45 minutes = 2*86400 + 3*3600 + 45*60 = 185100
      // Should show ~2d 3h (minutes dropped when days > 0)
      expect(formatTimeRemaining(185100)).toBe('~2d 3h')
    })
  })

  describe('week values (7-29 days)', () => {
    it('formats exactly 1 week', () => {
      // 7 days = 604800 seconds
      expect(formatTimeRemaining(604800)).toBe('~1 week')
    })

    it('formats multiple weeks', () => {
      // 14 days = 1209600 seconds
      expect(formatTimeRemaining(1209600)).toBe('~2 weeks')
    })

    it('formats 3 weeks', () => {
      // 21 days = 1814400 seconds
      expect(formatTimeRemaining(1814400)).toBe('~3 weeks')
    })

    it('formats 4 weeks (28 days, still below month threshold)', () => {
      // 28 days = 2419200 seconds
      expect(formatTimeRemaining(2419200)).toBe('~4 weeks')
    })

    it('floors partial weeks (10 days = 1 week)', () => {
      // 10 days = 864000 seconds, floor(10/7) = 1
      expect(formatTimeRemaining(864000)).toBe('~1 week')
    })
  })

  describe('month values (30+ days)', () => {
    it('formats exactly 1 month (30 days)', () => {
      expect(formatTimeRemaining(2592000)).toBe('~1 month')
    })

    it('formats multiple months', () => {
      // 60 days = 5184000 seconds
      expect(formatTimeRemaining(5184000)).toBe('~2 months')
    })

    it('formats 12 months (365 days)', () => {
      // 365 days = 31536000 seconds, floor(365/30) = 12
      expect(formatTimeRemaining(31536000)).toBe('~12 months')
    })

    it('uses singular "month" for 1', () => {
      expect(formatTimeRemaining(2592000)).toBe('~1 month')
    })

    it('uses plural "months" for > 1', () => {
      expect(formatTimeRemaining(5184000)).toBe('~2 months')
    })
  })

  describe('mixed values', () => {
    it('formats 1 day 12 hours', () => {
      expect(formatTimeRemaining(129600)).toBe('~1d 12h')
    })

    it('formats 2 hours 15 minutes', () => {
      // 2h 15m = 8100 seconds
      expect(formatTimeRemaining(8100)).toBe('~2h 15m')
    })
  })

  describe('AVERAGE_BLOCK_TIME_SECONDS constant', () => {
    it('is 600 seconds (10 minutes)', () => {
      expect(AVERAGE_BLOCK_TIME_SECONDS).toBe(600)
    })

    it('formats one block time as ~10m', () => {
      expect(formatTimeRemaining(AVERAGE_BLOCK_TIME_SECONDS)).toBe('~10m')
    })

    it('formats 6 blocks (1 hour) correctly', () => {
      expect(formatTimeRemaining(AVERAGE_BLOCK_TIME_SECONDS * 6)).toBe('~1h 0m')
    })

    it('formats 144 blocks (1 day) correctly', () => {
      expect(formatTimeRemaining(AVERAGE_BLOCK_TIME_SECONDS * 144)).toBe('~1d 0h')
    })
  })
})
