/**
 * LockScreenModal Component
 *
 * Full-screen overlay that appears when the wallet is locked
 * due to inactivity. Requires password to unlock.
 */

import { useState, useRef, useEffect } from 'react'
import { Lock, Eye, EyeOff } from 'lucide-react'

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
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const success = await onUnlock(password)
      if (!success) {
        setError('Incorrect password')
        setPassword('')
        inputRef.current?.focus()
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
              disabled={loading}
              autoComplete="current-password"
              aria-invalid={!!error}
              aria-describedby={error ? 'password-error' : undefined}
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

          {error && (
            <p id="password-error" className="lock-screen-error" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="lock-screen-button"
            disabled={loading}
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
