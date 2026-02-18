import { useState, useMemo, memo, useCallback } from 'react'
import { useUI } from '../../contexts/UIContext'
import { calculateTxFee } from '../../services/wallet'
import type { UTXO as DatabaseUTXO } from '../../infrastructure/database'
import { useUtxoManagement } from '../../hooks/useUtxoManagement'
import { Modal } from '../shared/Modal'

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
      aria-label={`${utxo.satoshis.toLocaleString()} sats from ${utxo.txid.slice(0, 8)}...${utxo.vout}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle(utxo)
        }
      }}
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

  // Load spendable UTXOs via hook
  const spendableFilter = useCallback(
    (u: DatabaseUTXO) => u.spendable && !u.spentAt && (u.basket === 'default' || u.basket === 'derived'),
    []
  )
  const { utxos: rawUtxos, loading } = useUtxoManagement({ filter: spendableFilter })
  const utxos = useMemo(() => [...rawUtxos].sort((a, b) => b.satoshis - a.satoshis), [rawUtxos])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

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
    <Modal title="Coin Control" onClose={onCancel} className="modal-large">
      <div className="modal-content">
        {/* Required amount info */}
        <div className="coin-control-required">
          <div className="coin-control-required-row">
            <span className="coin-control-label">Required amount</span>
            <span className="coin-control-value">{requiredAmount.toLocaleString()} sats</span>
          </div>
          <div className="coin-control-hint">
            (includes estimated network fee)
          </div>
        </div>

        {/* Quick actions */}
        <div className="coin-control-actions">
          <button className="text-btn" onClick={handleAutoSelect}>
            Auto-select
          </button>
          <button className="text-btn" onClick={() => setSelectedIds(new Set())}>
            Deselect all
          </button>
        </div>

        {/* UTXO list */}
        {loading ? (
          <div className="coin-control-empty">
            Loading UTXOs...
          </div>
        ) : utxos.length === 0 ? (
          <div className="coin-control-empty">
            No spendable UTXOs available
          </div>
        ) : (
          <div className="coin-control-list">
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
        <div className={`coin-control-summary ${summary.isEnough ? 'enough' : 'insufficient'}`}>
          <div className="coin-control-summary-row">
            <span className="coin-control-label">Selected</span>
            <span>{summary.count} UTXOs ({summary.total.toLocaleString()} sats)</span>
          </div>
          {!summary.isEnough && summary.count > 0 && (
            <div className="coin-control-warning">
              Need {(requiredAmount - summary.total).toLocaleString()} more sats
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={!summary.isEnough || summary.count === 0}
          >
            Use Selected ({summary.count})
          </button>
        </div>
      </div>
    </Modal>
  )
}
