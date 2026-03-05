/**
 * Platform-agnostic window / webview helpers.
 *
 * Wraps `@tauri-apps/api/webviewWindow` and `@tauri-apps/api/window` with
 * `isTauri()` guards and browser fallbacks so that components never import
 * Tauri APIs directly.
 *
 * @module utils/window
 */

import { isTauri } from './tauri'

interface OpenViewerOptions {
  /** Unique label for the webview window (must be alphanumeric + dash/underscore). */
  label: string
  /** URL to load in the viewer window. */
  url: string
  /** Window title. */
  title: string
  /** Desired width in CSS pixels (capped at 90% of screen). Default: 800. */
  width?: number
  /** Desired height in CSS pixels (capped at 90% of screen). Default: 800. */
  height?: number
  /** Whether the window is resizable. Default: true. */
  resizable?: boolean
}

/**
 * Open a new viewer window.
 *
 * - In Tauri: creates a `WebviewWindow` sized to the current monitor.
 * - In browser / extension: falls back to `window.open`.
 */
export async function openViewerWindow(opts: OpenViewerOptions): Promise<void> {
  const width = opts.width ?? 800
  const height = opts.height ?? 800

  if (isTauri()) {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const { currentMonitor } = await import('@tauri-apps/api/window')

    let cappedWidth = width
    let cappedHeight = height
    try {
      const monitor = await currentMonitor()
      if (monitor) {
        const maxW = Math.floor(monitor.size.width / monitor.scaleFactor * 0.9)
        const maxH = Math.floor(monitor.size.height / monitor.scaleFactor * 0.9)
        cappedWidth = Math.min(width, maxW)
        cappedHeight = Math.min(height, maxH)
      }
    } catch {
      // Fall back to requested dimensions
    }

    try {
      const webview = new WebviewWindow(opts.label, {
        url: opts.url,
        title: opts.title,
        width: cappedWidth,
        height: cappedHeight,
        resizable: opts.resizable ?? true,
      })

      webview.once('tauri://error', (e) => {
        console.error(`[Window] Failed to create window '${opts.label}':`, e)
      })
    } catch (e) {
      console.error(`[Window] WebviewWindow constructor failed for '${opts.label}':`, e)
    }
  } else {
    window.open(opts.url, '_blank', `width=${width},height=${height},resizable=${opts.resizable ?? true ? 'yes' : 'no'}`)
  }
}
