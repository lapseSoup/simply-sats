/**
 * Confirmation Modal Component
 *
 * A reusable "speed bump" modal for confirming irreversible or high-value actions.
 * Displays a warning message and requires explicit user confirmation.
 */

import { useState, useEffect, useRef } from 'react'
import { AlertOctagon, AlertTriangle, Info } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useKeyboardNav } from '../../hooks/useKeyboardNav'

export type ConfirmationType = 'warning' | 'danger' | 'info'

interface ConfirmationModalProps {
  /** Modal title */
  title: string
  /** Main message to display */
  message: string
  /** Optional secondary details */
  details?: string
  /** Type affects styling (warning=yellow, danger=red, info=blue) */
  type?: ConfirmationType
  /** Text for confirm button */
  confirmText?: string
  /** Text for cancel button */
  cancelText?: string
  /** Called when user confirms */
  onConfirm: () => void
  /** Called when user cancels */
  onCancel: () => void
  /** Optional: require typing confirmation text */
  requireTypedConfirmation?: string
  /** Show a countdown before confirm button is enabled */
  confirmDelaySeconds?: number
}

export function ConfirmationModal({
  title,
  message,
  details,
  type = 'warning',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  requireTypedConfirmation,
  confirmDelaySeconds = 0
}: ConfirmationModalProps) {
  const focusTrapRef = useFocusTrap({ enabled: true })
  const [typedText, setTypedText] = useState('')
  const [countdown, setCountdown] = useState(confirmDelaySeconds)
  const confirmInputRef = useRef<HTMLInputElement>(null)

  // Escape key cancels
  useKeyboardNav({
    onEscape: onCancel,
    enabled: true
  })

  // Prevent body scroll
  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  // Countdown timer
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [countdown])

  // Focus the confirm input if typing is required
  useEffect(() => {
    if (requireTypedConfirmation && confirmInputRef.current) {
      confirmInputRef.current.focus()
    }
  }, [requireTypedConfirmation])

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel()
    }
  }

  // Determine if confirm button should be enabled
  const isConfirmEnabled = () => {
    if (countdown > 0) return false
    if (requireTypedConfirmation) {
      return typedText.toLowerCase() === requireTypedConfirmation.toLowerCase()
    }
    return true
  }

  const getTypeIcon = () => {
    switch (type) {
      case 'danger':
        return <AlertOctagon size={48} strokeWidth={1.5} />
      case 'warning':
        return <AlertTriangle size={48} strokeWidth={1.5} />
      case 'info':
        return <Info size={48} strokeWidth={1.5} />
      default:
        return <AlertTriangle size={48} strokeWidth={1.5} />
    }
  }

  const getTypeClass = () => {
    switch (type) {
      case 'danger':
        return 'confirmation-danger'
      case 'warning':
        return 'confirmation-warning'
      case 'info':
        return 'confirmation-info'
      default:
        return 'confirmation-warning'
    }
  }

  return (
    <div
      className="modal-overlay confirmation-overlay"
      onClick={handleOverlayClick}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirmation-title"
      aria-describedby="confirmation-message"
    >
      <div
        ref={focusTrapRef}
        className={`modal confirmation-modal ${getTypeClass()}`}
      >
        <div className="confirmation-icon">
          {getTypeIcon()}
        </div>

        <h2 id="confirmation-title" className="confirmation-title">
          {title}
        </h2>

        <p id="confirmation-message" className="confirmation-message">
          {message}
        </p>

        {details && (
          <div className="confirmation-details">
            {details}
          </div>
        )}

        {requireTypedConfirmation && (
          <div className="confirmation-typed-input">
            <label htmlFor="confirm-input">
              Type <strong>{requireTypedConfirmation}</strong> to confirm:
            </label>
            <input
              ref={confirmInputRef}
              id="confirm-input"
              type="text"
              className="form-input"
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              placeholder={requireTypedConfirmation}
              autoComplete="off"
            />
          </div>
        )}

        <div className="confirmation-actions">
          <button
            className="btn btn-secondary"
            onClick={onCancel}
            type="button"
          >
            {cancelText}
          </button>
          <button
            className={`btn ${type === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={!isConfirmEnabled()}
            type="button"
          >
            {countdown > 0 ? `${confirmText} (${countdown}s)` : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

// Re-export threshold constants from config for convenience
import { CONFIRMATION_THRESHOLDS } from '../../services/config'
export const SEND_CONFIRMATION_THRESHOLD = CONFIRMATION_THRESHOLDS.sendConfirmation
export const HIGH_VALUE_THRESHOLD = CONFIRMATION_THRESHOLDS.highValue
