/**
 * LockScreenModal Component
 *
 * Full-screen overlay that appears when the wallet is locked
 * due to inactivity. Requires password to unlock.
 */

import { useState, useRef, useEffect } from 'react'

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
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <circle cx="32" cy="32" r="30" stroke="url(#lock-gradient)" strokeWidth="4" />
            <path
              d="M32 18C25.4 18 20 23.4 20 30V34H18V46H46V34H44V30C44 23.4 38.6 18 32 18ZM24 30C24 25.6 27.6 22 32 22C36.4 22 40 25.6 40 30V34H24V30Z"
              fill="url(#lock-gradient)"
            />
            <defs>
              <linearGradient id="lock-gradient" x1="0" y1="0" x2="64" y2="64">
                <stop stopColor="#f7931a" />
                <stop offset="1" stopColor="#ff6b00" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <h1 id="lock-title" className="lock-screen-title">Wallet Locked</h1>
        <p className="lock-screen-subtitle">
          {accountName} is locked due to inactivity
        </p>

        <form onSubmit={handleSubmit} className="lock-screen-form">
          <div className="password-input-container">
            <input
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              className={`lock-screen-input ${error ? 'error' : ''}`}
              disabled={loading}
              autoComplete="current-password"
              aria-label="Password"
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
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
            disabled={loading || !password}
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
          Locked for your security after 10 minutes of inactivity
        </p>
      </div>

      <style>{`
        .lock-screen-overlay {
          position: fixed;
          inset: 0;
          background: var(--color-background, #0a0a14);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          animation: fadeIn 0.3s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .lock-screen-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2rem;
          max-width: 360px;
          width: 100%;
        }

        .lock-screen-logo {
          margin-bottom: 1.5rem;
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.8; }
        }

        .lock-screen-title {
          font-size: 1.5rem;
          font-weight: 600;
          color: var(--color-text, #fff);
          margin: 0 0 0.5rem 0;
        }

        .lock-screen-subtitle {
          font-size: 0.875rem;
          color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
          margin: 0 0 2rem 0;
          text-align: center;
        }

        .lock-screen-form {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .password-input-container {
          position: relative;
          width: 100%;
        }

        .lock-screen-input {
          width: 100%;
          padding: 0.875rem 3rem 0.875rem 1rem;
          background: var(--color-surface, rgba(255, 255, 255, 0.05));
          border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
          border-radius: 0.75rem;
          color: var(--color-text, #fff);
          font-size: 1rem;
          outline: none;
          transition: all 0.15s ease;
        }

        .lock-screen-input:focus {
          border-color: var(--color-primary, #f7931a);
          box-shadow: 0 0 0 3px rgba(247, 147, 26, 0.2);
        }

        .lock-screen-input.error {
          border-color: var(--color-error, #ef4444);
        }

        .lock-screen-input::placeholder {
          color: var(--color-text-secondary, rgba(255, 255, 255, 0.4));
        }

        .toggle-password-button {
          position: absolute;
          right: 0.75rem;
          top: 50%;
          transform: translateY(-50%);
          background: transparent;
          border: none;
          padding: 0.25rem;
          cursor: pointer;
          color: var(--color-text-secondary, rgba(255, 255, 255, 0.5));
          transition: color 0.15s ease;
        }

        .toggle-password-button:hover {
          color: var(--color-text, #fff);
        }

        .lock-screen-error {
          color: var(--color-error, #ef4444);
          font-size: 0.875rem;
          margin: 0;
          text-align: center;
        }

        .lock-screen-button {
          width: 100%;
          padding: 0.875rem;
          background: linear-gradient(135deg, var(--color-primary, #f7931a), var(--color-secondary, #ff6b00));
          border: none;
          border-radius: 0.75rem;
          color: white;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 48px;
        }

        .lock-screen-button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(247, 147, 26, 0.3);
        }

        .lock-screen-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .loading-spinner {
          width: 20px;
          height: 20px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .lock-screen-cancel {
          margin-top: 1rem;
          padding: 0.5rem 1rem;
          background: transparent;
          border: none;
          color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
          font-size: 0.875rem;
          cursor: pointer;
          transition: color 0.15s ease;
        }

        .lock-screen-cancel:hover {
          color: var(--color-text, #fff);
        }

        .lock-screen-hint {
          margin-top: 2rem;
          font-size: 0.75rem;
          color: var(--color-text-secondary, rgba(255, 255, 255, 0.4));
          text-align: center;
        }
      `}</style>
    </div>
  )
}
