import { satoshisToBtc } from './satoshiConversion'

const ONE_BSV = 100_000_000

/**
 * Format satoshis for human display with unit suffix.
 *
 * - 'auto': shows BSV (8 decimals) for amounts >= 1 BSV, sats with locale formatting otherwise
 * - 'short': like auto but with variable precision for BSV amounts (4/6/8 decimals)
 */
export function formatSatoshis(sats: number, mode: 'auto' | 'short' = 'auto'): string {
  if (sats >= ONE_BSV) {
    const bsv = satoshisToBtc(sats)
    if (mode === 'short') {
      if (bsv >= 1) return `${bsv.toFixed(4)} BSV`
      if (bsv >= 0.01) return `${bsv.toFixed(6)} BSV`
      return `${bsv.toFixed(8)} BSV`
    }
    return `${bsv.toFixed(8)} BSV`
  }
  return `${sats.toLocaleString()} sats`
}
