import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { getNetworkStatus } from '../services/brc100'

export interface NetworkInfo {
  blockHeight: number
  overlayHealthy: boolean
  overlayNodeCount: number
}

interface NetworkContextType {
  networkInfo: NetworkInfo | null
  syncing: boolean
  setSyncing: (syncing: boolean) => void
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
  const [usdPrice, setUsdPrice] = useState<number>(0)

  // Fetch network status periodically
  useEffect(() => {
    const fetchNetworkStatus = async () => {
      try {
        const status = await getNetworkStatus()
        setNetworkInfo(status)
      } catch (error) {
        console.error('Failed to fetch network status:', error)
      }
    }
    fetchNetworkStatus()
    const interval = setInterval(fetchNetworkStatus, 60000)
    return () => clearInterval(interval)
  }, [])

  // Fetch USD price periodically
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate')
        const data = await res.json()
        if (data?.rate) {
          setUsdPrice(data.rate)
        }
      } catch (e) {
        console.error('Failed to fetch USD price:', e)
      }
    }
    fetchPrice()
    const interval = setInterval(fetchPrice, 60000)
    return () => clearInterval(interval)
  }, [])

  const value: NetworkContextType = {
    networkInfo,
    syncing,
    setSyncing,
    usdPrice
  }

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  )
}
