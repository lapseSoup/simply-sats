import { useState, useEffect } from 'react'
import { useUI } from '../../contexts/UIContext'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getTransactionLabels, updateTransactionLabels, getTransactionByTxid } from '../../services/database'
import { uiLogger } from '../../services/logger'
import { Modal } from '../shared/Modal'

// Common label suggestions for quick selection
const SUGGESTED_LABELS = [
  'personal',
  'business',
  'exchange',
  'gift',
  'refund',
  'salary',
  'subscription',
  'savings'
]

// Extract fee from transaction description + amount
// Works for: "Sent X sats to ...", "Locked X sats until block Y"
function parseFee(amount?: number, description?: string): number | null {
  if (!amount || amount >= 0 || !description) return null
  const match = description.match(/(?:Sent|Locked) (\d+) sats/)
  if (!match) return null
  const primaryAmount = parseInt(match[1], 10)
  const fee = Math.abs(amount) - primaryAmount
  return fee > 0 ? fee : null
}

interface TransactionDetailModalProps {
  transaction: {
    tx_hash: string
    amount?: number
    height: number
    description?: string
  }
  onClose: () => void
  onLabelsUpdated?: () => void
}

export function TransactionDetailModal({
  transaction,
  onClose,
  onLabelsUpdated
}: TransactionDetailModalProps) {
  const { copyToClipboard, showToast, formatUSD } = useUI()
  const [labels, setLabels] = useState<string[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [loading, setLoading] = useState(true)
  // DB-enriched fields (fills gaps when TxHistoryItem lacks description/amount)
  const [dbDescription, setDbDescription] = useState<string | undefined>(undefined)
  const [dbAmount, setDbAmount] = useState<number | undefined>(undefined)

  // Load existing labels + full DB record on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [existingLabels, dbRecord] = await Promise.all([
          getTransactionLabels(transaction.tx_hash),
          getTransactionByTxid(transaction.tx_hash)
        ])
        setLabels(existingLabels)
        if (dbRecord) {
          setDbDescription(dbRecord.description)
          if (dbRecord.amount !== undefined) setDbAmount(dbRecord.amount)
        }
      } catch (e) {
        uiLogger.warn('Failed to load transaction data', { error: String(e) })
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [transaction.tx_hash])

  const openOnWoC = () => {
    openUrl(`https://whatsonchain.com/tx/${transaction.tx_hash}`)
  }

  const handleAddLabel = async (label: string) => {
    const trimmedLabel = label.trim().toLowerCase()
    if (!trimmedLabel || labels.includes(trimmedLabel)) return

    const newLabels = [...labels, trimmedLabel]
    setLabels(newLabels)
    setNewLabel('')

    try {
      await updateTransactionLabels(transaction.tx_hash, newLabels)
      onLabelsUpdated?.()
    } catch (e) {
      uiLogger.error('Failed to update labels', e)
      showToast('Failed to save label')
      // Revert on error
      setLabels(labels)
    }
  }

  const handleRemoveLabel = async (labelToRemove: string) => {
    const newLabels = labels.filter(l => l !== labelToRemove)
    setLabels(newLabels)

    try {
      await updateTransactionLabels(transaction.tx_hash, newLabels)
      onLabelsUpdated?.()
    } catch (e) {
      uiLogger.error('Failed to remove label', e)
      showToast('Failed to remove label')
      // Revert on error
      setLabels([...labels])
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newLabel.trim()) {
      e.preventDefault()
      handleAddLabel(newLabel)
    }
  }

  // Filter suggestions to exclude already-applied labels
  const availableSuggestions = SUGGESTED_LABELS.filter(s => !labels.includes(s))

  return (
    <Modal title="Transaction Details" onClose={onClose}>
      <div className="modal-content">
        {/* Transaction Info */}
        <div className="tx-detail-section">
          <div className="tx-detail-row">
            <span className="tx-detail-label">Transaction ID</span>
            <span className="tx-detail-value tx-detail-mono">
              {transaction.tx_hash.slice(0, 12)}...{transaction.tx_hash.slice(-8)}
            </span>
          </div>

          {transaction.amount !== undefined && (
            <div className="tx-detail-row">
              <span className="tx-detail-label">Amount</span>
              <span className={`tx-detail-value ${transaction.amount > 0 ? 'positive' : 'negative'}`}>
                {transaction.amount > 0 ? '+' : ''}{transaction.amount.toLocaleString()} sats
                <span className="tx-detail-usd">
                  (${formatUSD(Math.abs(transaction.amount))})
                </span>
              </span>
            </div>
          )}

          {(() => {
            // Use DB-enriched values as fallback for fee calculation
            const effectiveAmount = transaction.amount ?? dbAmount
            const effectiveDescription = transaction.description ?? dbDescription
            const fee = parseFee(effectiveAmount, effectiveDescription)
            return fee !== null ? (
              <div className="tx-detail-row">
                <span className="tx-detail-label">Fee Paid</span>
                <span className="tx-detail-value">
                  {fee.toLocaleString()} sats
                  <span className="tx-detail-usd">
                    (${formatUSD(fee)})
                  </span>
                </span>
              </div>
            ) : null
          })()}

          {transaction.height > 0 && (
            <div className="tx-detail-row">
              <span className="tx-detail-label">Block Height</span>
              <span className="tx-detail-value">{transaction.height.toLocaleString()}</span>
            </div>
          )}

          <div className="tx-detail-row">
            <span className="tx-detail-label">Status</span>
            <span className={`tx-detail-value tx-status ${transaction.height > 0 ? 'confirmed' : 'pending'}`}>
              {transaction.height > 0 ? 'Confirmed' : 'Pending'}
            </span>
          </div>
        </div>

        {/* Labels Section */}
        <div className="tx-labels-section">
          <div className="tx-labels-header">Labels</div>

          {loading ? (
            <div className="tx-labels-loading">Loading...</div>
          ) : (
            <>
              {/* Current Labels */}
              <div className="tx-labels-list">
                {labels.length === 0 ? (
                  <span className="tx-labels-empty">No labels yet</span>
                ) : (
                  labels.map(label => (
                    <span key={label} className="tx-label-chip">
                      {label}
                      <button
                        onClick={() => handleRemoveLabel(label)}
                        className="tx-label-remove"
                        aria-label={`Remove ${label} label`}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>

              {/* Add Label Input */}
              <div className="tx-label-input-row">
                <input
                  type="text"
                  className="tx-label-input"
                  placeholder="Add custom label..."
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button
                  className="btn btn-secondary tx-label-add-btn"
                  onClick={() => handleAddLabel(newLabel)}
                  disabled={!newLabel.trim()}
                >
                  Add
                </button>
              </div>

              {/* Quick Suggestions */}
              {availableSuggestions.length > 0 && (
                <div className="tx-suggestions">
                  <div className="tx-suggestions-label">Quick add:</div>
                  <div className="tx-suggestions-list">
                    {availableSuggestions.slice(0, 5).map(suggestion => (
                      <button
                        key={suggestion}
                        onClick={() => handleAddLabel(suggestion)}
                        className="tx-suggestion-btn"
                      >
                        + {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="modal-actions">
          <button
            className="btn btn-secondary"
            onClick={() => copyToClipboard(transaction.tx_hash, 'TXID copied!')}
          >
            Copy TXID
          </button>
          <button className="btn btn-primary" onClick={openOnWoC}>
            View on Explorer
          </button>
        </div>
      </div>

    </Modal>
  )
}
