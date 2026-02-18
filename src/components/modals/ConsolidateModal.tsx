import { useState, useMemo } from 'react'
import { CircleCheck, AlertTriangle } from 'lucide-react'
import { useWalletState, useWalletActions } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { consolidateUtxos, getWifForOperation } from '../../services/wallet'
import { calculateTxFee } from '../../services/wallet'
import type { UTXO as DatabaseUTXO } from '../../infrastructure/database'
import { uiLogger } from '../../services/logger'

interface ConsolidateModalProps {
  utxos: DatabaseUTXO[]
  onClose: () => void
  onSuccess: (txid: string) => void
}

export function ConsolidateModal({ utxos, onClose, onSuccess }: ConsolidateModalProps) {
  const { wallet } = useWalletState()
  const { fetchData } = useWalletActions()
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

    try {
      // Prepare UTXOs for consolidation
      const utxoIds = utxos.map(u => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.lockingScript
      }))

      const walletWif = await getWifForOperation('wallet', 'consolidateUTXOs', wallet)
      const result = await consolidateUtxos(walletWif, utxoIds)

      setTxid(result.txid)
      setStatus('success')

      // Refresh wallet data
      await fetchData()

      uiLogger.info('Consolidation successful', { txid: result.txid })
    } catch (err) {
      uiLogger.error('Consolidation failed', err)
      setError(err instanceof Error ? err.message : 'Consolidation failed')
      setStatus('error')
    }
  }

  const handleDone = () => {
    if (txid) {
      onSuccess(txid)
    }
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header">
          <h2 className="modal-title">
            {status === 'success' ? 'Consolidation Complete' : 'Consolidate UTXOs'}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-content">
          {status === 'success' ? (
            <div className="consolidate-success" style={{ textAlign: 'center' }}>
              <div style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'rgba(34, 197, 94, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px'
              }}>
                <CircleCheck size={32} strokeWidth={1.5} color="#22c55e" />
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--success)', marginBottom: 8 }}>
                UTXOs Consolidated!
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
                {summary.inputCount} UTXOs combined into 1
              </div>
              <div style={{
                background: 'var(--bg-secondary)',
                padding: 12,
                borderRadius: 8,
                marginBottom: 20,
                fontSize: 11,
                fontFamily: 'monospace',
                wordBreak: 'break-all'
              }}>
                {txid}
              </div>
              <button className="btn btn-primary" onClick={handleDone} style={{ width: '100%' }}>
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Summary */}
              <div className="consolidate-summary" style={{ marginBottom: 20 }}>
                <div className="summary-row" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>UTXOs to combine</span>
                  <span style={{ fontWeight: 600 }}>{summary.inputCount}</span>
                </div>
                <div className="summary-row" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Total input</span>
                  <span>{summary.totalInput.toLocaleString()} sats</span>
                </div>
                <div className="summary-row" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Network fee</span>
                  <span style={{ color: 'var(--warning)' }}>-{summary.fee.toLocaleString()} sats</span>
                </div>
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
                  <div className="summary-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600 }}>Output amount</span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 600 }}>{summary.output.toLocaleString()} sats</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        ${formatUSD(summary.output)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Info */}
              <div style={{
                background: 'var(--bg-secondary)',
                padding: 12,
                borderRadius: 8,
                marginBottom: 16,
                fontSize: 12,
                color: 'var(--text-secondary)'
              }}>
                <strong>Why consolidate?</strong>
                <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
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
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  className="btn btn-secondary"
                  onClick={onClose}
                  style={{ flex: 1 }}
                  disabled={status === 'confirming'}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleConsolidate}
                  style={{ flex: 1 }}
                  disabled={status === 'confirming' || summary.output <= 0}
                >
                  {status === 'confirming' ? 'Consolidating...' : 'Consolidate'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
