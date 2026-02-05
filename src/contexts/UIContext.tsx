import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { useNetwork } from './NetworkContext'

interface UIContextType {
  // Display settings
  displayInSats: boolean
  toggleDisplayUnit: () => void

  // Toast/feedback
  copyFeedback: string | null
  copyToClipboard: (text: string, feedback?: string) => Promise<void>
  showToast: (message: string) => void

  // Format helpers
  formatBSVShort: (sats: number) => string
  formatUSD: (sats: number) => string
}

const UIContext = createContext<UIContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useUI() {
  const context = useContext(UIContext)
  if (!context) {
    throw new Error('useUI must be used within a UIProvider')
  }
  return context
}

interface UIProviderProps {
  children: ReactNode
}

export function UIProvider({ children }: UIProviderProps) {
  const { usdPrice } = useNetwork()

  const [displayInSats, setDisplayInSats] = useState<boolean>(() => {
    const saved = localStorage.getItem('simply_sats_display_sats')
    return saved === 'true'
  })

  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)

  const toggleDisplayUnit = useCallback(() => {
    const newValue = !displayInSats
    setDisplayInSats(newValue)
    localStorage.setItem('simply_sats_display_sats', String(newValue))
  }, [displayInSats])

  const copyToClipboard = useCallback(async (text: string, feedback = 'Copied!') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyFeedback(feedback)
      setTimeout(() => setCopyFeedback(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [])

  const showToast = useCallback((message: string) => {
    setCopyFeedback(message)
    setTimeout(() => setCopyFeedback(null), 2000)
  }, [])

  const formatBSVShort = useCallback((sats: number) => {
    const bsv = sats / 100000000
    if (bsv >= 1) return bsv.toFixed(4)
    if (bsv >= 0.01) return bsv.toFixed(6)
    return bsv.toFixed(8)
  }, [])

  const formatUSD = useCallback((sats: number) => {
    return ((sats / 100000000) * usdPrice).toFixed(2)
  }, [usdPrice])

  const value: UIContextType = {
    displayInSats,
    toggleDisplayUnit,
    copyFeedback,
    copyToClipboard,
    showToast,
    formatBSVShort,
    formatUSD
  }

  return (
    <UIContext.Provider value={value}>
      {children}
    </UIContext.Provider>
  )
}
