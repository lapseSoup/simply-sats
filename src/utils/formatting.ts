import { satoshisToBtc } from './satoshiConversion'

const ONE_BSV = 100_000_000

/**
 * Format satoshis for human display with unit suffix.
 *
 * - 'auto': shows BSV (8 decimals) for amounts >= 1 BSV, sats with locale formatting otherwise
 * - 'short': like auto but with variable precision for BSV amounts (4/6/8 decimals)
 */
export function formatSatoshis(sats: number, mode: 'auto' | 'short' = 'auto'): string {
  const absSats = Math.abs(sats)
  if (absSats >= ONE_BSV) {
    const sign = sats < 0 ? '-' : ''
    const bsv = satoshisToBtc(absSats)
    if (mode === 'short') {
      if (bsv >= 1) return `${sign}${bsv.toFixed(4)} BSV`
      if (bsv >= 0.01) return `${sign}${bsv.toFixed(6)} BSV`
      return `${sign}${bsv.toFixed(8)} BSV`
    }
    return `${sign}${bsv.toFixed(8)} BSV`
  }
  return `${sats.toLocaleString()} sats`
}
