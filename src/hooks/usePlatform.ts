/**
 * Platform detection hook for adaptive UI rendering.
 *
 * Detects the runtime platform (desktop, iOS, Android) and exposes
 * boolean flags for conditional rendering and behavior gating.
 *
 * Detection uses navigator.userAgent on first render (stable — won't
 * change during the app lifecycle). For Tauri mobile builds, the
 * webview user agent contains platform identifiers.
 *
 * @module hooks/usePlatform
 */

export type Platform = 'desktop' | 'ios' | 'android'

export interface PlatformInfo {
  /** Detected platform */
  platform: Platform
  /** True on iOS or Android */
  isMobile: boolean
  /** True on desktop (macOS/Windows/Linux) */
  isDesktop: boolean
  /** True on iOS (iPhone/iPad) */
  isIOS: boolean
  /** True on Android */
  isAndroid: boolean
  /** True if the device has a coarse pointer (touch screen) */
  hasTouchScreen: boolean
}

/** Detect platform from user agent — runs once, result is stable */
function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('android')) return 'android'
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'ios'
  return 'desktop'
}

/** Detect touch capability via media query */
function detectTouchScreen(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches
}

// Computed once at module load — platform doesn't change during app lifecycle
const platform = detectPlatform()
const isMobile = platform === 'ios' || platform === 'android'
const hasTouchScreen = detectTouchScreen()

const platformInfo: PlatformInfo = {
  platform,
  isMobile,
  isDesktop: !isMobile,
  isIOS: platform === 'ios',
  isAndroid: platform === 'android',
  hasTouchScreen,
}

/**
 * Returns stable platform detection info.
 *
 * This is NOT a stateful hook — it returns a module-level singleton.
 * No re-renders, no effects, no state. Safe to call anywhere.
 *
 * @example
 * ```tsx
 * const { isMobile, isIOS } = usePlatform()
 * if (isMobile) return <MobileTabBar />
 * ```
 */
export function usePlatform(): PlatformInfo {
  return platformInfo
}

/**
 * Non-hook version for use outside React components (config, services).
 * Returns the same singleton as usePlatform().
 */
export function getPlatformInfo(): PlatformInfo {
  return platformInfo
}

/**
 * Simple boolean check for use in config modules where hooks can't be called.
 * @returns true if running on iOS or Android
 */
export function isMobilePlatform(): boolean {
  return isMobile
}
