/**
 * Auto-Lock Service for Simply Sats
 *
 * Provides inactivity timeout functionality to automatically lock the wallet
 * after a period of user inactivity.
 */

// Default inactivity limit in milliseconds (10 minutes)
export const DEFAULT_INACTIVITY_LIMIT = 10 * 60 * 1000

// Activity events to track
const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'click'
] as const

/**
 * Auto-lock state
 */
interface AutoLockState {
  lastActiveTime: number
  isEnabled: boolean
  inactivityLimit: number
  checkInterval: ReturnType<typeof setInterval> | null
  eventCleanup: (() => void) | null
}

// Singleton state
const state: AutoLockState = {
  lastActiveTime: Date.now(),
  isEnabled: false,
  inactivityLimit: DEFAULT_INACTIVITY_LIMIT,
  checkInterval: null,
  eventCleanup: null
}

/**
 * Update the last active time
 */
function updateActivity() {
  state.lastActiveTime = Date.now()
}

/**
 * Initialize auto-lock with a callback for when lock should trigger
 *
 * @param onLock - Callback function to execute when wallet should lock
 * @param inactivityLimitMs - Time in milliseconds before auto-lock (default: 10 minutes)
 * @returns Cleanup function to stop auto-lock
 */
export function initAutoLock(
  onLock: () => void,
  inactivityLimitMs: number = DEFAULT_INACTIVITY_LIMIT
): () => void {
  // Clean up any existing listeners
  stopAutoLock()

  state.isEnabled = true
  state.inactivityLimit = inactivityLimitMs
  state.lastActiveTime = Date.now()

  // Add activity listeners
  ACTIVITY_EVENTS.forEach(event => {
    window.addEventListener(event, updateActivity, { passive: true })
  })

  // Store cleanup function for events
  state.eventCleanup = () => {
    ACTIVITY_EVENTS.forEach(event => {
      window.removeEventListener(event, updateActivity)
    })
  }

  // Check for inactivity every minute
  state.checkInterval = setInterval(() => {
    if (!state.isEnabled) return

    const timeSinceActive = Date.now() - state.lastActiveTime

    if (timeSinceActive >= state.inactivityLimit) {
      console.log('[AutoLock] Inactivity timeout reached, locking wallet')
      onLock()
    }
  }, 60000) // Check every minute

  console.log(`[AutoLock] Initialized with ${inactivityLimitMs / 60000} minute timeout`)

  // Return cleanup function
  return stopAutoLock
}

/**
 * Stop auto-lock and clean up
 */
export function stopAutoLock(): void {
  state.isEnabled = false

  if (state.checkInterval) {
    clearInterval(state.checkInterval)
    state.checkInterval = null
  }

  if (state.eventCleanup) {
    state.eventCleanup()
    state.eventCleanup = null
  }

  console.log('[AutoLock] Stopped')
}

/**
 * Reset the inactivity timer (call when user performs explicit action)
 */
export function resetInactivityTimer(): void {
  state.lastActiveTime = Date.now()
}

/**
 * Check if auto-lock is enabled
 */
export function isAutoLockEnabled(): boolean {
  return state.isEnabled
}

/**
 * Get time remaining until auto-lock (in milliseconds)
 */
export function getTimeUntilLock(): number {
  if (!state.isEnabled) return -1

  const elapsed = Date.now() - state.lastActiveTime
  const remaining = state.inactivityLimit - elapsed

  return Math.max(0, remaining)
}

/**
 * Update the inactivity limit
 */
export function setInactivityLimit(limitMs: number): void {
  state.inactivityLimit = limitMs
  console.log(`[AutoLock] Updated timeout to ${limitMs / 60000} minutes`)
}

/**
 * Get current inactivity limit in milliseconds
 */
export function getInactivityLimit(): number {
  return state.inactivityLimit
}

/**
 * Pause auto-lock temporarily (useful during modals or sensitive operations)
 */
export function pauseAutoLock(): void {
  if (state.checkInterval) {
    clearInterval(state.checkInterval)
    state.checkInterval = null
  }
  console.log('[AutoLock] Paused')
}

/**
 * Resume auto-lock after pause
 */
export function resumeAutoLock(onLock: () => void): void {
  if (!state.isEnabled || state.checkInterval) return

  state.lastActiveTime = Date.now() // Reset timer on resume

  state.checkInterval = setInterval(() => {
    if (!state.isEnabled) return

    const timeSinceActive = Date.now() - state.lastActiveTime

    if (timeSinceActive >= state.inactivityLimit) {
      console.log('[AutoLock] Inactivity timeout reached, locking wallet')
      onLock()
    }
  }, 60000)

  console.log('[AutoLock] Resumed')
}

/**
 * Convert minutes to milliseconds
 */
export function minutesToMs(minutes: number): number {
  return minutes * 60 * 1000
}

/**
 * Preset timeout options
 */
export const TIMEOUT_OPTIONS = [
  { label: '5 minutes', value: 5 },
  { label: '10 minutes', value: 10 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
  { label: 'Never', value: 0 }
] as const
