import { useState, useEffect } from 'react'
import { useUI } from '../../contexts/UIContext'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getTransactionLabels, updateTransactionLabels, getTransactionByTxid } from '../../services/database'
import { getWocClient } from '../../infrastructure/api/wocClient'
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

// Fast path: extract fee from transaction description + amount (no API call)
function parseFee(amount?: number, description?: string): number | null {
  if (!amount || amount >= 0 || !description) return null
  const match = description.match(/(?:Sent|Locked) (\d+) sats/)
  if (!match) return null
  const primaryAmount = parseInt(match[1], 10)
  const fee = Math.abs(amount) - primaryAmount
  return fee > 0 ? fee : null
}

// Slow path: compute fee from blockchain (sum inputs - sum outputs)
async function computeFeeFromBlockchain(txid: string): Promise<number | null> {
  try {
    const wocClient = getWocClient()
    const tx = await wocClient.getTransactionDetails(txid)
    if (!tx) return null

    const totalOut = tx.vout.reduce((sum, o) => sum + Math.round(o.value * 1e8), 0)

    let totalIn = 0
    for (const vin of tx.vin) {
      if (vin.coinbase) return null // coinbase txs have no user-paid fee
      if (vin.txid && vin.vout !== undefined) {
        const prevTx = await wocClient.getTransactionDetails(vin.txid)
        if (prevTx?.vout?.[vin.vout]) {
          totalIn += Math.round(prevTx.vout[vin.vout].value * 1e8)
        }
      }
    }

    const fee = totalIn - totalOut
    return fee > 0 ? fee : null
  } catch {
    return null
  }
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
  const { copyToClipboard, showToast, formatUSD, displayInSats, formatBSVShort } = useUI()
  const [labels, setLabels] = useState<string[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [loading, setLoading] = useState(true)
  const [fee, setFee] = useState<number | null>(null)

  // Load labels, DB record, and compute fee on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [existingLabels, dbRecord] = await Promise.all([
          getTransactionLabels(transaction.tx_hash),
          getTransactionByTxid(transaction.tx_hash)
        ])
        setLabels(existingLabels)

        // Try fast path: description-based fee
        const effectiveAmount = transaction.amount ?? dbRecord?.amount
        const effectiveDescription = transaction.description ?? dbRecord?.description
        const descFee = parseFee(effectiveAmount, effectiveDescription)

        if (descFee !== null) {
          setFee(descFee)
        } else if (effectiveAmount !== undefined && effectiveAmount < 0) {
          // Slow path: compute from blockchain for outgoing txs
          const blockchainFee = await computeFeeFromBlockchain(transaction.tx_hash)
          if (blockchainFee !== null) setFee(blockchainFee)
        }
      } catch (e) {
        uiLogger.warn('Failed to load transaction data', { error: String(e) })
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [transaction.tx_hash, transaction.amount, transaction.description])

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
                {displayInSats
                  ? <>{transaction.amount > 0 ? '+' : ''}{transaction.amount.toLocaleString()} sats</>
                  : <>{transaction.amount > 0 ? '+' : '-'}{formatBSVShort(Math.abs(transaction.amount))} BSV</>
                }
                <span className="tx-detail-usd">
                  (${formatUSD(Math.abs(transaction.amount))})
                </span>
              </span>
            </div>
          )}

          {fee !== null && (
            <div className="tx-detail-row">
              <span className="tx-detail-label">Fee Paid</span>
              <span className="tx-detail-value">
                {displayInSats
                  ? <>{fee.toLocaleString()} sats</>
                  : <>{formatBSVShort(fee)} BSV</>
                }
                <span className="tx-detail-usd">
                  (${formatUSD(fee)})
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

    </Modal>
  )
}
