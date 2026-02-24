import { useState, useMemo } from 'react'
import { CircleCheck, AlertTriangle } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { useWalletState, useWalletActions } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { consolidateUtxos, calculateTxFee } from '../../services/wallet'
import type { UTXO as DatabaseUTXO } from '../../infrastructure/database'
import { uiLogger } from '../../services/logger'

interface ConsolidateModalProps {
  utxos: DatabaseUTXO[]
  onClose: () => void
  onSuccess: (txid: string) => void
}

export function ConsolidateModal({ utxos, onClose, onSuccess }: ConsolidateModalProps) {
  const { wallet, activeAccountId } = useWalletState()
  const { fetchData, performSync } = useWalletActions()
  const { formatUSD } = useUI()
  const [status, setStatus] = useState<'preview' | 'confirming' | 'success' | 'error'>('preview')
  const [error, setError] = useState<string | null>(null)
  const [txid, setTxid] = useState<string | null>(null)

  // Calculate totals
  const summary = useMemo(() => {
    const totalInput = utxos.reduce((sum, u) => sum + u.satoshis, 0)
    const fee = calculateTxFee(utxos.length, 1)
    const output = totalInput - fee

    return {
      inputCount: utxos.length,
      totalInput,
      fee,
      output,
      savings: `${utxos.length - 1} fewer UTXOs`
    }
  }, [utxos])

  const handleConsolidate = async () => {
    if (!wallet) {
      setError('Wallet not available')
      return
    }

    setStatus('confirming')
    setError(null)

    // Prepare UTXOs for consolidation
    const utxoIds = utxos.map(u => ({
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      script: u.lockingScript
    }))

    // S-21: Transaction is built and signed entirely in Rust via the key store.
    // No WIF is retrieved or passed through the JS context.
    const result = await consolidateUtxos(utxoIds, activeAccountId ?? undefined)
    if (!result.ok) {
      uiLogger.error('Consolidation failed', result.error)
      setError(result.error.message)
      setStatus('error')
      return
    }

    setTxid(result.value.txid)
    setStatus('success')

    // Refresh wallet data from local DB instantly
    await fetchData()
    // Background sync to confirm balance from blockchain
    void performSync()

    uiLogger.info('Consolidation successful', { txid: result.value.txid })
  }

  const handleDone = () => {
    if (txid) {
      onSuccess(txid)
    }
    onClose()
  }

  const title = status === 'success' ? 'Consolidation Complete' : 'Consolidate UTXOs'

  return (
    <Modal onClose={onClose} title={title}>
      <div className="modal-content">
        {status === 'success' ? (
          <div className="consolidate-success" style={{ textAlign: 'center' }}>
            <div className="result-icon-circle success">
              <CircleCheck size={32} strokeWidth={1.5} color="var(--success)" />
            </div>
            <div className="result-title success">UTXOs Consolidated!</div>
            <div className="result-message">
              {summary.inputCount} UTXOs combined into 1
            </div>
            <div className="result-address-block">{txid}</div>
            <button className="btn btn-primary" onClick={handleDone} style={{ width: '100%' }}>
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="consolidate-summary" style={{ marginBottom: 20 }}>
              <div className="consolidate-summary-row">
                <span className="label">UTXOs to combine</span>
                <span className="value">{summary.inputCount}</span>
              </div>
              <div className="consolidate-summary-row">
                <span className="label">Total input</span>
                <span>{summary.totalInput.toLocaleString()} sats</span>
              </div>
              <div className="consolidate-summary-row">
                <span className="label">Network fee</span>
                <span className="value fee">-{summary.fee.toLocaleString()} sats</span>
              </div>
              <div className="consolidate-divider">
                <div className="consolidate-summary-row">
                  <span className="value">Output amount</span>
                  <div style={{ textAlign: 'right' }}>
                    <div className="value">{summary.output.toLocaleString()} sats</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      ${formatUSD(summary.output)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Info */}
            <div className="consolidate-info-box">
              <strong>Why consolidate?</strong>
              <ul>
                <li>Reduces future transaction fees</li>
                <li>Simplifies wallet management</li>
                <li>Cleans up small dust UTXOs</li>
              </ul>
            </div>

            {/* Error */}
            {error && (
              <div className="warning compact" role="alert" style={{ marginBottom: 16 }}>
                <span className="warning-icon"><AlertTriangle size={16} strokeWidth={1.75} /></span>
                <span className="warning-text">{error}</span>
              </div>
            )}

            {/* Actions */}
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={onClose}
                disabled={status === 'confirming'}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleConsolidate}
                disabled={status === 'confirming' || summary.output <= 0}
              >
                {status === 'confirming' ? 'Consolidating...' : 'Consolidate'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
