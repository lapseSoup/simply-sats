import { useState, useCallback, useMemo, memo } from 'react'
import { Image, FileText, Braces, Diamond } from 'lucide-react'
import { getOrdinalContentUrl, isImageOrdinal } from '../../utils/ordinals'

interface OrdinalImageProps {
  origin: string | undefined
  contentType: string | undefined
  size?: 'sm' | 'md' | 'lg'
  alt?: string
  lazy?: boolean
  /** Cached content for rendering text/JSON previews or data-URL images */
  cachedContent?: { contentData?: Uint8Array; contentText?: string }
}

export const OrdinalImage = memo(function OrdinalImage({
  origin,
  contentType,
  size = 'md',
  alt = 'Ordinal',
  lazy = true,
  cachedContent
}: OrdinalImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const url = getOrdinalContentUrl(origin)
  const isImage = isImageOrdinal(contentType)
  const isText = contentType?.startsWith('text/') && !contentType?.includes('html')
  const isJson = contentType?.includes('json')

  const handleLoad = useCallback(() => setStatus('loaded'), [])
  const handleError = useCallback(() => setStatus('error'), [])

  // Generate data URL for cached images
  const cachedImageUrl = useMemo(() => {
    if (isImage && cachedContent?.contentData && cachedContent.contentData.length > 0) {
      try {
        const blob = new Blob([cachedContent.contentData], { type: contentType || 'image/png' })
        return URL.createObjectURL(blob)
      } catch {
        return undefined
      }
    }
    return undefined
  }, [isImage, cachedContent?.contentData, contentType])

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

  // For non-image types without cached content, show fallback icon
  if (!isImage || !url) {
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
