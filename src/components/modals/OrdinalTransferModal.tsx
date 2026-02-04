/**
 * OrdinalTransferModal Component
 *
 * Modal for transferring 1Sat Ordinals to another address.
 */

import { useState } from 'react'
import { Modal } from '../shared/Modal'
import { ConfirmationModal } from '../shared/ConfirmationModal'
import type { Ordinal } from '../../services/wallet'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'

interface OrdinalTransferModalProps {
  ordinal: Ordinal
  onClose: () => void
}

export function OrdinalTransferModal({
  ordinal,
  onClose
}: OrdinalTransferModalProps) {
  const { handleTransferOrdinal } = useWallet()
  const { showToast } = useUI()
  const [toAddress, setToAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [txid, setTxid] = useState<string | null>(null)
  const [showConfirmation, setShowConfirmation] = useState(false)

  const handleTransferClick = () => {
    if (!toAddress.trim()) {
      setError('Please enter a recipient address')
      return
    }

    // Basic address validation (BSV addresses start with 1 and are 25-34 chars)
    if (!/^[13][a-km-zA-HJ-NP-Z1-9]{24,33}$/.test(toAddress.trim())) {
      setError('Invalid BSV address format')
      return
    }

    // Show confirmation modal
    setShowConfirmation(true)
  }

  const executeTransfer = async () => {
    setShowConfirmation(false)
    setLoading(true)
    setError('')

    const result = await handleTransferOrdinal(ordinal, toAddress.trim())

    if (result.success && result.txid) {
      setTxid(result.txid)
      showToast('Ordinal transferred successfully!')
    } else {
      setError(result.error || 'Transfer failed')
    }

    setLoading(false)
  }

  const handleClose = () => {
    setToAddress('')
    setError('')
    setTxid(null)
    setLoading(false)
    onClose()
  }

  // Get content type display
  const getContentTypeDisplay = () => {
    if (ordinal.contentType) {
      if (ordinal.contentType.startsWith('image/')) return 'Image'
      if (ordinal.contentType.startsWith('text/')) return 'Text'
      if (ordinal.contentType.includes('json')) return 'JSON'
      return ordinal.contentType.split('/')[1]?.toUpperCase() || 'File'
    }
    return 'Unknown'
  }

  // Confirmation modal for ordinal transfer
  if (showConfirmation) {
    return (
      <ConfirmationModal
        title="Confirm Ordinal Transfer"
        message="You are about to permanently transfer this ordinal. This action cannot be undone."
        details={`Ordinal: ${ordinal.origin}\nTo: ${toAddress}`}
        type="danger"
        confirmText="Transfer"
        cancelText="Go Back"
        onConfirm={executeTransfer}
        onCancel={() => setShowConfirmation(false)}
        confirmDelaySeconds={2}
      />
    )
  }

  if (txid) {
    return (
      <Modal onClose={handleClose} title="Transfer Complete">
        <div className="transfer-success">
          <div className="success-icon">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="28" stroke="#22c55e" strokeWidth="4" />
              <path d="M20 32L28 40L44 24" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h3>Ordinal Transferred!</h3>
          <p className="success-message">
            Your ordinal has been sent to the recipient.
          </p>
          <div className="txid-display">
            <span className="txid-label">Transaction ID:</span>
            <a
              href={`https://whatsonchain.com/tx/${txid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="txid-link"
            >
              {txid.slice(0, 16)}...{txid.slice(-8)}
            </a>
          </div>
          <button type="button" className="primary-button" onClick={handleClose}>
            Close
          </button>
        </div>

        <style>{transferStyles}</style>
      </Modal>
    )
  }

  return (
    <Modal onClose={handleClose} title="Transfer Ordinal">
      <div className="transfer-content">
        {/* Ordinal Preview */}
        <div className="ordinal-preview">
          <div className="ordinal-thumbnail">
            {ordinal.contentType?.startsWith('image/') && ordinal.content ? (
              <img src={ordinal.content} alt="Ordinal" />
            ) : (
              <div className="ordinal-placeholder">
                <span>{getContentTypeDisplay()}</span>
              </div>
            )}
          </div>
          <div className="ordinal-info">
            <span className="ordinal-origin">{ordinal.origin}</span>
            <span className="ordinal-type">{getContentTypeDisplay()}</span>
          </div>
        </div>

        {/* Warning */}
        <div className="transfer-warning">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 2L1 18H19L10 2Z" />
            <path d="M10 8V11M10 14V14.01" />
          </svg>
          <span>
            This action is irreversible. Make sure the recipient address is correct.
          </span>
        </div>

        {/* Recipient Address */}
        <div className="form-group">
          <label htmlFor="recipient-address">Recipient Address</label>
          <input
            id="recipient-address"
            type="text"
            value={toAddress}
            onChange={e => setToAddress(e.target.value)}
            placeholder="Enter BSV address"
            disabled={loading}
            autoFocus
          />
        </div>

        {/* Fee Info */}
        <div className="fee-info">
          <span className="fee-label">Network Fee:</span>
          <span className="fee-value">~200 sats</span>
        </div>

        {error && <p className="error-message">{error}</p>}

        {/* Actions */}
        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            onClick={handleClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-button danger"
            onClick={handleTransferClick}
            disabled={loading || !toAddress.trim()}
          >
            {loading ? 'Transferring...' : 'Transfer Ordinal'}
          </button>
        </div>
      </div>

      <style>{transferStyles}</style>
    </Modal>
  )
}

const transferStyles = `
  .transfer-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .transfer-success {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    text-align: center;
  }

  .success-icon {
    margin-bottom: 0.5rem;
  }

  .transfer-success h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-text, #fff);
  }

  .success-message {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
  }

  .txid-display {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.75rem 1rem;
    background: var(--color-surface, rgba(255, 255, 255, 0.05));
    border-radius: 0.5rem;
    width: 100%;
  }

  .txid-label {
    font-size: 0.75rem;
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.5));
  }

  .txid-link {
    font-family: monospace;
    font-size: 0.8125rem;
    color: var(--color-primary, #f7931a);
    text-decoration: none;
  }

  .txid-link:hover {
    text-decoration: underline;
  }

  .ordinal-preview {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--color-surface, rgba(255, 255, 255, 0.05));
    border-radius: 0.75rem;
  }

  .ordinal-thumbnail {
    width: 64px;
    height: 64px;
    border-radius: 0.5rem;
    overflow: hidden;
    background: var(--color-surface-2, rgba(255, 255, 255, 0.05));
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .ordinal-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .ordinal-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.5));
  }

  .ordinal-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
    min-width: 0;
  }

  .ordinal-origin {
    font-family: monospace;
    font-size: 0.75rem;
    color: var(--color-text, #fff);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ordinal-type {
    font-size: 0.75rem;
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.5));
  }

  .transfer-warning {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    background: rgba(234, 179, 8, 0.1);
    border: 1px solid rgba(234, 179, 8, 0.3);
    border-radius: 0.5rem;
  }

  .transfer-warning svg {
    flex-shrink: 0;
    color: #eab308;
  }

  .transfer-warning span {
    font-size: 0.8125rem;
    color: #eab308;
    line-height: 1.4;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-group label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text, #fff);
  }

  .form-group input {
    padding: 0.75rem;
    background: var(--color-surface, rgba(255, 255, 255, 0.05));
    border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
    border-radius: 0.5rem;
    color: var(--color-text, #fff);
    font-size: 0.875rem;
    font-family: monospace;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .form-group input:focus {
    border-color: var(--color-primary, #f7931a);
  }

  .form-group input::placeholder {
    font-family: inherit;
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.4));
  }

  .fee-info {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 0;
  }

  .fee-label {
    font-size: 0.8125rem;
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
  }

  .fee-value {
    font-size: 0.8125rem;
    color: var(--color-text, #fff);
  }

  .error-message {
    color: var(--color-error, #ef4444);
    font-size: 0.875rem;
    margin: 0;
  }

  .button-row {
    display: flex;
    gap: 0.75rem;
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
    background: linear-gradient(135deg, var(--color-primary, #f7931a), var(--color-secondary, #ff6b00));
    border: none;
    color: white;
  }

  .primary-button.danger {
    background: linear-gradient(135deg, #ef4444, #dc2626);
  }

  .primary-button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(247, 147, 26, 0.3);
  }

  .primary-button.danger:hover:not(:disabled) {
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
  }

  .primary-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .secondary-button {
    background: transparent;
    border: 1px solid var(--color-border, rgba(255, 255, 255, 0.2));
    color: var(--color-text, #fff);
  }

  .secondary-button:hover:not(:disabled) {
    background: var(--color-surface-2, rgba(255, 255, 255, 0.05));
  }

  .secondary-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`
