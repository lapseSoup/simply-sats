/**
 * Fee calculation and management
 * Handles fee rates, calculation, and caching
 */

import type { UTXO } from './types'
import {
  calculateTxFee as domainCalculateTxFee,
  calculateLockFee as domainCalculateLockFee,
  calculateMaxSend as domainCalculateMaxSend,
  calculateExactFee as domainCalculateExactFee,
  feeFromBytes as domainFeeFromBytes,
  DEFAULT_FEE_RATE as DOMAIN_DEFAULT_FEE_RATE,
  MIN_FEE_RATE,
  MAX_FEE_RATE
} from '../../domain/transaction/fees'
import { walletLogger } from '../logger'

// Default fee rate - re-exported from domain layer
const DEFAULT_FEE_RATE = DOMAIN_DEFAULT_FEE_RATE

// Cache for dynamic fee rate
let cachedFeeRate: { rate: number; timestamp: number } | null = null
const FEE_RATE_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Fetch current recommended fee rate from the network
 * Uses GorillaPool's fee quote endpoint
 */
export async function fetchDynamicFeeRate(): Promise<number> {
  // Check cache first
  if (cachedFeeRate && Date.now() - cachedFeeRate.timestamp < FEE_RATE_CACHE_TTL) {
    return cachedFeeRate.rate
  }

  try {
    // GorillaPool mAPI returns fee policies
    const response = await fetch('https://mapi.gorillapool.io/mapi/feeQuote', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })

    if (response.ok) {
      const result = await response.json()
      const payload = typeof result.payload === 'string'
        ? JSON.parse(result.payload)
        : result.payload

      if (payload?.fees) {
        // Extract standard fee for data transactions
        const standardFee = payload.fees.find((f: { feeType: string }) => f.feeType === 'standard')
        if (standardFee?.miningFee) {
          // Convert from satoshis/byte
          const ratePerByte = standardFee.miningFee.satoshis / standardFee.miningFee.bytes
          const clampedRate = Math.max(MIN_FEE_RATE, Math.min(MAX_FEE_RATE, ratePerByte))

          // Cache the result
          cachedFeeRate = { rate: clampedRate, timestamp: Date.now() }
          walletLogger.debug('Fetched dynamic fee rate', { rate: clampedRate })
          return clampedRate
        }
      }
    }
  } catch {
    walletLogger.warn('Failed to fetch dynamic fee rate, using default')
  }

  // Fallback to default
  return DEFAULT_FEE_RATE
}

/**
 * Get the current fee rate
 * Prefers user-set rate, then cached dynamic rate, then default
 */
export function getFeeRate(): number {
  // Check for user override first
  const stored = localStorage.getItem('simply_sats_fee_rate')
  if (stored) {
    const rate = parseFloat(stored)
    if (!isNaN(rate) && rate > 0) return rate
  }

  // Use cached dynamic rate if available
  if (cachedFeeRate && Date.now() - cachedFeeRate.timestamp < FEE_RATE_CACHE_TTL) {
    return cachedFeeRate.rate
  }

  return DEFAULT_FEE_RATE
}

/**
 * Get fee rate with optional async fetch of dynamic rate
 */
export async function getFeeRateAsync(): Promise<number> {
  // Check for user override first
  const stored = localStorage.getItem('simply_sats_fee_rate')
  if (stored) {
    const rate = parseFloat(stored)
    if (!isNaN(rate) && rate > 0) return rate
  }

  // Fetch dynamic rate
  return fetchDynamicFeeRate()
}

/**
 * Set the fee rate (in sats/byte)
 */
export function setFeeRate(rate: number): void {
  localStorage.setItem('simply_sats_fee_rate', String(rate))
}

/**
 * Clear user fee rate override (use dynamic rate)
 */
export function clearFeeRateOverride(): void {
  localStorage.removeItem('simply_sats_fee_rate')
}

/**
 * Get fee rate in sats/KB for display
 */
export function getFeeRatePerKB(): number {
  return Math.round(getFeeRate() * 1000)
}

/**
 * Set fee rate from sats/KB input
 */
export function setFeeRateFromKB(ratePerKB: number): void {
  setFeeRate(ratePerKB / 1000)
}

/**
 * Calculate fee from exact byte size - delegates to domain layer
 */
export function feeFromBytes(bytes: number, customFeeRate?: number): number {
  const rate = customFeeRate ?? getFeeRate()
  return domainFeeFromBytes(bytes, rate)
}

/**
 * Calculate transaction fee for standard P2PKH inputs/outputs - delegates to domain layer
 */
export function calculateTxFee(numInputs: number, numOutputs: number, extraBytes = 0): number {
  return domainCalculateTxFee(numInputs, numOutputs, getFeeRate(), extraBytes)
}

/**
 * Calculate the exact fee for a lock transaction using actual script size - delegates to domain layer
 */
export function calculateLockFee(numInputs: number, timelockScriptSize?: number): number {
  return domainCalculateLockFee(numInputs, getFeeRate(), timelockScriptSize)
}

/**
 * Calculate max sendable amount given UTXOs - delegates to domain layer
 */
export function calculateMaxSend(utxos: UTXO[]): { maxSats: number; fee: number; numInputs: number } {
  return domainCalculateMaxSend(utxos, getFeeRate())
}

/**
 * Calculate exact fee by selecting UTXOs for a given amount - delegates to domain layer
 */
export function calculateExactFee(
  satoshis: number,
  utxos: UTXO[]
): { fee: number; inputCount: number; outputCount: number; totalInput: number; canSend: boolean } {
  return domainCalculateExactFee(satoshis, utxos, getFeeRate())
}
