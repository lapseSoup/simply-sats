import { useState, useMemo, memo, useEffect, useCallback } from 'react'
import { useUI } from '../../contexts/UIContext'
import { getAllUTXOs } from '../../services/database'
import { calculateTxFee } from '../../services/wallet'
import type { UTXO as DatabaseUTXO } from '../../services/database'
import { uiLogger } from '../../services/logger'

interface CoinControlModalProps {
  requiredAmount: number  // Amount being sent + estimated fee
  onConfirm: (utxos: DatabaseUTXO[]) => void
  onCancel: () => void
}

// Compact UTXO row for selection
const UTXOSelectRow = memo(function UTXOSelectRow({
  utxo,
  isSelected,
  onToggle,
  formatUSD
}: {
  utxo: DatabaseUTXO
  isSelected: boolean
  onToggle: (utxo: DatabaseUTXO) => void
  formatUSD: (sats: number) => string
}) {
  return (
    <div
      className={`coin-control-row ${isSelected ? 'selected' : ''}`}
      onClick={() => onToggle(utxo)}
      role="checkbox"
      aria-checked={isSelected}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onToggle(utxo)}
    >
      <div className="coin-control-checkbox">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(utxo)}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <div className="coin-control-info">
        <div className="coin-control-amount">
          {utxo.satoshis.toLocaleString()} sats
        </div>
        <div className="coin-control-details">
          <span className="coin-control-txid">{utxo.txid.slice(0, 8)}...:{utxo.vout}</span>
          <span className="coin-control-usd">${formatUSD(utxo.satoshis)}</span>
        </div>
      </div>
    </div>
  )
})

export function CoinControlModal({ requiredAmount, onConfirm, onCancel }: CoinControlModalProps) {
  const { formatUSD } = useUI()

  const [utxos, setUtxos] = useState<DatabaseUTXO[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  // Load spendable UTXOs
  useEffect(() => {
    const loadUtxos = async () => {
      setLoading(true)
      try {
        const all = await getAllUTXOs()
        // Only show spendable, unspent UTXOs from default and derived baskets
        const spendable = all.filter(u =>
          u.spendable &&
          !u.spentAt &&
          (u.basket === 'default' || u.basket === 'derived')
        )
        // Sort by amount descending
        spendable.sort((a, b) => b.satoshis - a.satoshis)
        setUtxos(spendable)
      } catch (e) {
        uiLogger.error('Failed to load UTXOs for coin control', e)
      } finally {
        setLoading(false)
      }
    }
    loadUtxos()
  }, [])

  // Toggle UTXO selection
  const handleToggle = useCallback((utxo: DatabaseUTXO) => {
    const key = `${utxo.txid}:${utxo.vout}`
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  // Select all
  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === utxos.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(utxos.map(u => `${u.txid}:${u.vout}`)))
    }
  }, [utxos, selectedIds.size])

  // Auto-select optimal UTXOs to meet required amount
  const handleAutoSelect = useCallback(() => {
    const selected = new Set<string>()
    let total = 0

    // Select UTXOs from largest to smallest until we have enough
    for (const utxo of utxos) {
      if (total >= requiredAmount) break
      selected.add(`${utxo.txid}:${utxo.vout}`)
      total += utxo.satoshis
    }

    setSelectedIds(selected)
  }, [utxos, requiredAmount])

  // Calculate selection summary
  const summary = useMemo(() => {
    const selectedUtxos = utxos.filter(u => selectedIds.has(`${u.txid}:${u.vout}`))
    const totalSelected = selectedUtxos.reduce((sum, u) => sum + u.satoshis, 0)
    const estimatedFee = calculateTxFee(selectedUtxos.length || 1, 2) // 2 outputs (recipient + change)
    const changeAmount = totalSelected - requiredAmount

    return {
      count: selectedUtxos.length,
      total: totalSelected,
      estimatedFee,
      changeAmount,
      isEnough: totalSelected >= requiredAmount,
      selectedUtxos
    }
  }, [utxos, selectedIds, requiredAmount])

  // Confirm selection
  const handleConfirm = () => {
    if (summary.isEnough && summary.selectedUtxos.length > 0) {
      onConfirm(summary.selectedUtxos)
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-large" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header">
          <h2 className="modal-title">Coin Control</h2>
          <button className="modal-close" onClick={onCancel} aria-label="Close">×</button>
        </div>

        <div className="modal-content">
          {/* Required amount info */}
          <div style={{
            background: 'var(--bg-secondary)',
            padding: 12,
            borderRadius: 8,
            marginBottom: 16
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Required amount</span>
              <span style={{ fontWeight: 600 }}>{requiredAmount.toLocaleString()} sats</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              (includes estimated network fee)
            </div>
          </div>

          {/* Quick actions */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              className="btn btn-ghost"
              onClick={handleAutoSelect}
              style={{ flex: 1, fontSize: 12 }}
            >
              Auto-select
            </button>
            <button
              className="btn btn-ghost"
              onClick={handleSelectAll}
              style={{ flex: 1, fontSize: 12 }}
            >
              {selectedIds.size === utxos.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>

          {/* UTXO list */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
              Loading UTXOs...
            </div>
          ) : utxos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
              No spendable UTXOs available
            </div>
          ) : (
            <div className="coin-control-list" style={{
              maxHeight: 300,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 8
            }}>
              {utxos.map(utxo => (
                <UTXOSelectRow
                  key={`${utxo.txid}:${utxo.vout}`}
                  utxo={utxo}
                  isSelected={selectedIds.has(`${utxo.txid}:${utxo.vout}`)}
                  onToggle={handleToggle}
                  formatUSD={formatUSD}
                />
              ))}
            </div>
          )}

          {/* Selection summary */}
          <div style={{
            marginTop: 16,
            padding: 12,
            background: summary.isEnough ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            borderRadius: 8
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Selected</span>
              <span>{summary.count} UTXOs ({summary.total.toLocaleString()} sats)</span>
            </div>
            {summary.count > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Est. fee ({summary.count} inputs)</span>
                  <span>{summary.estimatedFee.toLocaleString()} sats</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Change</span>
                  <span style={{ color: summary.changeAmount < 0 ? 'var(--error)' : 'inherit' }}>
                    {summary.changeAmount.toLocaleString()} sats
                  </span>
                </div>
              </>
            )}
            {!summary.isEnough && summary.count > 0 && (
              <div style={{
                marginTop: 8,
                padding: 8,
                background: 'rgba(239, 68, 68, 0.1)',
                borderRadius: 4,
                color: 'var(--error)',
                fontSize: 12
              }}>
                Need {(requiredAmount - summary.total).toLocaleString()} more sats
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button
              className="btn btn-secondary"
              onClick={onCancel}
              style={{ flex: 1 }}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={!summary.isEnough || summary.count === 0}
              style={{ flex: 1 }}
            >
              Use Selected ({summary.count})
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
