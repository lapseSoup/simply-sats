import { useState, useEffect } from 'react'
import { useUI } from '../../contexts/UIContext'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getTransactionLabels, updateTransactionLabels } from '../../services/database'
import { uiLogger } from '../../services/logger'

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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header">
          <h2 className="modal-title">Transaction Details</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          {/* Transaction Info */}
          <div className="tx-detail-section">
            <div className="tx-detail-row">
              <span className="tx-detail-label">Transaction ID</span>
              <span className="tx-detail-value mono" style={{ fontSize: 11 }}>
                {transaction.tx_hash.slice(0, 16)}...{transaction.tx_hash.slice(-8)}
              </span>
            </div>

            {transaction.amount !== undefined && (
              <div className="tx-detail-row">
                <span className="tx-detail-label">Amount</span>
                <span className={`tx-detail-value ${transaction.amount > 0 ? 'positive' : 'negative'}`}>
                  {transaction.amount > 0 ? '+' : ''}{transaction.amount.toLocaleString()} sats
                  <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>
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
              <span className="tx-detail-value">
                {transaction.height > 0 ? 'Confirmed' : 'Pending'}
              </span>
            </div>
          </div>

          {/* Labels Section */}
          <div className="tx-labels-section" style={{ marginTop: 16 }}>
            <div className="tx-detail-label" style={{ marginBottom: 8 }}>Labels</div>

            {loading ? (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Loading...</div>
            ) : (
              <>
                {/* Current Labels */}
                <div className="tx-labels-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  {labels.length === 0 ? (
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>No labels yet</span>
                  ) : (
                    labels.map(label => (
                      <span
                        key={label}
                        className="tx-label-chip"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 10px',
                          borderRadius: 12,
                          background: 'var(--primary-bg)',
                          border: '1px solid var(--primary)',
                          color: 'var(--primary)',
                          fontSize: 12
                        }}
                      >
                        {label}
                        <button
                          onClick={() => handleRemoveLabel(label)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--primary)',
                            cursor: 'pointer',
                            padding: 0,
                            marginLeft: 2,
                            fontSize: 14,
                            lineHeight: 1
                          }}
                          aria-label={`Remove ${label} label`}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}
                </div>

                {/* Add Label Input */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Add custom label..."
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    onKeyDown={handleKeyDown}
                    style={{ flex: 1, fontSize: 13 }}
                  />
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleAddLabel(newLabel)}
                    disabled={!newLabel.trim()}
                    style={{ padding: '8px 16px' }}
                  >
                    Add
                  </button>
                </div>

                {/* Quick Suggestions */}
                {availableSuggestions.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>
                      Quick add:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {availableSuggestions.slice(0, 5).map(suggestion => (
                        <button
                          key={suggestion}
                          onClick={() => handleAddLabel(suggestion)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 12,
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            color: 'var(--text-secondary)',
                            fontSize: 11,
                            cursor: 'pointer'
                          }}
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
          <div className="tx-detail-actions" style={{ marginTop: 20, display: 'flex', gap: 8 }}>
            <button
              className="btn btn-secondary"
              onClick={() => copyToClipboard(transaction.tx_hash, 'TXID copied!')}
              style={{ flex: 1 }}
            >
              Copy TXID
            </button>
            <button
              className="btn btn-primary"
              onClick={openOnWoC}
              style={{ flex: 1 }}
            >
              View on Explorer
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
