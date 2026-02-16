/**
 * Fee Rate Service
 * Fetches dynamic fee rates from mAPI and manages user overrides
 */

import {
  DEFAULT_FEE_RATE,
  clampFeeRate
} from '../../domain/transaction/fees'
import { STORAGE_KEYS } from '../storage/localStorage'

const STORAGE_KEY = STORAGE_KEYS.FEE_RATE
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export interface FeeService {
  fetchDynamicFeeRate(): Promise<number>
  getFeeRate(): number
  getFeeRateAsync(): Promise<number>
  setFeeRate(rate: number): void
  clearFeeRateOverride(): void
}

export interface FeeServiceConfig {
  mapiUrl: string
  timeout: number
}

const DEFAULT_CONFIG: FeeServiceConfig = {
  mapiUrl: 'https://mapi.gorillapool.io/mapi/feeQuote',
  timeout: 10000
}

interface FeePayload {
  fees?: Array<{
    feeType: string
    miningFee?: {
      satoshis: number
      bytes: number
    }
  }>
}

/**
 * Create a fee rate service
 */
export function createFeeService(config: Partial<FeeServiceConfig> = {}): FeeService {
  const cfg: FeeServiceConfig = { ...DEFAULT_CONFIG, ...config }

  // Internal cache
  let cachedRate: { rate: number; timestamp: number } | null = null

  return {
    async fetchDynamicFeeRate(): Promise<number> {
      // Check cache first
      if (cachedRate && Date.now() - cachedRate.timestamp < CACHE_TTL_MS) {
        return cachedRate.rate
      }

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), cfg.timeout)

        const response = await fetch(cfg.mapiUrl, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (response.ok) {
          const result = await response.json()
          const payload: FeePayload = typeof result.payload === 'string'
            ? JSON.parse(result.payload)
            : result.payload

          if (payload?.fees && Array.isArray(payload.fees)) {
            const standardFee = payload.fees.find(f => f.feeType === 'standard')
            if (standardFee?.miningFee &&
                typeof standardFee.miningFee.satoshis === 'number' &&
                typeof standardFee.miningFee.bytes === 'number' &&
                Number.isFinite(standardFee.miningFee.satoshis) &&
                Number.isFinite(standardFee.miningFee.bytes) &&
                standardFee.miningFee.bytes > 0 &&
                standardFee.miningFee.satoshis >= 0) {
              const ratePerByte = standardFee.miningFee.satoshis / standardFee.miningFee.bytes
              const clampedRate = clampFeeRate(ratePerByte)

              // Cache the result
              cachedRate = { rate: clampedRate, timestamp: Date.now() }
              return clampedRate
            }
          }
        }
      } catch {
        // Fall through to default
      }

      return DEFAULT_FEE_RATE
    },

    getFeeRate(): number {
      // Check for user override first
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const rate = parseFloat(stored)
        if (!isNaN(rate) && rate > 0) {
          return rate
        }
      }

      // Use cached dynamic rate if available
      if (cachedRate && Date.now() - cachedRate.timestamp < CACHE_TTL_MS) {
        return cachedRate.rate
      }

      return DEFAULT_FEE_RATE
    },

    async getFeeRateAsync(): Promise<number> {
      // Check for user override first
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const rate = parseFloat(stored)
        if (!isNaN(rate) && rate > 0) {
          return rate
        }
      }

      // Fetch dynamic rate
      return this.fetchDynamicFeeRate()
    },

    setFeeRate(rate: number): void {
      localStorage.setItem(STORAGE_KEY, String(rate))
    },

    clearFeeRateOverride(): void {
      localStorage.removeItem(STORAGE_KEY)
    }
  }
}

// Default service instance
let defaultService: FeeService | null = null

/**
 * Get/create singleton default fee service
 */
export function getFeeService(): FeeService {
  if (!defaultService) {
    defaultService = createFeeService()
  }
  return defaultService
}
