import { createContext, useContext, useState, useEffect, useRef, useMemo, type ReactNode } from 'react'
import { getNetworkStatus } from '../services/brc100'
import { apiLogger } from '../services/logger'
import { NETWORK } from '../config'

export interface NetworkInfo {
  blockHeight: number
  overlayHealthy: boolean
  overlayNodeCount: number
}

export type SyncPhase = 'syncing' | 'loading' | null

interface NetworkContextType {
  networkInfo: NetworkInfo | null
  syncing: boolean
  setSyncing: (syncing: boolean) => void
  syncPhase: SyncPhase
  setSyncPhase: (phase: SyncPhase) => void
  usdPrice: number
}

const NetworkContext = createContext<NetworkContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useNetwork() {
  const context = useContext(NetworkContext)
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider')
  }
  return context
}

interface NetworkProviderProps {
  children: ReactNode
}

export function NetworkProvider({ children }: NetworkProviderProps) {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncPhase, setSyncPhase] = useState<SyncPhase>(null)
  const [usdPrice, setUsdPrice] = useState<number>(0)

  // Track consecutive failures for exponential backoff
  const networkFailuresRef = useRef(0)
  const priceFailuresRef = useRef(0)

  // Fetch network status with exponential backoff on failure
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>
    let cancelled = false

    const scheduleNext = (failures: number) => {
      // Base: 60s, backoff: 60s * 2^failures, max: 10min
      const delay = Math.min(60000 * Math.pow(2, failures), 600000)
      timeoutId = setTimeout(fetchNetworkStatus, delay)
    }

    async function fetchNetworkStatus() {
      if (cancelled) return
      try {
        const status = await getNetworkStatus()
        if (!cancelled) {
          setNetworkInfo(status)
          networkFailuresRef.current = 0
          scheduleNext(0)
        }
      } catch (error) {
        apiLogger.error('Failed to fetch network status', error)
        if (!cancelled) {
          networkFailuresRef.current = Math.min(networkFailuresRef.current + 1, 5)
          scheduleNext(networkFailuresRef.current)
        }
      }
    }

    fetchNetworkStatus()
    return () => { cancelled = true; clearTimeout(timeoutId) }
  }, [])

  // Fetch USD price with exponential backoff on failure
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>
    let cancelled = false

    const scheduleNext = (failures: number) => {
      const delay = Math.min(60000 * Math.pow(2, failures), 600000)
      timeoutId = setTimeout(fetchPrice, delay)
    }

    async function fetchPrice() {
      if (cancelled) return
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), NETWORK.HTTP_TIMEOUT_MS)
        const res = await fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate', { signal: controller.signal })
        clearTimeout(timeout)
        const data = await res.json()
        if (!cancelled && data?.rate && typeof data.rate === 'number' && Number.isFinite(data.rate) && data.rate > 0) {
          setUsdPrice(data.rate)
          priceFailuresRef.current = 0
        }
        if (!cancelled) scheduleNext(0)
      } catch (e) {
        apiLogger.error('Failed to fetch USD price', e)
        if (!cancelled) {
          priceFailuresRef.current = Math.min(priceFailuresRef.current + 1, 5)
          scheduleNext(priceFailuresRef.current)
        }
      }
    }

    fetchPrice()
    return () => { cancelled = true; clearTimeout(timeoutId) }
  }, [])

  // Memoize context value to prevent unnecessary re-renders (B8)
  const value: NetworkContextType = useMemo(() => ({
    networkInfo,
    syncing,
    setSyncing,
    syncPhase,
    setSyncPhase,
    usdPrice
  }), [networkInfo, syncing, syncPhase, usdPrice])

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  )
}
