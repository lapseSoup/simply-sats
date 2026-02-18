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
        <div className="speed-bump-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`btn ${warningLevel === 'high' ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleConfirm}
            disabled={loading || !canConfirm}
          >
            {loading ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  )
}
