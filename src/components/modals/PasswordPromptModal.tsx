/**
 * PasswordPromptModal Component
 *
 * Simple modal for password entry, used when switching accounts
 * or performing other password-protected operations.
 */

import { useState, useEffect, useRef } from 'react'
import { Eye, EyeOff } from 'lucide-react'
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

        <label htmlFor="password-prompt-input" className="sr-only">Password</label>
        <div className="password-input-wrapper">
          <input
            ref={inputRef}
            id="password-prompt-input"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            disabled={loading}
            className="password-input"
            autoComplete="current-password"
            aria-invalid={!!error}
            aria-describedby={error ? 'password-prompt-error' : undefined}
          />
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <EyeOff size={20} strokeWidth={1.5} />
            ) : (
              <Eye size={20} strokeWidth={1.5} />
            )}
          </button>
        </div>

        {error && <p id="password-prompt-error" className="password-error" role="alert">{error}</p>}

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

    </Modal>
  )
}
