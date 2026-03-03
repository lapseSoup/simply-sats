/**
 * Platform Provider
 *
 * React context that provides the PlatformAdapter to all components.
 * Must be the outermost provider in the component tree.
 *
 * @module platform/PlatformProvider
 */

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import type { PlatformAdapter } from './types'
import { getPlatform } from './index'

interface PlatformContextValue {
  platform: PlatformAdapter | null
  loading: boolean
  error: string | null
}

const PlatformContext = createContext<PlatformContextValue>({
  platform: null,
  loading: true,
  error: null,
})

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

/**
 * Hook to access the PlatformAdapter.
 *
 * @returns The platform adapter, or null if still loading.
 * @throws Error if used outside PlatformProvider.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const platform = usePlatform()
 *   if (!platform) return <Loading />
 *
 *   const keys = await platform.deriveWalletKeys(mnemonic)
 * }
 * ```
 */
export function usePlatform(): PlatformAdapter | null {
  const { platform } = useContext(PlatformContext)
  return platform
}

/**
 * Hook that returns the platform adapter or throws if not ready.
 * Use when you know the platform must be loaded (e.g., inside wallet-gated UI).
 */
export function usePlatformOrThrow(): PlatformAdapter {
  const { platform, loading, error } = useContext(PlatformContext)

  if (error) throw new Error(`Platform initialization failed: ${error}`)
  if (loading || !platform) throw new Error('Platform not yet initialized')

  return platform
}

/**
 * Hook to check platform loading state.
 */
export function usePlatformStatus(): { loading: boolean; error: string | null } {
  const { loading, error } = useContext(PlatformContext)
  return { loading, error }
}
