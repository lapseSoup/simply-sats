/**
 * OrdinalTransferModal Component
 *
 * Modal for transferring 1Sat Ordinals to another address.
 */

import { useState } from 'react'
import { CircleCheck, AlertTriangle } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { ConfirmationModal } from '../shared/ConfirmationModal'
import type { Ordinal } from '../../services/wallet'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import { calculateTxFee } from '../../services/transactions'

interface OrdinalTransferModalProps {
  ordinal: Ordinal
  onClose: () => void
}

export function OrdinalTransferModal({
  ordinal,
  onClose
}: OrdinalTransferModalProps) {
  const { handleTransferOrdinal, feeRateKB } = useWallet()
  const { showToast } = useUI()

  // Calculate estimated fee dynamically based on current fee rate
  // Ordinal transfer: 1 ordinal input + 1-2 funding inputs, 2 outputs (ordinal + change)
  // Typical: 2 inputs (ordinal + 1 funding), 2 outputs
  const estimatedFee = calculateTxFee(2, 2)
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
            <CircleCheck size={64} strokeWidth={1.5} color="#22c55e" />
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
          <button type="button" className="btn btn-primary" onClick={handleClose}>
            Close
          </button>
        </div>

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
          <AlertTriangle size={20} strokeWidth={1.75} />
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
          <span className="fee-value">~{estimatedFee} sats</span>
          <span className="fee-rate">({feeRateKB} sat/KB)</span>
        </div>

        {error && <p className="error-message">{error}</p>}

        {/* Actions */}
        <div className="button-row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-danger"
            onClick={handleTransferClick}
            disabled={loading || !toAddress.trim()}
          >
            {loading ? 'Transferring...' : 'Transfer Ordinal'}
          </button>
        </div>
      </div>

    </Modal>
  )
}

