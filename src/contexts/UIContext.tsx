import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from 'react'
import { useNetwork } from './NetworkContext'
import { uiLogger } from '../services/logger'
import { UI } from '../config'
import { satoshisToBtc } from '../utils/satoshiConversion'
import { STORAGE_KEYS } from '../infrastructure/storage/localStorage'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastItem {
  id: string
  message: string
  type: ToastType
}

type Theme = 'dark' | 'light'

interface UIContextType {
  // Display settings
  displayInSats: boolean
  toggleDisplayUnit: () => void
  theme: Theme
  toggleTheme: () => void

  // Toast/feedback
  toasts: ToastItem[]
  copyFeedback: string | null // backward compat — returns latest toast message
  copyToClipboard: (text: string, feedback?: string) => Promise<void>
  showToast: (message: string, type?: ToastType) => void
  dismissToast: (id: string) => void

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

/**
 * Provides UI state: display units, toasts, clipboard, theme, and BSV/USD formatters.
 *
 * @requires NetworkProvider — must be an ancestor in the React tree.
 *   UIProvider calls useNetwork() internally for USD price formatting.
 */
export function UIProvider({ children }: UIProviderProps) {
  const { usdPrice } = useNetwork()

  const [displayInSats, setDisplayInSats] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.DISPLAY_SATS)
    return saved !== null ? saved === 'true' : true
  })

  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.THEME)
    return (saved === 'light' || saved === 'dark') ? saved : 'dark'
  })

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const newTheme: Theme = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem(STORAGE_KEYS.THEME, newTheme)
      return newTheme
    })
  }, [])

  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  // Clear all pending toast timeouts on unmount
  useEffect(() => {
    const timeouts = toastTimeoutsRef.current
    return () => {
      timeouts.forEach(id => clearTimeout(id))
      timeouts.clear()
    }
  }, [])

  // Backward compat: expose latest toast message as copyFeedback
  const copyFeedback = toasts.length > 0 ? toasts[toasts.length - 1]!.message : null

  const toggleDisplayUnit = useCallback(() => {
    setDisplayInSats(prev => {
      const newValue = !prev
      localStorage.setItem(STORAGE_KEYS.DISPLAY_SATS, String(newValue))
      return newValue
    })
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    // Limit toast stack to 5 to prevent flooding
    setToasts(prev => [...prev.slice(-4), { id, message, type }])
    // Errors and warnings persist longer (6s) so users can read them
    const duration = (type === 'error' || type === 'warning') ? 6000 : UI.TOAST_DURATION_MS
    const timeoutId = setTimeout(() => {
      toastTimeoutsRef.current.delete(timeoutId)
      setToasts(prev => prev.filter(t => t.id !== id))
    }, duration)
    toastTimeoutsRef.current.add(timeoutId)
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
    const bsv = satoshisToBtc(sats)
    if (bsv >= 1) return bsv.toFixed(4)
    if (bsv >= 0.01) return bsv.toFixed(6)
    return bsv.toFixed(8)
  }, [])

  const formatUSD = useCallback((sats: number) => {
    return (satoshisToBtc(sats) * usdPrice).toFixed(2)
  }, [usdPrice])

  const value: UIContextType = useMemo(() => ({
    displayInSats,
    toggleDisplayUnit,
    theme,
    toggleTheme,
    toasts,
    copyFeedback,
    copyToClipboard,
    showToast,
    dismissToast,
    formatBSVShort,
    formatUSD
  }), [displayInSats, toggleDisplayUnit, theme, toggleTheme, toasts, copyFeedback, copyToClipboard, showToast, dismissToast, formatBSVShort, formatUSD])

  return (
    <UIContext.Provider value={value}>
      {children}
    </UIContext.Provider>
  )
}
