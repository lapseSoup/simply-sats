/**
 * OrdinalListModal Component
 *
 * Modal for listing 1Sat Ordinals for sale using OrdinalLock contracts.
 */

import { useState } from 'react'
import { CircleCheck, AlertTriangle } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { ConfirmationModal } from '../shared/ConfirmationModal'
import { OrdinalImage } from '../shared/OrdinalImage'
import type { Ordinal } from '../../services/wallet'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import { calculateTxFee } from '../../services/wallet/fees'

interface OrdinalListModalProps {
  ordinal: Ordinal
  onClose: () => void
}

export function OrdinalListModal({
  ordinal,
  onClose
}: OrdinalListModalProps) {
  const { handleListOrdinal, feeRateKB } = useWallet()
  const { showToast } = useUI()

  // Listing fee: 1 ordinal input + 1-2 funding inputs, 2 outputs (locked ordinal + change)
  const estimatedFee = calculateTxFee(2, 2)
  const [priceSats, setPriceSats] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [txid, setTxid] = useState<string | null>(null)
  const [showConfirmation, setShowConfirmation] = useState(false)

  const handleListClick = () => {
    const price = parseInt(priceSats, 10)
    if (!price || price <= 0 || isNaN(price)) {
      setError('Please enter a valid price in satoshis')
      return
    }
    setShowConfirmation(true)
  }

  const executeListing = async () => {
    setShowConfirmation(false)
    setLoading(true)
    setError('')

    const price = parseInt(priceSats, 10)
    const result = await handleListOrdinal(ordinal, price)

    if (result.success && result.txid) {
      setTxid(result.txid)
      showToast('Ordinal listed for sale!')
    } else {
      setError(result.error || 'Listing failed')
    }

    setLoading(false)
  }

  const handleClose = () => {
    setPriceSats('')
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

  // Confirmation modal
  if (showConfirmation) {
    return (
      <ConfirmationModal
        title="Confirm Listing"
        message="This will create an on-chain lock contract for your ordinal. Anyone can purchase it by paying the listed price. You can cancel the listing later (costs a fee)."
        details={`Ordinal: ${ordinal.origin}\nPrice: ${parseInt(priceSats, 10).toLocaleString()} sats`}
        type="warning"
        confirmText="List for Sale"
        cancelText="Go Back"
        onConfirm={executeListing}
        onCancel={() => setShowConfirmation(false)}
        confirmDelaySeconds={2}
      />
    )
  }

  // Success screen
  if (txid) {
    return (
      <Modal onClose={handleClose} title="Listing Complete">
        <div className="transfer-success">
          <div className="success-icon">
            <CircleCheck size={64} strokeWidth={1.5} color="#22c55e" />
          </div>
          <h3>Ordinal Listed!</h3>
          <p className="success-message">
            Your ordinal is now listed for sale at {parseInt(priceSats, 10).toLocaleString()} sats.
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

  // Main form
  return (
    <Modal onClose={handleClose} title="List Ordinal for Sale">
      <div className="transfer-content">
        {/* Ordinal Preview */}
        <div className="transfer-ordinal-preview">
          <OrdinalImage
            origin={ordinal.origin}
            contentType={ordinal.contentType}
            size="md"
            alt="Ordinal"
            lazy={false}
          />
          <div className="ordinal-info">
            <span className="ordinal-origin">{ordinal.origin}</span>
            <span className="ordinal-type">{getContentTypeDisplay()}</span>
          </div>
        </div>

        {/* Info */}
        <div className="transfer-warning">
          <AlertTriangle size={20} strokeWidth={1.75} />
          <span>
            Listing locks your ordinal in a smart contract. You can cancel the listing later.
          </span>
        </div>

        {/* Price Input */}
        <div className="form-group">
          <label htmlFor="listing-price">Price (satoshis)</label>
          <input
            id="listing-price"
            type="number"
            className="form-input"
            value={priceSats}
            onChange={e => setPriceSats(e.target.value)}
            placeholder="Enter price in satoshis"
            min="1"
            step="1"
            disabled={loading}
            autoFocus
          />
        </div>

        {/* Fee Info */}
        <div className="fee-info">
          <span className="fee-label">Listing Fee:</span>
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
            className="btn btn-primary"
            onClick={handleListClick}
            disabled={loading || !priceSats.trim()}
          >
            {loading ? 'Listing...' : 'List for Sale'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
