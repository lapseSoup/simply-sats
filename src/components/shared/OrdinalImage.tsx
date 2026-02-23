import { useState, useCallback, useEffect, memo } from 'react'
import { Image, FileText, Braces, Diamond } from 'lucide-react'
import { getOrdinalContentUrl, isImageOrdinal } from '../../utils/ordinals'

/**
 * Module-level blob URL cache: origin → blob URL.
 * Survives React re-renders AND unmount/remount from react-window virtualized scrolling.
 * Without this, every re-render cascade from setOrdinalContentCache(new Map(...)) causes
 * blob URLs to be recreated → <img src> changes → visible thumbnail flicker.
 */
const blobUrlCache = new Map<string, string>()

interface OrdinalImageProps {
  origin: string | undefined
  contentType: string | undefined
  size?: 'sm' | 'md' | 'lg'
  alt?: string
  lazy?: boolean
  /** Cached content for rendering text/JSON previews or data-URL images */
  cachedContent?: { contentData?: Uint8Array; contentText?: string; contentType?: string }
}

export const OrdinalImage = memo(function OrdinalImage({
  origin,
  contentType: contentTypeProp,
  size = 'md',
  alt = 'Ordinal',
  lazy = true,
  cachedContent
}: OrdinalImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const url = getOrdinalContentUrl(origin)

  // Prefer contentType from cached DB entry (resolved from HTTP header during fetch)
  // over the prop — the prop may be undefined for transferred ordinals on restore.
  const contentType = cachedContent?.contentType ?? contentTypeProp

  const isImage = isImageOrdinal(contentType)
  const isText = contentType?.startsWith('text/') && !contentType?.includes('html')
  const isJson = contentType?.includes('json')

  const handleLoad = useCallback(() => setStatus('loaded'), [])
  const handleError = useCallback(() => setStatus('error'), [])

  // Generate blob URL for cached images — uses module-level cache to prevent flicker.
  // On remount (from react-window scroll), the lazy initializer reads the cached URL
  // so the <img> renders with the correct src immediately (no loading flash).
  const [cachedImageUrl, setCachedImageUrl] = useState<string | undefined>(
    () => (origin ? blobUrlCache.get(origin) : undefined)
  )
  useEffect(() => {
    if (isImage && cachedContent?.contentData && cachedContent.contentData.length > 0) {
      // Cache hit — reuse existing blob URL (no new blob creation, no flicker)
      if (origin && blobUrlCache.has(origin)) {
        setCachedImageUrl(blobUrlCache.get(origin))
        return // No cleanup — module cache owns the URL lifetime
      }

      try {
        // Use a sliced copy of the buffer — the Uint8Array may be a view into a
        // larger shared ArrayBuffer (e.g. from SQLite), so .buffer alone can include
        // extra bytes before byteOffset, corrupting the image.
        const data = cachedContent.contentData
        const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
        const blob = new Blob([buf], { type: contentType || 'image/png' })
        const blobUrl = URL.createObjectURL(blob)
        if (origin) {
          // Evict oldest entry if cache exceeds 500 (memory safety)
          if (blobUrlCache.size > 500) {
            const firstKey = blobUrlCache.keys().next().value
            if (firstKey) {
              URL.revokeObjectURL(blobUrlCache.get(firstKey)!)
              blobUrlCache.delete(firstKey)
            }
          }
          blobUrlCache.set(origin, blobUrl)
        }
        setCachedImageUrl(blobUrl)
        // No cleanup return — blob URL is owned by the module cache, not this effect
      } catch {
        setCachedImageUrl(undefined)
      }
    } else {
      setCachedImageUrl(undefined)
    }
  }, [isImage, cachedContent?.contentData, contentType, origin])

  // Render text/JSON previews if we have cached content
  if ((isText || isJson) && cachedContent?.contentText) {
    return (
      <div className={`ordinal-img-wrapper ordinal-img-${size}`}>
        <TextPreview
          text={cachedContent.contentText}
          isJson={!!isJson}
          size={size}
        />
      </div>
    )
  }

  // For non-image types without cached content, show fallback icon.
  // If contentType is still unknown after checking the cache, attempt the GorillaPool
  // network load — the browser will render it if it's an image.
  if (!url || (contentType !== undefined && !isImage)) {
    return (
      <div className={`ordinal-img-fallback ordinal-img-${size}`}>
        <FallbackIcon contentType={contentType} size={size} />
      </div>
    )
  }

  // Image rendering — prefer cached data URL over network
  const imgSrc = cachedImageUrl || url

  return (
    <div className={`ordinal-img-wrapper ordinal-img-${size}`}>
      {status === 'loading' && (
        <div className="ordinal-img-loading" />
      )}
      {status === 'error' ? (
        <div className={`ordinal-img-fallback ordinal-img-${size}`}>
          <FallbackIcon contentType={contentType} size={size} />
        </div>
      ) : (
        <img
          src={imgSrc}
          alt={alt}
          loading={lazy ? 'lazy' : undefined}
          onLoad={handleLoad}
          onError={handleError}
          className={`ordinal-img ${status === 'loaded' ? 'ordinal-img-visible' : ''}`}
        />
      )}
    </div>
  )
})

function TextPreview({ text, isJson, size }: { text: string; isJson: boolean; size: string }) {
  const maxChars = size === 'lg' ? 500 : size === 'md' ? 200 : 100
  const truncated = text.length > maxChars ? text.slice(0, maxChars) + '...' : text

  // Try to format JSON for display
  let displayText = truncated
  if (isJson) {
    try {
      const parsed = JSON.parse(text)
      displayText = JSON.stringify(parsed, null, 2)
      if (displayText.length > maxChars) {
        displayText = displayText.slice(0, maxChars) + '...'
      }
    } catch {
      // Not valid JSON, display as-is
    }
  }

  return (
    <div className={`ordinal-text-preview ${isJson ? 'ordinal-json-preview' : ''}`}>
      {displayText}
    </div>
  )
}

function FallbackIcon({ contentType, size }: { contentType?: string; size: string }) {
  const iconSize = size === 'lg' ? 48 : size === 'md' ? 24 : 16
  if (contentType?.startsWith('image/')) return <Image size={iconSize} strokeWidth={1.75} />
  if (contentType?.startsWith('text/')) return <FileText size={iconSize} strokeWidth={1.75} />
  if (contentType?.includes('json')) return <Braces size={iconSize} strokeWidth={1.75} />
  return <Diamond size={iconSize} strokeWidth={1.75} />
}
