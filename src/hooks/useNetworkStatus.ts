/**
 * Network Status Hook for Simply Sats
 *
 * Fetches and maintains network status including block height,
 * overlay network health, and USD exchange rate.
 */

import { useState, useEffect, useCallback } from 'react'
import { getNetworkStatus } from '../services/brc100'
import { TIMEOUTS } from '../services/config'

export interface NetworkInfo {
  blockHeight: number
  overlayHealthy: boolean
  overlayNodeCount: number
}

export interface UseNetworkStatusResult {
  networkInfo: NetworkInfo | null
  usdPrice: number
  refreshNetworkStatus: () => Promise<void>
}

// Refresh interval (1 minute)
const REFRESH_INTERVAL = 60000

/**
 * Hook for managing network status and exchange rate
 */
export function useNetworkStatus(): UseNetworkStatusResult {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null)
  const [usdPrice, setUsdPrice] = useState<number>(0)

  // Fetch network status
  const fetchNetworkStatus = useCallback(async () => {
    try {
      const status = await getNetworkStatus()
      setNetworkInfo(status)
    } catch (error) {
      console.error('[Network] Failed to fetch network status:', error)
    }
  }, [])

  // Fetch USD price
  const fetchPrice = useCallback(async () => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.price)

      const res = await fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate', {
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      const data = await res.json()
      if (data?.rate) {
        setUsdPrice(data.rate)
      }
    } catch (error) {
      console.error('[Network] Failed to fetch USD price:', error)
    }
  }, [])

  // Initial fetch and interval setup
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial data fetch on mount
    fetchNetworkStatus()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial data fetch on mount
    fetchPrice()

    const networkInterval = setInterval(fetchNetworkStatus, REFRESH_INTERVAL)
    const priceInterval = setInterval(fetchPrice, REFRESH_INTERVAL)

    return () => {
      clearInterval(networkInterval)
      clearInterval(priceInterval)
    }
  }, [fetchNetworkStatus, fetchPrice])

  return {
    networkInfo,
    usdPrice,
    refreshNetworkStatus: fetchNetworkStatus
  }
}
