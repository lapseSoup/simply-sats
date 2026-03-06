import { useContext } from 'react'
import type { PlatformAdapter } from './types'
import { PlatformContext } from './context'

export function usePlatform(): PlatformAdapter | null {
  const { platform } = useContext(PlatformContext)
  return platform
}

export function usePlatformOrThrow(): PlatformAdapter {
  const { platform, loading, error } = useContext(PlatformContext)

  if (error) throw new Error(`Platform initialization failed: ${error}`)
  if (loading || !platform) throw new Error('Platform not yet initialized')

  return platform
}

export function usePlatformStatus(): { loading: boolean; error: string | null } {
  const { loading, error } = useContext(PlatformContext)
  return { loading, error }
}
