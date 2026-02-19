import { useState, useRef, useEffect, memo, useCallback, useMemo, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, Lock, Unlock, Circle } from 'lucide-react'
import { List } from 'react-window'
import { useWalletState } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { useLabeledTransactions } from '../../hooks/useTransactionLabels'
import { TransactionDetailModal } from '../modals/TransactionDetailModal'
import { NoTransactionsEmpty } from '../shared/EmptyState'
import { ActivityListSkeleton } from '../shared/Skeleton'

const VIRTUALIZATION_THRESHOLD = 50
const TX_ITEM_HEIGHT = 70 // ~64px item + 6px gap

// Transaction type for the component
type TxHistoryItem = { tx_hash: string; amount?: number; height: number; description?: string }

// Memoized transaction item to prevent unnecessary re-renders
const TransactionItem = memo(function TransactionItem({
  tx,
  txType,
  txIcon,
  onClick,
  formatUSD,
  displayInSats,
  formatBSVShort
}: {
  tx: TxHistoryItem
  txType: string
  txIcon: ReactNode
  onClick: () => void
  formatUSD: (sats: number) => string
  displayInSats: boolean
  formatBSVShort: (sats: number) => string
}) {
  return (
    <div
      className="tx-item"
      onClick={onClick}
      role="listitem"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      style={{ cursor: 'pointer' }}
    >
      <div className="tx-icon" aria-hidden="true">{txIcon}</div>
      <div className="tx-info">
        <div className="tx-type">{txType}</div>
        <div className="tx-meta">
          <span className="tx-hash" title={tx.tx_hash}>{tx.tx_hash.slice(0, 8)}...{tx.tx_hash.slice(-6)}</span>
          {tx.height > 0 && <span>• Block {tx.height.toLocaleString()}</span>}
        </div>
      </div>
      <div className="tx-amount">
        {tx.amount != null ? (
          <>
            <div className={`tx-amount-value ${tx.amount > 0 ? 'positive' : 'negative'}`}>
              {displayInSats
                ? <>{tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()} sats</>
                : <>{tx.amount > 0 ? '+' : ''}{formatBSVShort(Math.abs(tx.amount))} BSV</>
              }
            </div>
            <div className="tx-amount-usd" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              ${formatUSD(Math.abs(tx.amount))}
            </div>
          </>
        ) : (
          <div className="tx-amount-value">View →</div>
        )}
      </div>
    </div>
  )
})

export function ActivityTab() {
  const { txHistory, locks, loading, activeAccountId } = useWalletState()
  const { formatUSD, displayInSats, formatBSVShort } = useUI()

  // Sync is handled by App.tsx checkSync effect — no duplicate sync here
  const [selectedTx, setSelectedTx] = useState<TxHistoryItem | null>(null)

  // Fetch lock/unlock labels via hook (refreshes when txHistory or account changes)
  const { txidsByLabel } = useLabeledTransactions({
    labelNames: ['lock', 'unlock'],
    accountId: activeAccountId ?? undefined,
    refreshKey: txHistory
  })
  const lockTxids = useMemo(() => txidsByLabel.get('lock') ?? new Set<string>(), [txidsByLabel])
  const unlockTxids = useMemo(() => txidsByLabel.get('unlock') ?? new Set<string>(), [txidsByLabel])

  // Virtualization state (hooks must be called unconditionally)
  const shouldVirtualize = txHistory.length >= VIRTUALIZATION_THRESHOLD
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(400)

  // Measure container height for virtualized list
  useEffect(() => {
    if (!shouldVirtualize || !containerRef.current) return
    const el = containerRef.current
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [shouldVirtualize])

  const handleTxClick = useCallback((tx: TxHistoryItem) => {
    setSelectedTx(tx)
  }, [])

  const handleCloseModal = useCallback(() => {
    setSelectedTx(null)
  }, [])

  // Determine transaction type and icon
  // Pre-compute lock txid Set for O(1) lookup (instead of O(n) locks.some per tx row)
  const lockTxidSet = useMemo(() => new Set(locks.map(l => l.txid)), [locks])

  const getTxTypeAndIcon = useCallback((tx: { tx_hash: string; amount?: number }) => {
    // Check active locks from context + historical lock labels from DB
    const isLockTx = lockTxidSet.has(tx.tx_hash) || lockTxids.has(tx.tx_hash)
    const isUnlockTx = unlockTxids.has(tx.tx_hash)

    if (isLockTx) {
      return { type: 'Locked', icon: <Lock size={14} strokeWidth={1.75} /> }
    }
    if (isUnlockTx) {
      return { type: 'Unlocked', icon: <Unlock size={14} strokeWidth={1.75} /> }
    }
    if (tx.amount != null && tx.amount > 0) {
      return { type: 'Received', icon: <ArrowDownLeft size={14} strokeWidth={1.75} /> }
    }
    if (tx.amount != null && tx.amount < 0) {
      return { type: 'Sent', icon: <ArrowUpRight size={14} strokeWidth={1.75} /> }
    }
    return { type: 'Transaction', icon: <Circle size={14} strokeWidth={1.75} /> }
  }, [lockTxidSet, lockTxids, unlockTxids])

  // Show skeleton during initial load (loading with no data yet)
  if (loading && txHistory.length === 0) {
    return (
      <div className="tx-list">
        <ActivityListSkeleton />
      </div>
    )
  }

  if (txHistory.length === 0) {
    return (
      <div className="tx-list">
        <NoTransactionsEmpty />
      </div>
    )
  }

  if (shouldVirtualize) {
    return (
      <>
        <div ref={containerRef} className="tx-list-virtual-container" role="list" aria-label="Transaction history">
          <List
            rowCount={txHistory.length}
            rowHeight={TX_ITEM_HEIGHT}
            rowProps={{}}
            overscanCount={5}
            style={{ height: containerHeight }}
            rowComponent={({ index, style }) => {
              const tx = txHistory[index]!
              const { type: txType, icon: txIcon } = getTxTypeAndIcon(tx)
              return (
                <div style={{ ...style, paddingBottom: 6 }}>
                  <TransactionItem
                    tx={tx}
                    txType={txType}
                    txIcon={txIcon}
                    onClick={() => handleTxClick(tx)}
                    formatUSD={formatUSD}
                    displayInSats={displayInSats}
                    formatBSVShort={formatBSVShort}
                  />
                </div>
              )
            }}
          />
        </div>

        {selectedTx && (
          <TransactionDetailModal
            transaction={selectedTx}
            onClose={handleCloseModal}
          />
        )}
      </>
    )
  }

  return (
    <>
      <div className="tx-list" role="list" aria-label="Transaction history">
        {txHistory.map((tx) => {
          const { type: txType, icon: txIcon } = getTxTypeAndIcon(tx)

          return (
            <TransactionItem
              key={tx.tx_hash}
              tx={tx}
              txType={txType}
              txIcon={txIcon}
              onClick={() => handleTxClick(tx)}
              formatUSD={formatUSD}
              displayInSats={displayInSats}
              formatBSVShort={formatBSVShort}
            />
          )
        })}
      </div>

      {/* Transaction Detail Modal */}
      {selectedTx && (
        <TransactionDetailModal
          transaction={selectedTx}
          onClose={handleCloseModal}
        />
      )}
    </>
  )
}
