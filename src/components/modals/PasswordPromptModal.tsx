/**
 * PasswordPromptModal Component
 *
 * Simple modal for password entry, used when switching accounts
 * or performing other password-protected operations.
 */

import { useState, useEffect, useRef } from 'react'
import { Modal } from '../shared/Modal'

interface PasswordPromptModalProps {
  isOpen: boolean
  title: string
  message?: string
  submitLabel?: string
  onSubmit: (password: string) => Promise<boolean>
  onCancel: () => void
}

export function PasswordPromptModal({
  isOpen,
  title,
  message,
  submitLabel = 'Unlock',
  onSubmit,
  onCancel
}: PasswordPromptModalProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setPassword('')
      setError('')
      setLoading(false)
      setShowPassword(false)
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password || loading) return

    setLoading(true)
    setError('')

    try {
      const success = await onSubmit(password)
      if (!success) {
        setError('Incorrect password')
        setPassword('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <Modal onClose={onCancel} title={title}>
      <form onSubmit={handleSubmit} className="password-prompt-form">
        {message && (
          <p className="password-prompt-message">{message}</p>
        )}

        <div className="password-input-wrapper">
          <input
            ref={inputRef}
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            disabled={loading}
            className="password-input"
            autoComplete="current-password"
          />
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 3L17 17M10 5C13.5 5 16.5 7.5 18 10C17.4 11.2 16.5 12.3 15.5 13.2M14 14.2C12.8 15 11.4 15.5 10 15.5C6.5 15.5 3.5 13 2 10C2.4 9 3 8 3.8 7.2" />
                <circle cx="10" cy="10" r="3" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 10C3.5 6.5 6.5 4.5 10 4.5C13.5 4.5 16.5 6.5 18 10C16.5 13.5 13.5 15.5 10 15.5C6.5 15.5 3.5 13.5 2 10Z" />
                <circle cx="10" cy="10" r="3" />
              </svg>
            )}
          </button>
        </div>

        {error && <p className="password-error">{error}</p>}

        <div className="password-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={!password || loading}
          >
            {loading ? 'Verifying...' : submitLabel}
          </button>
        </div>
      </form>

      <style>{`
        .password-prompt-form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .password-prompt-message {
          margin: 0;
          font-size: 0.875rem;
          color: var(--color-text-secondary, rgba(255, 255, 255, 0.7));
          line-height: 1.5;
        }

        .password-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .password-input {
          flex: 1;
          padding: 0.75rem;
          padding-right: 2.5rem;
          background: var(--color-surface, rgba(255, 255, 255, 0.05));
          border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
          border-radius: 0.5rem;
          color: var(--color-text, #fff);
          font-size: 0.9375rem;
          outline: none;
          transition: border-color 0.15s ease;
          width: 100%;
        }

        .password-input:focus {
          border-color: var(--color-primary, #f7931a);
        }

        .password-input::placeholder {
          color: var(--color-text-secondary, rgba(255, 255, 255, 0.4));
        }

        .password-toggle {
          position: absolute;
          right: 0.5rem;
          background: transparent;
          border: none;
          padding: 0.375rem;
          cursor: pointer;
          color: var(--color-text-secondary, rgba(255, 255, 255, 0.5));
          transition: color 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .password-toggle:hover {
          color: var(--color-text, #fff);
        }

        .password-error {
          margin: 0;
          font-size: 0.8125rem;
          color: var(--color-error, #ef4444);
        }

        .password-actions {
          display: flex;
          gap: 0.75rem;
          margin-top: 0.5rem;
        }

        .btn-secondary,
        .btn-primary {
          flex: 1;
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .btn-secondary {
          background: transparent;
          border: 1px solid var(--color-border, rgba(255, 255, 255, 0.2));
          color: var(--color-text, #fff);
        }

        .btn-secondary:hover:not(:disabled) {
          background: var(--color-surface-2, rgba(255, 255, 255, 0.05));
        }

        .btn-primary {
          background: linear-gradient(135deg, var(--color-primary, #f7931a), var(--color-secondary, #ff6b00));
          border: none;
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(247, 147, 26, 0.3);
        }

        .btn-primary:disabled,
        .btn-secondary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </Modal>
  )
}
