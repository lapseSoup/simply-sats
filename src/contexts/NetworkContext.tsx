import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from 'react'
import { getNetworkStatus } from '../services/brc100'
import { apiLogger } from '../services/logger'
import { NETWORK } from '../config'

export interface NetworkInfo {
  blockHeight: number
  overlayHealthy: boolean
  overlayNodeCount: number
}

export type SyncPhase = 'syncing' | 'loading' | null

// ---- NetworkInfoContext (rarely changes: networkInfo, usdPrice) ----

interface NetworkInfoContextType {
  networkInfo: NetworkInfo | null
  usdPrice: number
}

const NetworkInfoContext = createContext<NetworkInfoContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useNetworkInfo() {
  const context = useContext(NetworkInfoContext)
  if (!context) {
    throw new Error('useNetworkInfo must be used within a NetworkProvider')
  }
  return context
}

// ---- SyncStatusContext (changes frequently: syncing, syncPhase) ----

interface SyncStatusContextType {
  syncing: boolean
  setSyncing: (syncing: boolean) => void
  syncPhase: SyncPhase
  setSyncPhase: (phase: SyncPhase) => void
}

const SyncStatusContext = createContext<SyncStatusContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useSyncStatus() {
  const context = useContext(SyncStatusContext)
  if (!context) {
    throw new Error('useSyncStatus must be used within a NetworkProvider')
  }
  return context
}

// ---- Combined hook for backward compatibility ----

// eslint-disable-next-line react-refresh/only-export-components
export function useNetwork() {
  const info = useNetworkInfo()
  const sync = useSyncStatus()
  return useMemo(() => ({ ...info, ...sync }), [info, sync])
}

// ---- Inner SyncStatusProvider (keeps its own state) ----

function SyncStatusProvider({ children }: { children: ReactNode }) {
  const [syncing, setSyncingState] = useState(false)
  const [syncPhase, setSyncPhaseState] = useState<SyncPhase>(null)

  const setSyncing = useCallback((s: boolean) => { setSyncingState(s) }, [])
  const setSyncPhase = useCallback((p: SyncPhase) => { setSyncPhaseState(p) }, [])

  const value: SyncStatusContextType = useMemo(() => ({
    syncing,
    setSyncing,
    syncPhase,
    setSyncPhase,
  }), [syncing, setSyncing, syncPhase, setSyncPhase])

  return (
    <SyncStatusContext.Provider value={value}>
      {children}
    </SyncStatusContext.Provider>
  )
}

// ---- NetworkProvider (renders both inner providers) ----

interface NetworkProviderProps {
  children: ReactNode
}

export function NetworkProvider({ children }: NetworkProviderProps) {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null)
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
          if (!cancelled) scheduleNext(0)
        } else if (!cancelled) {
          // B-82: Malformed response — back off instead of resetting to minimum delay
          priceFailuresRef.current = Math.min(priceFailuresRef.current + 1, 5)
          scheduleNext(priceFailuresRef.current)
        }
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

  // NetworkInfoContext value (rarely changes)
  const infoValue: NetworkInfoContextType = useMemo(() => ({
    networkInfo,
    usdPrice
  }), [networkInfo, usdPrice])

  return (
    <NetworkInfoContext.Provider value={infoValue}>
      <SyncStatusProvider>
        {children}
      </SyncStatusProvider>
    </NetworkInfoContext.Provider>
  )
}
