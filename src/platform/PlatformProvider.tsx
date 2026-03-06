/**
 * Platform Provider
 *
 * React context that provides the PlatformAdapter to all components.
 * Must be the outermost provider in the component tree.
 *
 * @module platform/PlatformProvider
 */

import { useState, useEffect, type ReactNode } from 'react'
import type { PlatformAdapter } from './types'
import { getPlatform } from './index'
import { PlatformContext } from './context'

interface PlatformProviderProps {
  children: ReactNode
  /** Optional pre-initialized adapter (for testing or custom setups) */
  adapter?: PlatformAdapter
}

/**
 * Provides the PlatformAdapter to the component tree.
 *
 * On mount, detects the platform and lazily loads the correct adapter.
 * Shows a loading state until the adapter is ready.
 */
export function PlatformProvider({ children, adapter: providedAdapter }: PlatformProviderProps) {
  const [platform, setPlatform] = useState<PlatformAdapter | null>(providedAdapter ?? null)
  const [loading, setLoading] = useState(!providedAdapter)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (providedAdapter) return

    let cancelled = false

    getPlatform()
      .then(adapter => {
        if (!cancelled) {
          setPlatform(adapter)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [providedAdapter])

  return (
    <PlatformContext.Provider value={{ platform, loading, error }}>
      {children}
    </PlatformContext.Provider>
  )
}
