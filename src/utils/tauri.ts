/**
 * Shared Tauri Environment Utilities
 *
 * Centralised detection and invocation helpers so that every module
 * uses the same check and the same timeout/race pattern.
 *
 * @module utils/tauri
 */

/**
 * Check if the app is running inside Tauri (desktop) vs browser.
 * Uses `__TAURI_INTERNALS__` which is the Tauri 2 standard global.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Default timeout for Tauri commands (30 s). */
const DEFAULT_TAURI_TIMEOUT_MS = 30_000

/**
 * Invoke a Tauri command with a timeout.
 *
 * Lazy-imports `@tauri-apps/api/core` so the module can be safely
 * imported in browser / test environments without side-effects.
 *
 * @param cmd       The Tauri command name
 * @param args      Command arguments
 * @param timeoutMs Timeout in milliseconds (default: 30 000)
 */
export async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  timeoutMs = DEFAULT_TAURI_TIMEOUT_MS,
): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return Promise.race([
    invoke<T>(cmd, args),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Tauri command '${cmd}' timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ])
}
