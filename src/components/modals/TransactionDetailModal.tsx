import { useState, useEffect } from 'react'
import { useUI } from '../../contexts/UIContext'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getTransactionLabels, updateTransactionLabels } from '../../services/database'
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

interface TransactionDetailModalProps {
  transaction: {
    tx_hash: string
    amount?: number
    height: number
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

  // Load existing labels on mount
  useEffect(() => {
    const loadLabels = async () => {
      try {
        const existingLabels = await getTransactionLabels(transaction.tx_hash)
        setLabels(existingLabels)
      } catch (e) {
        uiLogger.warn('Failed to load transaction labels', { error: String(e) })
      } finally {
        setLoading(false)
      }
    }
    loadLabels()
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

      <style>{`
        .tx-detail-section {
          background: var(--bg-secondary);
          border-radius: var(--radius-md);
          padding: 16px;
          margin-bottom: 20px;
        }

        .tx-detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 0;
          border-bottom: 1px solid var(--border);
        }

        .tx-detail-row:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }

        .tx-detail-row:first-child {
          padding-top: 0;
        }

        .tx-detail-label {
          color: var(--text-secondary);
          font-size: 13px;
        }

        .tx-detail-value {
          font-weight: 500;
          font-size: 14px;
        }

        .tx-detail-mono {
          font-family: var(--font-mono);
          font-size: 12px;
        }

        .tx-detail-usd {
          color: var(--text-tertiary);
          margin-left: 8px;
          font-weight: 400;
        }

        .tx-detail-value.positive {
          color: var(--success);
        }

        .tx-detail-value.negative {
          color: var(--error);
        }

        .tx-status.confirmed {
          color: var(--success);
        }

        .tx-status.pending {
          color: var(--accent);
        }

        .tx-labels-section {
          margin-bottom: 20px;
        }

        .tx-labels-header {
          font-weight: 600;
          margin-bottom: 12px;
        }

        .tx-labels-loading,
        .tx-labels-empty {
          color: var(--text-tertiary);
          font-size: 13px;
        }

        .tx-labels-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 16px;
        }

        .tx-label-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 16px;
          background: rgba(247, 147, 26, 0.1);
          border: 1px solid var(--accent);
          color: var(--accent);
          font-size: 13px;
        }

        .tx-label-remove {
          background: none;
          border: none;
          color: var(--accent);
          cursor: pointer;
          padding: 0;
          font-size: 16px;
          line-height: 1;
          opacity: 0.7;
          transition: opacity 0.15s ease;
        }

        .tx-label-remove:hover {
          opacity: 1;
        }

        .tx-label-input-row {
          display: flex;
          gap: 10px;
          margin-bottom: 16px;
        }

        .tx-label-input {
          flex: 1;
          padding: 10px 14px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: 14px;
          outline: none;
          transition: border-color 0.15s ease;
        }

        .tx-label-input:focus {
          border-color: var(--accent);
        }

        .tx-label-input::placeholder {
          color: var(--text-tertiary);
        }

        .tx-label-add-btn {
          padding: 10px 20px !important;
          width: auto !important;
        }

        .tx-suggestions {
          margin-top: 8px;
        }

        .tx-suggestions-label {
          font-size: 12px;
          color: var(--text-tertiary);
          margin-bottom: 8px;
        }

        .tx-suggestions-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .tx-suggestion-btn {
          padding: 6px 12px;
          border-radius: 16px;
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text-secondary);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .tx-suggestion-btn:hover {
          background: var(--bg-secondary);
          border-color: var(--text-tertiary);
          color: var(--text-primary);
        }
      `}</style>
    </Modal>
  )
}
