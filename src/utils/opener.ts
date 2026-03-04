/**
 * Platform-agnostic URL opener.
 *
 * Wraps `@tauri-apps/plugin-opener` with a fallback to `window.open` so that
 * components never import Tauri plugins directly. This enables future Chrome
 * extension parity where Tauri APIs are unavailable.
 *
 * @module utils/opener
 */

import { isTauri } from './tauri'

/**
 * Open a URL in the user's default browser.
 *
 * - In Tauri (desktop): uses `@tauri-apps/plugin-opener` (dynamic import).
 * - In browser / extension: falls back to `window.open`.
 */
export async function openExternalUrl(url: string): Promise<void> {
  // Q-100: Only allow safe URL schemes to prevent opening javascript:, data:, file: etc.
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Blocked URL with disallowed scheme: ${url.split(':')[0]}`)
  }
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
