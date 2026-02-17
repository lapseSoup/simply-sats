/**
 * SpeedBumpModal Component
 *
 * Confirmation dialog for irreversible or high-value actions.
 * Provides different warning levels and optional type-to-confirm.
 */

import { useState, useRef, useEffect } from 'react'
import { Modal } from './Modal'

type WarningLevel = 'low' | 'medium' | 'high'

interface SpeedBumpModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  warningLevel?: WarningLevel
  confirmText?: string
  cancelText?: string
  /** If provided, user must type this exactly to confirm */
  requireTypeConfirm?: string
  /** Additional details to show (like transaction preview) */
  details?: React.ReactNode
}

export function SpeedBumpModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  warningLevel = 'medium',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  requireTypeConfirm,
  details
}: SpeedBumpModalProps) {
  const [typedConfirm, setTypedConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when opened with type-to-confirm
  useEffect(() => {
    if (isOpen && requireTypeConfirm) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen, requireTypeConfirm])

  // Reset state on close
  useEffect(() => {
    if (!isOpen) {
      setTypedConfirm('')
      setLoading(false)
    }
  }, [isOpen])

  const canConfirm = requireTypeConfirm
    ? typedConfirm === requireTypeConfirm
    : true

  const handleConfirm = async () => {
    setLoading(true)
    try {
      await onConfirm()
    } finally {
      setLoading(false)
    }
  }

  const getWarningColor = () => {
    switch (warningLevel) {
      case 'low':
        return 'var(--info)'
      case 'medium':
        return 'var(--warning)'
      case 'high':
        return 'var(--error)'
      default:
        return 'var(--warning)'
    }
  }

  const getWarningBg = () => {
    switch (warningLevel) {
      case 'low':
        return 'var(--info-bg)'
      case 'medium':
        return 'var(--warning-bg)'
      case 'high':
        return 'var(--error-bg)'
      default:
        return 'var(--warning-bg)'
    }
  }

  const getWarningBorder = () => {
    switch (warningLevel) {
      case 'low':
        return 'var(--info-border)'
      case 'medium':
        return 'var(--warning-border)'
      case 'high':
        return 'var(--error-border)'
      default:
        return 'var(--warning-border)'
    }
  }

  if (!isOpen) return null

  return (
    <Modal onClose={onClose} title="Confirm Action">
      <div className="speed-bump-content">
        {/* Warning Icon */}
        <div className="warning-icon" style={{ color: getWarningColor() }}>
          {warningLevel === 'high' ? (
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3">
              <circle cx="24" cy="24" r="20" />
              <path d="M24 14V26M24 32V32.01" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M24 6L4 42H44L24 6Z" />
              <path d="M24 20V28M24 34V34.01" strokeLinecap="round" />
            </svg>
          )}
        </div>

        {/* Title */}
        <h3 className="speed-bump-title">{title}</h3>

        {/* Warning Message */}
        <div
          className="warning-box"
          style={{
            background: getWarningBg(),
            borderColor: getWarningBorder()
          }}
        >
          <p className="warning-message" style={{ color: getWarningColor() }}>
            {message}
          </p>
        </div>

        {/* Details */}
        {details && (
          <div className="details-section">
            {details}
          </div>
        )}

        {/* Type to Confirm */}
        {requireTypeConfirm && (
          <div className="type-confirm-section">
            <p className="type-confirm-label">
              Type <code>{requireTypeConfirm}</code> to confirm:
            </p>
            <input
              ref={inputRef}
              type="text"
              value={typedConfirm}
              onChange={e => setTypedConfirm(e.target.value)}
              placeholder={requireTypeConfirm}
              className={`type-confirm-input ${canConfirm ? 'valid' : ''}`}
              disabled={loading}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        {/* Actions */}
        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`primary-button ${warningLevel === 'high' ? 'danger' : ''}`}
            onClick={handleConfirm}
            disabled={loading || !canConfirm}
          >
            {loading ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>

      <style>{`
        .speed-bump-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          text-align: center;
        }

        .warning-icon {
          margin-bottom: 0.5rem;
        }

        .speed-bump-title {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--text-primary);
        }

        .warning-box {
          width: 100%;
          padding: 1rem;
          border: 1px solid;
          border-radius: 0.75rem;
        }

        .warning-message {
          margin: 0;
          font-size: 0.875rem;
          line-height: 1.5;
        }

        .details-section {
          width: 100%;
          padding: 1rem;
          background: var(--bg-surface-2);
          border-radius: 0.75rem;
          text-align: left;
        }

        .type-confirm-section {
          width: 100%;
        }

        .type-confirm-label {
          font-size: 0.875rem;
          color: var(--text-secondary);
          margin: 0 0 0.5rem 0;
        }

        .type-confirm-label code {
          padding: 0.125rem 0.375rem;
          background: var(--bg-surface-2);
          border-radius: 0.25rem;
          font-family: monospace;
          color: var(--text-primary);
        }

        .type-confirm-input {
          width: 100%;
          padding: 0.75rem;
          background: var(--bg-surface-2);
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          color: var(--text-primary);
          font-size: 0.875rem;
          font-family: monospace;
          text-align: center;
          outline: none;
          transition: border-color 0.15s ease;
        }

        .type-confirm-input:focus {
          border-color: var(--accent);
        }

        .type-confirm-input.valid {
          border-color: var(--success);
        }

        .button-row {
          display: flex;
          gap: 0.75rem;
          width: 100%;
          margin-top: 0.5rem;
        }

        .primary-button,
        .secondary-button {
          flex: 1;
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .primary-button {
          background: linear-gradient(135deg, var(--accent), var(--accent-dark));
          border: none;
          color: white;
        }

        .primary-button.danger {
          background: linear-gradient(135deg, var(--error), var(--error-dark, #dc2626));
        }

        .primary-button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px var(--accent-glow);
        }

        .primary-button.danger:hover:not(:disabled) {
          box-shadow: 0 4px 12px var(--error-glow, rgba(239, 68, 68, 0.3));
        }

        .primary-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .secondary-button {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text-primary);
        }

        .secondary-button:hover:not(:disabled) {
          background: var(--bg-surface-3);
        }

        .secondary-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </Modal>
  )
}
