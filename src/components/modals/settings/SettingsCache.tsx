import { useState, useEffect, useCallback } from 'react'
import { HardDrive, ChevronRight } from 'lucide-react'
import { useUI } from '../../../contexts/UIContext'
import { getCacheStats, resizeOrdinalCache, clearImageCache, clearAllContentCache, formatCacheSize } from '../../../services/wallet/ordinalCacheManager'
import { handleKeyDown } from './settingsKeyDown'

export function SettingsCache() {
  const { showToast } = useUI()

  const [cacheStats, setCacheStats] = useState<{ totalBytes: number; ordinalCount: number; imageCount: number; textCount: number } | null>(null)
  const [cacheLoading, setCacheLoading] = useState(false)
  const [showCacheOptions, setShowCacheOptions] = useState(false)

  useEffect(() => {
    getCacheStats().then(stats => setCacheStats(stats)).catch(() => {})
  }, [])

  const refreshCacheStats = useCallback(async () => {
    const stats = await getCacheStats()
    setCacheStats(stats)
  }, [])

  const handleResizeCache = useCallback(async (maxDim: number) => {
    setCacheLoading(true)
    try {
      const saved = await resizeOrdinalCache(maxDim)
      await refreshCacheStats()
      showToast(`Cache resized! Saved ${formatCacheSize(saved)}`)
    } catch {
      showToast('Failed to resize cache', 'error')
    }
    setCacheLoading(false)
    setShowCacheOptions(false)
  }, [refreshCacheStats, showToast])

  const handleClearImageCache = useCallback(async () => {
    setCacheLoading(true)
    try {
      await clearImageCache()
      await refreshCacheStats()
      showToast('Image cache cleared!')
    } catch {
      showToast('Failed to clear cache', 'error')
    }
    setCacheLoading(false)
    setShowCacheOptions(false)
  }, [refreshCacheStats, showToast])

  const handleClearAllCache = useCallback(async () => {
    setCacheLoading(true)
    try {
      await clearAllContentCache()
      await refreshCacheStats()
      showToast('All cached content cleared!')
    } catch {
      showToast('Failed to clear cache', 'error')
    }
    setCacheLoading(false)
    setShowCacheOptions(false)
  }, [refreshCacheStats, showToast])

  // Only render when there are cached ordinals
  if (!cacheStats || cacheStats.ordinalCount <= 0) return null

  return (
    <div className="settings-section">
      <div className="settings-section-title">Ordinals Cache</div>
      <div className="settings-card">
        <div className="settings-row" role="button" tabIndex={0} onClick={() => setShowCacheOptions(!showCacheOptions)} onKeyDown={handleKeyDown(() => setShowCacheOptions(!showCacheOptions))} aria-label="Manage ordinals cache">
          <div className="settings-row-left">
            <div className="settings-row-icon" aria-hidden="true"><HardDrive size={16} strokeWidth={1.75} /></div>
            <div className="settings-row-content">
              <div className="settings-row-label">Cache Size</div>
              <div className="settings-row-value">
                {formatCacheSize(cacheStats.totalBytes)} ({cacheStats.ordinalCount} ordinals)
              </div>
            </div>
          </div>
          <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
        </div>
        {showCacheOptions && (
          <div className="settings-sub-options">
            {cacheStats.imageCount > 0 && (
              <>
                <button
                  className="btn btn-secondary settings-sub-btn"
                  onClick={() => handleResizeCache(256)}
                  disabled={cacheLoading}
                >
                  Resize images to 256px
                </button>
                <button
                  className="btn btn-secondary settings-sub-btn"
                  onClick={() => handleResizeCache(512)}
                  disabled={cacheLoading}
                >
                  Resize images to 512px
                </button>
                <button
                  className="btn btn-secondary settings-sub-btn"
                  onClick={handleClearImageCache}
                  disabled={cacheLoading}
                >
                  Clear image cache
                </button>
              </>
            )}
            <button
              className="btn btn-secondary settings-sub-btn"
              onClick={handleClearAllCache}
              disabled={cacheLoading}
            >
              Clear all cached content
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
