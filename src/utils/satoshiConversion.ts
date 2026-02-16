/**
 * Safe satoshi/BSV conversion utilities.
 *
 * Uses Math.round to avoid floating-point precision errors
 * (e.g., 0.1 + 0.2 !== 0.3 in IEEE 754).
 */

const SATS_PER_BSV = 100_000_000

/** Convert BSV amount to satoshis with safe rounding */
export function btcToSatoshis(btc: number): number {
  if (!Number.isFinite(btc) || btc < 0) return 0
  return Math.round(btc * SATS_PER_BSV)
}

/** Convert satoshis to BSV for display */
export function satoshisToBtc(sats: number): number {
  return sats / SATS_PER_BSV
}
