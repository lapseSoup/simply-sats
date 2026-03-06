import { useCallback } from 'react'
import {
  clearAllContentCache,
  clearImageCache,
  formatCacheSize,
  getCacheStats,
  resizeOrdinalCache,
} from '../services/wallet/ordinalCacheManager'

export function useOrdinalCacheManager() {
  const loadCacheStats = useCallback(async () => {
    return getCacheStats()
  }, [])

  const resizeCache = useCallback(async (maxDim: number) => {
    return resizeOrdinalCache(maxDim)
  }, [])

  const clearCachedImages = useCallback(async () => {
    await clearImageCache()
  }, [])

  const clearCachedContent = useCallback(async () => {
    await clearAllContentCache()
  }, [])

  return {
    loadCacheStats,
    resizeCache,
    clearCachedImages,
    clearCachedContent,
    formatCacheSize,
  }
}
