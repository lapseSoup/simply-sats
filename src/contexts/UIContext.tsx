import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import { useNetwork } from './NetworkContext'
import { uiLogger } from '../services/logger'
import { UI } from '../config'

interface ToastItem {
  id: string
  message: string
}

interface UIContextType {
  // Display settings
  displayInSats: boolean
  toggleDisplayUnit: () => void

  // Toast/feedback
  toasts: ToastItem[]
  copyFeedback: string | null // backward compat — returns latest toast message
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
    return saved !== null ? saved === 'true' : true
  })

  const [toasts, setToasts] = useState<ToastItem[]>([])

  // Backward compat: expose latest toast message as copyFeedback
  const copyFeedback = toasts.length > 0 ? toasts[toasts.length - 1]!.message : null

  const toggleDisplayUnit = useCallback(() => {
    const newValue = !displayInSats
    setDisplayInSats(newValue)
    localStorage.setItem('simply_sats_display_sats', String(newValue))
  }, [displayInSats])

  const showToast = useCallback((message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setToasts(prev => [...prev, { id, message }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, UI.TOAST_DURATION_MS)
  }, [])

  const copyToClipboard = useCallback(async (text: string, feedback = 'Copied!') => {
    try {
      await navigator.clipboard.writeText(text)
      showToast(feedback)
    } catch (err) {
      uiLogger.error('Failed to copy', err)
    }
  }, [showToast])

  const formatBSVShort = useCallback((sats: number) => {
    const bsv = sats / 100000000
    if (bsv >= 1) return bsv.toFixed(4)
    if (bsv >= 0.01) return bsv.toFixed(6)
    return bsv.toFixed(8)
  }, [])

  const formatUSD = useCallback((sats: number) => {
    return ((sats / 100000000) * usdPrice).toFixed(2)
  }, [usdPrice])

  const value: UIContextType = useMemo(() => ({
    displayInSats,
    toggleDisplayUnit,
    toasts,
    copyFeedback,
    copyToClipboard,
    showToast,
    formatBSVShort,
    formatUSD
  }), [displayInSats, toggleDisplayUnit, toasts, copyFeedback, copyToClipboard, showToast, formatBSVShort, formatUSD])

  return (
    <UIContext.Provider value={value}>
      {children}
    </UIContext.Provider>
  )
}
