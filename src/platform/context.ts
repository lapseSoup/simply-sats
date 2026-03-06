import { createContext } from 'react'
import type { PlatformAdapter } from './types'

export interface PlatformContextValue {
  platform: PlatformAdapter | null
  loading: boolean
  error: string | null
}

export const PlatformContext = createContext<PlatformContextValue>({
  platform: null,
  loading: true,
  error: null,
})
