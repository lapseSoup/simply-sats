/**
 * Connected Apps Context
 *
 * Manages trusted origins and connected applications.
 * Extracted from WalletContext for better separation of concerns.
 *
 * @module contexts/ConnectedAppsContext
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { isValidOrigin, normalizeOrigin, validateOriginWithReason } from '../utils/validation'
import { secureGetJSON, secureSetJSON, migrateToSecureStorage } from '../services/secureStorage'
import { walletLogger } from '../services/logger'

interface ConnectedAppsContextType {
  // State
  connectedApps: string[]
  trustedOrigins: string[]
  loading: boolean

  // Actions
  addTrustedOrigin: (origin: string) => { success: boolean; error?: string }
  removeTrustedOrigin: (origin: string) => void
  isTrustedOrigin: (origin: string) => boolean
  connectApp: (origin: string) => boolean
  disconnectApp: (origin: string) => void
  isAppConnected: (origin: string) => boolean
}

const ConnectedAppsContext = createContext<ConnectedAppsContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useConnectedApps() {
  const context = useContext(ConnectedAppsContext)
  if (!context) {
    throw new Error('useConnectedApps must be used within a ConnectedAppsProvider')
  }
  return context
}

interface ConnectedAppsProviderProps {
  children: ReactNode
}

export function ConnectedAppsProvider({ children }: ConnectedAppsProviderProps) {
  const [connectedApps, setConnectedApps] = useState<string[]>([])
  const [trustedOrigins, setTrustedOrigins] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // Load from secure storage on mount
  useEffect(() => {
    let mounted = true

    const loadData = async () => {
      try {
        // Migrate any unencrypted data first
        await migrateToSecureStorage()

        // Load trusted origins
        const savedOrigins = await secureGetJSON<string[]>('trusted_origins')
        if (savedOrigins && mounted) {
          setTrustedOrigins(savedOrigins)
        }

        // Load connected apps
        const savedApps = await secureGetJSON<string[]>('connected_apps')
        if (savedApps && mounted) {
          setConnectedApps(savedApps)
        }
      } catch (e) {
        walletLogger.error('Failed to load connected apps data', e)
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    loadData()

    return () => {
      mounted = false
    }
  }, [])

  // Add a trusted origin (with validation)
  const addTrustedOrigin = useCallback((origin: string): { success: boolean; error?: string } => {
    // Validate the origin
    const validationError = validateOriginWithReason(origin)
    if (validationError) {
      walletLogger.warn('Invalid origin rejected', { origin, error: validationError })
      return { success: false, error: validationError }
    }

    if (!isValidOrigin(origin)) {
      walletLogger.warn('Invalid origin format', { origin })
      return { success: false, error: 'Invalid origin format' }
    }

    const normalized = normalizeOrigin(origin)

    // Check if already trusted
    if (trustedOrigins.includes(normalized)) {
      return { success: true } // Already trusted, no-op
    }

    const newOrigins = [...trustedOrigins, normalized]

    // Save to secure storage (async)
    secureSetJSON('trusted_origins', newOrigins).catch(e => {
      walletLogger.error('Failed to save trusted origins', e)
    })

    setTrustedOrigins(newOrigins)
    walletLogger.info('Added trusted origin', { origin: normalized })

    return { success: true }
  }, [trustedOrigins])

  // Remove a trusted origin
  const removeTrustedOrigin = useCallback((origin: string) => {
    const normalized = normalizeOrigin(origin)
    const newOrigins = trustedOrigins.filter(o => o !== normalized)

    secureSetJSON('trusted_origins', newOrigins).catch(e => {
      walletLogger.error('Failed to save trusted origins', e)
    })

    setTrustedOrigins(newOrigins)
    walletLogger.info('Removed trusted origin', { origin: normalized })
  }, [trustedOrigins])

  // Check if an origin is trusted
  const isTrustedOrigin = useCallback((origin: string): boolean => {
    try {
      const normalized = normalizeOrigin(origin)
      return trustedOrigins.includes(normalized)
    } catch {
      return false
    }
  }, [trustedOrigins])

  // Connect an app (mark as having active connection)
  const connectApp = useCallback((origin: string): boolean => {
    if (!isValidOrigin(origin)) {
      return false
    }

    const normalized = normalizeOrigin(origin)

    if (connectedApps.includes(normalized)) {
      return true // Already connected
    }

    const newApps = [...connectedApps, normalized]

    secureSetJSON('connected_apps', newApps).catch(e => {
      walletLogger.error('Failed to save connected apps', e)
    })

    setConnectedApps(newApps)
    walletLogger.info('Connected app', { origin: normalized })

    return true
  }, [connectedApps])

  // Disconnect an app
  const disconnectApp = useCallback((origin: string) => {
    const normalized = normalizeOrigin(origin)
    const newApps = connectedApps.filter(app => app !== normalized)

    secureSetJSON('connected_apps', newApps).catch(e => {
      walletLogger.error('Failed to save connected apps', e)
    })

    setConnectedApps(newApps)
    walletLogger.info('Disconnected app', { origin: normalized })
  }, [connectedApps])

  // Check if an app is connected
  const isAppConnected = useCallback((origin: string): boolean => {
    try {
      const normalized = normalizeOrigin(origin)
      return connectedApps.includes(normalized)
    } catch {
      return false
    }
  }, [connectedApps])

  const value: ConnectedAppsContextType = {
    // State
    connectedApps,
    trustedOrigins,
    loading,

    // Actions
    addTrustedOrigin,
    removeTrustedOrigin,
    isTrustedOrigin,
    connectApp,
    disconnectApp,
    isAppConnected
  }

  return (
    <ConnectedAppsContext.Provider value={value}>
      {children}
    </ConnectedAppsContext.Provider>
  )
}
