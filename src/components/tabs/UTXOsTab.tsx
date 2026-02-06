import { useState, useCallback, useMemo, memo, useEffect } from 'react'
import { Flame, Snowflake, Clock, Lightbulb, ArrowUp, ArrowDown } from 'lucide-react'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import { toggleUtxoFrozen, getAllUTXOs } from '../../services/database'
import type { UTXO as DatabaseUTXO } from '../../services/database'
import { ConsolidateModal } from '../modals/ConsolidateModal'
import { uiLogger } from '../../services/logger'
import { FEATURES, WALLET } from '../../config'

type SortField = 'amount' | 'basket' | 'status'
type SortDirection = 'asc' | 'desc'

// Props interface removed - component is now self-contained

// Memoized UTXO row component
const UTXORow = memo(function UTXORow({
  utxo,
  isSelected,
  onSelect,
  onToggleFreeze,
  formatUSD
}: {
  utxo: DatabaseUTXO
  isSelected: boolean
  onSelect: (utxo: DatabaseUTXO) => void
  onToggleFreeze: (utxo: DatabaseUTXO) => void
  formatUSD: (sats: number) => string
}) {
  const isFrozen = !utxo.spendable

  return (
    <div
      className={`utxo-row ${isFrozen ? 'frozen' : ''} ${isSelected ? 'selected' : ''}`}
      role="listitem"
    >
      <div className="utxo-select">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onSelect(utxo)}
          disabled={isFrozen}
          aria-label={`Select UTXO ${utxo.txid.slice(0, 8)}`}
        />
      </div>

      <div className="utxo-info">
        <div className="utxo-amount">
          {utxo.satoshis.toLocaleString()} sats
          <span className="utxo-usd">${formatUSD(utxo.satoshis)}</span>
        </div>
        <div className="utxo-details">
          <span className="utxo-txid" title={utxo.txid}>
            {utxo.txid.slice(0, 8)}...:{utxo.vout}
          </span>
          <span className={`utxo-basket basket-${utxo.basket}`}>
            {utxo.basket}
          </span>
        </div>
      </div>

      <div className="utxo-actions">
        <button
          className={`utxo-freeze-btn ${isFrozen ? 'unfreezing' : 'freezing'}`}
          onClick={() => onToggleFreeze(utxo)}
          title={isFrozen ? 'Unfreeze UTXO' : 'Freeze UTXO'}
          aria-label={isFrozen ? 'Unfreeze this UTXO' : 'Freeze this UTXO'}
        >
          {isFrozen ? <Flame size={14} strokeWidth={1.75} /> : <Snowflake size={14} strokeWidth={1.75} />}
        </button>
      </div>
    </div>
  )
})

export function UTXOsTab() {
  const { fetchData, activeAccountId } = useWallet()
  const { formatUSD } = useUI()

  const [selectedUtxos, setSelectedUtxos] = useState<Set<string>>(new Set())
  const [sortField, setSortField] = useState<SortField>('amount')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [filterBasket, setFilterBasket] = useState<string>('all')
  const [showFrozen, setShowFrozen] = useState(true)
  const [allUtxos, setAllUtxos] = useState<DatabaseUTXO[]>([])
  const [loadingAll, setLoadingAll] = useState(true) // Start as loading
  const [consolidateUtxos, setConsolidateUtxos] = useState<DatabaseUTXO[] | null>(null)

  // Load all UTXOs including locked ones for the active account
  const loadAllUtxos = useCallback(async () => {
    setLoadingAll(true)
    try {
      const all = await getAllUTXOs(activeAccountId ?? undefined)
      setAllUtxos(all.filter(u => !u.spentAt)) // Only show unspent
    } catch (e) {
      uiLogger.error('Failed to load all UTXOs', e)
    } finally {
      setLoadingAll(false)
    }
  }, [activeAccountId])

  // Load UTXOs on mount
  useEffect(() => {
    loadAllUtxos()
  }, [loadAllUtxos])

  // Use allUtxos from database
  const displayUtxos = allUtxos

  // Get unique baskets
  const baskets = useMemo(() => {
    const basketSet = new Set(displayUtxos.map(u => u.basket))
    return ['all', ...Array.from(basketSet).sort()]
  }, [displayUtxos])

  // Filter and sort UTXOs
  const filteredUtxos = useMemo(() => {
    let filtered = [...displayUtxos]

    // Filter by basket
    if (filterBasket !== 'all') {
      filtered = filtered.filter(u => u.basket === filterBasket)
    }

    // Filter frozen/unfrozen
    if (!showFrozen) {
      filtered = filtered.filter(u => u.spendable)
    }

    // Sort
    filtered.sort((a, b) => {
      let comparison = 0
      switch (sortField) {
        case 'amount':
          comparison = a.satoshis - b.satoshis
          break
        case 'basket':
          comparison = a.basket.localeCompare(b.basket)
          break
        case 'status':
          comparison = (a.spendable ? 1 : 0) - (b.spendable ? 1 : 0)
          break
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })

    return filtered
  }, [displayUtxos, filterBasket, showFrozen, sortField, sortDirection])

  // Summary stats
  const stats = useMemo(() => {
    const total = displayUtxos.reduce((sum, u) => sum + u.satoshis, 0)
    const frozen = displayUtxos.filter(u => !u.spendable)
    const frozenAmount = frozen.reduce((sum, u) => sum + u.satoshis, 0)
    const spendable = displayUtxos.filter(u => u.spendable)
    const spendableAmount = spendable.reduce((sum, u) => sum + u.satoshis, 0)
    const small = displayUtxos.filter(u => u.satoshis < 1000 && u.spendable)

    return {
      total,
      count: displayUtxos.length,
      frozen: frozen.length,
      frozenAmount,
      spendable: spendable.length,
      spendableAmount,
      smallCount: small.length,
      smallAmount: small.reduce((sum, u) => sum + u.satoshis, 0)
    }
  }, [displayUtxos])

  // Selection handlers
  const handleSelect = useCallback((utxo: DatabaseUTXO) => {
    const key = `${utxo.txid}:${utxo.vout}`
    setSelectedUtxos(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    const spendableUtxos = filteredUtxos.filter(u => u.spendable)
    if (selectedUtxos.size === spendableUtxos.length) {
      setSelectedUtxos(new Set())
    } else {
      setSelectedUtxos(new Set(spendableUtxos.map(u => `${u.txid}:${u.vout}`)))
    }
  }, [filteredUtxos, selectedUtxos.size])

  // Toggle freeze handler
  const handleToggleFreeze = useCallback(async (utxo: DatabaseUTXO) => {
    try {
      await toggleUtxoFrozen(utxo.txid, utxo.vout, utxo.spendable) // Toggle: if spendable, freeze it
      await loadAllUtxos() // Refresh
      await fetchData() // Also refresh wallet context
      uiLogger.info(`UTXO ${utxo.spendable ? 'frozen' : 'unfrozen'}: ${utxo.txid.slice(0, 8)}`)
    } catch (e) {
      uiLogger.error('Failed to toggle UTXO freeze', e)
    }
  }, [fetchData, loadAllUtxos])

  // Consolidate handler - opens the modal
  const handleConsolidate = useCallback(() => {
    const selected = filteredUtxos.filter(u => selectedUtxos.has(`${u.txid}:${u.vout}`))
    if (selected.length >= 2) {
      setConsolidateUtxos(selected)
    }
  }, [filteredUtxos, selectedUtxos])

  // Handle consolidate success
  const handleConsolidateSuccess = useCallback(async () => {
    setConsolidateUtxos(null)
    setSelectedUtxos(new Set())
    await loadAllUtxos()
  }, [loadAllUtxos])

  // Sort handler
  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }, [sortField])

  // Selected total
  const selectedTotal = useMemo(() => {
    return filteredUtxos
      .filter(u => selectedUtxos.has(`${u.txid}:${u.vout}`))
      .reduce((sum, u) => sum + u.satoshis, 0)
  }, [filteredUtxos, selectedUtxos])

  if (loadingAll && displayUtxos.length === 0) {
    return (
      <div className="utxos-tab">
        <div className="loading-state">
          <span className="spinner" aria-hidden="true" />
          <span>Loading UTXOs...</span>
        </div>
      </div>
    )
  }

  if (displayUtxos.length === 0) {
    return (
      <div className="utxos-tab">
        <div className="empty-state">
          <div className="empty-icon" aria-hidden="true">
            <Clock size={48} strokeWidth={1.5} style={{ color: 'var(--text-tertiary)' }} />
          </div>
          <div className="empty-title">No UTXOs</div>
          <div className="empty-text">
            Your unspent transaction outputs will appear here.
            Receive some BSV to get started.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="utxos-tab">
      {/* Summary Card */}
      <div className="utxos-summary">
        <div className="utxos-summary-row">
          <div className="utxos-summary-item">
            <span className="utxos-summary-label">Total UTXOs</span>
            <span className="utxos-summary-value">{stats.count}</span>
          </div>
          <div className="utxos-summary-item">
            <span className="utxos-summary-label">Total Value</span>
            <span className="utxos-summary-value">{stats.total.toLocaleString()} sats</span>
          </div>
        </div>
        <div className="utxos-summary-row">
          <div className="utxos-summary-item">
            <span className="utxos-summary-label">Spendable</span>
            <span className="utxos-summary-value positive">{stats.spendable} ({stats.spendableAmount.toLocaleString()} sats)</span>
          </div>
          <div className="utxos-summary-item">
            <span className="utxos-summary-label">Frozen</span>
            <span className="utxos-summary-value">{stats.frozen} ({stats.frozenAmount.toLocaleString()} sats)</span>
          </div>
        </div>
        {stats.smallCount > 0 && (
          <div className="utxos-consolidate-tip">
            <span className="tip-icon"><Lightbulb size={14} strokeWidth={1.75} /></span>
            <span>You have {stats.smallCount} small UTXOs (&lt;1000 sats). Consolidating can reduce future fees.</span>
          </div>
        )}
        {FEATURES.AUTO_CONSOLIDATION && stats.spendable > WALLET.CONSOLIDATION_THRESHOLD && (
          <div className="utxos-consolidate-tip">
            <span className="tip-icon"><Lightbulb size={14} strokeWidth={1.75} /></span>
            <span>You have {stats.spendable} spendable UTXOs. Consider consolidating to reduce future transaction fees.</span>
          </div>
        )}
      </div>

      {/* Filters and Actions */}
      <div className="utxos-toolbar">
        <div className="utxos-filters">
          <select
            value={filterBasket}
            onChange={e => setFilterBasket(e.target.value)}
            className="utxos-filter-select"
            aria-label="Filter by basket"
          >
            {baskets.map(basket => (
              <option key={basket} value={basket}>
                {basket === 'all' ? 'All Baskets' : basket}
              </option>
            ))}
          </select>

          <label className="utxos-filter-checkbox">
            <input
              type="checkbox"
              checked={showFrozen}
              onChange={e => setShowFrozen(e.target.checked)}
            />
            Show Frozen
          </label>
        </div>

        <div className="utxos-sort-buttons">
          <button
            className={`sort-btn ${sortField === 'amount' ? 'active' : ''}`}
            onClick={() => handleSort('amount')}
          >
            Amount {sortField === 'amount' && (sortDirection === 'desc' ? <ArrowDown size={12} strokeWidth={1.75} /> : <ArrowUp size={12} strokeWidth={1.75} />)}
          </button>
          <button
            className={`sort-btn ${sortField === 'basket' ? 'active' : ''}`}
            onClick={() => handleSort('basket')}
          >
            Basket {sortField === 'basket' && (sortDirection === 'desc' ? <ArrowDown size={12} strokeWidth={1.75} /> : <ArrowUp size={12} strokeWidth={1.75} />)}
          </button>
        </div>
      </div>

      {/* Selection Actions */}
      {selectedUtxos.size > 0 && (
        <div className="utxos-selection-bar">
          <span className="selection-info">
            {selectedUtxos.size} selected ({selectedTotal.toLocaleString()} sats)
          </span>
          <div className="selection-actions">
            {selectedUtxos.size >= 2 && (
              <button
                className="btn btn-secondary"
                onClick={handleConsolidate}
              >
                Consolidate ({selectedUtxos.size})
              </button>
            )}
            <button
              className="btn btn-ghost"
              onClick={() => setSelectedUtxos(new Set())}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* UTXO List */}
      <div className="utxos-list-header">
        <div className="utxo-select">
          <input
            type="checkbox"
            checked={selectedUtxos.size > 0 && selectedUtxos.size === filteredUtxos.filter(u => u.spendable).length}
            onChange={handleSelectAll}
            aria-label="Select all spendable UTXOs"
          />
        </div>
        <div className="utxo-info">
          <span>Amount / Details</span>
        </div>
        <div className="utxo-actions">
          <span>Freeze</span>
        </div>
      </div>

      <div className="utxos-list" role="list" aria-label="UTXOs list">
        {filteredUtxos.map(utxo => (
          <UTXORow
            key={`${utxo.txid}:${utxo.vout}`}
            utxo={utxo}
            isSelected={selectedUtxos.has(`${utxo.txid}:${utxo.vout}`)}
            onSelect={handleSelect}
            onToggleFreeze={handleToggleFreeze}
            formatUSD={formatUSD}
          />
        ))}
      </div>

      <div className="utxos-footer">
        <span className="utxos-count">
          Showing {filteredUtxos.length} of {displayUtxos.length} UTXOs
        </span>
      </div>

      {/* Consolidate Modal */}
      {consolidateUtxos && consolidateUtxos.length >= 2 && (
        <ConsolidateModal
          utxos={consolidateUtxos}
          onClose={() => setConsolidateUtxos(null)}
          onSuccess={handleConsolidateSuccess}
        />
      )}
    </div>
  )
}
