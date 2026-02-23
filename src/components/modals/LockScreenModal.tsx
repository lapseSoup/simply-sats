/**
 * LockScreenModal Component
 *
 * Full-screen overlay that appears when the wallet is locked
 * due to inactivity. Requires password to unlock.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Lock, Eye, EyeOff } from 'lucide-react'
import {
  checkUnlockRateLimit,
  recordFailedUnlockAttempt,
  getRemainingAttempts,
  formatLockoutTime
} from '../../services/rateLimiter'

interface LockScreenModalProps {
  onUnlock: (password: string) => Promise<boolean>
  onCancel?: () => void
  accountName?: string
}

export function LockScreenModal({
  onUnlock,
  onCancel,
  accountName = 'Wallet'
}: LockScreenModalProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null)
  const [lockoutMs, setLockoutMs] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const lockoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isLockedOut = lockoutMs > 0

  const clearLockoutTimer = useCallback(() => {
    if (lockoutTimerRef.current) {
      clearInterval(lockoutTimerRef.current)
      lockoutTimerRef.current = null
    }
  }, [])

  const startLockoutCountdown = useCallback((ms: number) => {
    clearLockoutTimer()
    setLockoutMs(ms)
    const startTime = Date.now()
    const endTime = startTime + ms

    lockoutTimerRef.current = setInterval(() => {
      const remaining = Math.max(0, endTime - Date.now())
      setLockoutMs(remaining)
      if (remaining <= 0) {
        clearLockoutTimer()
        setError('')
        setAttemptsRemaining(null)
        inputRef.current?.focus()
      }
    }, 1000)
  }, [clearLockoutTimer])

  // Check rate limit on mount and focus input
  useEffect(() => {
    async function checkInitialState() {
      const rateLimit = await checkUnlockRateLimit()
      if (rateLimit.isLimited && rateLimit.remainingMs > 0) {
        setError(`Too many attempts. Locked for ${formatLockoutTime(rateLimit.remainingMs)}.`)
        startLockoutCountdown(rateLimit.remainingMs)
      } else {
        const remaining = await getRemainingAttempts()
        setAttemptsRemaining(remaining)
        inputRef.current?.focus()
      }
    }
    checkInitialState()
    return clearLockoutTimer
  }, [startLockoutCountdown, clearLockoutTimer])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const success = await onUnlock(password)
      if (!success) {
        const result = await recordFailedUnlockAttempt()
        setAttemptsRemaining(result.attemptsRemaining)

        if (result.isLocked) {
          setError(`Too many attempts. Locked for ${formatLockoutTime(result.lockoutMs)}.`)
          startLockoutCountdown(result.lockoutMs)
        } else {
          setError(`Incorrect password. ${result.attemptsRemaining} attempt${result.attemptsRemaining !== 1 ? 's' : ''} remaining.`)
        }
        setPassword('')
        if (!result.isLocked) {
          inputRef.current?.focus()
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="lock-screen-overlay" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <div className="lock-screen-container">
        {/* Logo/Branding */}
        <div className="lock-screen-logo">
          <Lock size={48} strokeWidth={1.75} />
        </div>

        <h1 id="lock-title" className="lock-screen-title">Wallet Locked</h1>
        <p className="lock-screen-subtitle">
          {accountName} is locked due to inactivity
        </p>

        <form onSubmit={handleSubmit} className="lock-screen-form">
          <label htmlFor="lock-screen-password" className="sr-only">Password</label>
          <div className="password-input-container">
            <input
              ref={inputRef}
              id="lock-screen-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your password"
              className={`lock-screen-input ${error ? 'error' : ''}`}
              disabled={loading || isLockedOut}
              autoComplete="current-password"
              aria-invalid={!!error || isLockedOut}
              aria-describedby={error || isLockedOut ? 'password-error' : undefined}
            />
            <button
              type="button"
              className="toggle-password-button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <EyeOff size={20} strokeWidth={1.75} />
              ) : (
                <Eye size={20} strokeWidth={1.75} />
              )}
            </button>
          </div>

          {isLockedOut && (
            <p id="password-error" className="lock-screen-error" role="alert">
              Too many attempts. Locked for {formatLockoutTime(lockoutMs)}.
            </p>
          )}

          {!isLockedOut && error && (
            <p id="password-error" className="lock-screen-error" role="alert">
              {error}
            </p>
          )}

          {!isLockedOut && !error && attemptsRemaining !== null && attemptsRemaining < 5 && (
            <p className="lock-screen-attempts-hint">
              {attemptsRemaining} attempt{attemptsRemaining !== 1 ? 's' : ''} remaining
            </p>
          )}

          <button
            type="submit"
            className="lock-screen-button"
            disabled={loading || isLockedOut}
          >
            {loading ? (
              <span className="loading-spinner" />
            ) : (
              'Unlock'
            )}
          </button>
        </form>

        {onCancel && (
          <button
            type="button"
            className="lock-screen-cancel"
            onClick={onCancel}
          >
            Use Different Account
          </button>
        )}

        <p className="lock-screen-hint">
          Locked for your security after inactivity.
          {' '}If you never set a password, leave it blank.
        </p>
      </div>

    </div>
  )
}
