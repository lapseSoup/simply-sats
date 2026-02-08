/**
 * Ordinal Cache Manager
 *
 * Manages cache size by resizing images, clearing image content,
 * or clearing all cached content. Uses OffscreenCanvas for image
 * decoding/re-encoding in the browser.
 */

import {
  getImageOrdinalsWithContent,
  updateOrdinalContentData,
  clearOrdinalImageContent,
  clearOrdinalContentAll,
  getOrdinalCacheStats
} from '../database'

/**
 * Get cache statistics for display in Settings
 */
export async function getCacheStats(accountId?: number) {
  return getOrdinalCacheStats(accountId)
}

/**
 * Resize all cached images to a maximum dimension.
 * Returns the number of bytes saved.
 */
export async function resizeOrdinalCache(maxDimension: number): Promise<number> {
  const images = await getImageOrdinalsWithContent()
  let bytesSaved = 0

  for (const img of images) {
    try {
      const resized = await resizeImage(img.contentData, img.contentType, maxDimension)
      if (resized && resized.length < img.contentData.length) {
        bytesSaved += img.contentData.length - resized.length
        await updateOrdinalContentData(img.origin, resized)
      }
    } catch {
      // Skip images that can't be resized
    }
  }

  return bytesSaved
}

/**
 * Clear all cached image content (keep text/JSON)
 */
export async function clearImageCache(): Promise<void> {
  await clearOrdinalImageContent()
}

/**
 * Clear all cached content (metadata stays for re-fetch on next sync)
 */
export async function clearAllContentCache(): Promise<void> {
  await clearOrdinalContentAll()
}

/**
 * Resize an image to fit within maxDimension x maxDimension.
 * Uses a canvas element for decoding/re-encoding.
 */
async function resizeImage(
  data: Uint8Array,
  contentType: string,
  maxDimension: number
): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const blob = new Blob([data.buffer as ArrayBuffer], { type: contentType })
    const url = URL.createObjectURL(blob)
    const img = new window.Image()

    img.onload = () => {
      URL.revokeObjectURL(url)

      // Check if resize is needed
      if (img.width <= maxDimension && img.height <= maxDimension) {
        resolve(null) // Already small enough
        return
      }

      // Calculate new dimensions maintaining aspect ratio
      let newWidth = img.width
      let newHeight = img.height
      if (newWidth > newHeight) {
        newHeight = Math.round(newHeight * (maxDimension / newWidth))
        newWidth = maxDimension
      } else {
        newWidth = Math.round(newWidth * (maxDimension / newHeight))
        newHeight = maxDimension
      }

      // Draw to canvas and export
      const canvas = document.createElement('canvas')
      canvas.width = newWidth
      canvas.height = newHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(null)
        return
      }

      ctx.drawImage(img, 0, 0, newWidth, newHeight)

      // Export as the same type, or fall back to PNG
      const outputType = contentType === 'image/jpeg' ? 'image/jpeg' : 'image/png'
      const quality = contentType === 'image/jpeg' ? 0.85 : undefined

      canvas.toBlob(
        (outputBlob) => {
          if (!outputBlob) {
            resolve(null)
            return
          }
          outputBlob.arrayBuffer().then(buffer => {
            resolve(new Uint8Array(buffer))
          }).catch(() => resolve(null))
        },
        outputType,
        quality
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }

    img.src = url
  })
}

/**
 * Format bytes to human-readable string
 */
export function formatCacheSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
