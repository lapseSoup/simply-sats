import { useState, useCallback, memo } from 'react'
import { Image, FileText, Braces, Diamond } from 'lucide-react'
import { getOrdinalContentUrl, isImageOrdinal } from '../../utils/ordinals'

interface OrdinalImageProps {
  origin: string | undefined
  contentType: string | undefined
  size?: 'sm' | 'md' | 'lg'
  alt?: string
  lazy?: boolean
}

export const OrdinalImage = memo(function OrdinalImage({
  origin,
  contentType,
  size = 'md',
  alt = 'Ordinal',
  lazy = true
}: OrdinalImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const url = getOrdinalContentUrl(origin)
  const isImage = isImageOrdinal(contentType)

  const handleLoad = useCallback(() => setStatus('loaded'), [])
  const handleError = useCallback(() => setStatus('error'), [])

  if (!isImage || !url) {
    return (
      <div className={`ordinal-img-fallback ordinal-img-${size}`}>
        <FallbackIcon contentType={contentType} size={size} />
      </div>
    )
  }

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
          src={url}
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

function FallbackIcon({ contentType, size }: { contentType?: string; size: string }) {
  const iconSize = size === 'lg' ? 48 : size === 'md' ? 24 : 16
  if (contentType?.startsWith('image/')) return <Image size={iconSize} strokeWidth={1.75} />
  if (contentType?.startsWith('text/')) return <FileText size={iconSize} strokeWidth={1.75} />
  if (contentType?.includes('json')) return <Braces size={iconSize} strokeWidth={1.75} />
  return <Diamond size={iconSize} strokeWidth={1.75} />
}
