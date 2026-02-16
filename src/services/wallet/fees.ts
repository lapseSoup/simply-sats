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
import { gpMapiApi } from '../../infrastructure/api/clients'

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
    const result = await gpMapiApi.get<{ payload: string | { fees?: Array<{ feeType: string; miningFee?: { satoshis: number; bytes: number } }> } }>('/mapi/feeQuote')

    if (result.ok) {
      const payload = typeof result.value.payload === 'string'
        ? JSON.parse(result.value.payload)
        : result.value.payload

      if (payload?.fees && Array.isArray(payload.fees)) {
        // Extract standard fee for data transactions
        const standardFee = payload.fees.find((f: { feeType: string }) => f.feeType === 'standard')
        if (standardFee?.miningFee &&
            typeof standardFee.miningFee.satoshis === 'number' &&
            typeof standardFee.miningFee.bytes === 'number' &&
            Number.isFinite(standardFee.miningFee.satoshis) &&
            Number.isFinite(standardFee.miningFee.bytes) &&
            standardFee.miningFee.bytes > 0 &&
            standardFee.miningFee.satoshis >= 0) {
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
 * Always clamped to [MIN_FEE_RATE, MAX_FEE_RATE] for safety
 */
export function getFeeRate(): number {
  // Check for user override first
  const stored = localStorage.getItem('simply_sats_fee_rate')
  if (stored) {
    const rate = parseFloat(stored)
    if (!isNaN(rate) && rate > 0) {
      return Math.max(MIN_FEE_RATE, Math.min(MAX_FEE_RATE, rate))
    }
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
    if (!isNaN(rate) && rate > 0) return Math.max(MIN_FEE_RATE, Math.min(MAX_FEE_RATE, rate))
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
