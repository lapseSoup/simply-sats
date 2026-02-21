import { useState, useRef, useEffect, memo, useCallback, useMemo, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, Lock, Unlock, Circle } from 'lucide-react'
import { List } from 'react-window'
import { useWalletState, useSyncContext } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { useLabeledTransactions } from '../../hooks/useTransactionLabels'
import { TransactionDetailModal } from '../modals/TransactionDetailModal'
import { NoTransactionsEmpty } from '../shared/EmptyState'
import { ActivityListSkeleton } from '../shared/Skeleton'
import { OrdinalImage } from '../shared/OrdinalImage'

const VIRTUALIZATION_THRESHOLD = 50
const TX_ITEM_HEIGHT = 70 // ~64px item + 6px gap

// Transaction type for the component
type TxHistoryItem = { tx_hash: string; amount?: number; height: number; description?: string; createdAt?: number }

// Memoized transaction item to prevent unnecessary re-renders
const TransactionItem = memo(function TransactionItem({
  tx,
  txType,
  txIcon,
  onClick,
  formatUSD,
  displayInSats,
  formatBSVShort,
  ordinalOrigin,
  ordinalContentType,
  ordinalCachedContent
}: {
  tx: TxHistoryItem
  txType: string
  txIcon: ReactNode
  onClick: () => void
  formatUSD: (sats: number) => string
  displayInSats: boolean
  formatBSVShort: (sats: number) => string
  ordinalOrigin?: string
  ordinalContentType?: string
  ordinalCachedContent?: { contentData?: Uint8Array; contentText?: string; contentType?: string }
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
      <div className="tx-icon" aria-hidden="true">
        {ordinalOrigin ? (
          <div style={{ width: 40, height: 40, borderRadius: 6, overflow: 'hidden', flexShrink: 0, margin: -4 }}>
            <OrdinalImage
              origin={ordinalOrigin}
              contentType={ordinalContentType}
              size="sm"
              alt="Ordinal"
              lazy={false}
              cachedContent={ordinalCachedContent}
            />
          </div>
        ) : txIcon}
      </div>
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
  const { txHistory, locks, loading, activeAccountId, ordinals, ordinalContentCache } = useWalletState()
  const { fetchOrdinalContentIfMissing } = useSyncContext()
  const { formatUSD, displayInSats, formatBSVShort } = useUI()

  // Sync is handled by App.tsx checkSync effect — no duplicate sync here
  const [selectedTx, setSelectedTx] = useState<TxHistoryItem | null>(null)

  // Fetch lock/unlock/ordinal labels via hook (refreshes when txHistory or account changes)
  const { txidsByLabel } = useLabeledTransactions({
    labelNames: ['lock', 'unlock', 'ordinal'],
    accountId: activeAccountId ?? undefined,
    refreshKey: txHistory
  })
  const lockTxids = useMemo(() => txidsByLabel.get('lock') ?? new Set<string>(), [txidsByLabel])
  const unlockTxids = useMemo(() => txidsByLabel.get('unlock') ?? new Set<string>(), [txidsByLabel])
  const ordinalTxids = useMemo(() => txidsByLabel.get('ordinal') ?? new Set<string>(), [txidsByLabel])

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

  // Build a map from ordinal origin → ordinal, for thumbnail lookup in activity items.
  // New description format: "Transferred ordinal {txid}_{vout} to {addr}..."
  // Legacy format (fallback): "Transferred ordinal {txid.slice(0,8)}... to {addr}..."
  const ordinalByOrigin = useMemo(() => {
    const map = new Map<string, typeof ordinals[number]>()
    for (const ord of ordinals) {
      map.set(ord.origin, ord)
    }
    return map
  }, [ordinals])

  // Build reverse map: receive txid → ordinal, for detecting received ordinals in activity feed.
  // Covers owned ordinals (transferred=0); once transferred, the receive tx reverts to plain "Received".
  const ordinalByTxid = useMemo(() => {
    const map = new Map<string, typeof ordinals[number]>()
    for (const ord of ordinals) {
      map.set(ord.txid, ord)
    }
    return map
  }, [ordinals])

  // Collect origins of transferred ordinals whose content is not yet in the cache.
  // After a fresh seed restore ordinal_cache is empty, so we need to lazily fetch
  // content from GorillaPool for any ordinal transfer activity items.
  const missingTransferOrigins = useMemo(() => {
    const missing: Array<{ origin: string; contentType?: string }> = []
    for (const tx of txHistory) {
      const m = tx.description?.match(/Transferred ordinal ([0-9a-f]{64}_\d+)/)
      if (m) {
        const origin = m[1]!
        if (!ordinalContentCache.has(origin)) {
          missing.push({ origin, contentType: ordinalByOrigin.get(origin)?.contentType })
        }
      }
    }
    return missing
  }, [txHistory, ordinalContentCache, ordinalByOrigin])

  // Trigger lazy fetches for missing transferred ordinal content (fire-and-forget).
  // Pass activeAccountId so the DB row is saved with the correct account_id and
  // found by account-scoped queries on subsequent app launches (not re-fetched every time).
  useEffect(() => {
    for (const { origin, contentType } of missingTransferOrigins) {
      void fetchOrdinalContentIfMissing(origin, contentType, activeAccountId ?? undefined)
    }
  }, [missingTransferOrigins, fetchOrdinalContentIfMissing, activeAccountId])

  const getTxTypeAndIcon = useCallback((tx: { tx_hash: string; amount?: number; description?: string }) => {
    // Check active locks from context + historical lock labels from DB
    const isLockTx = lockTxidSet.has(tx.tx_hash) || lockTxids.has(tx.tx_hash)
    const isUnlockTx = unlockTxids.has(tx.tx_hash)
    // Fallback: description-based detection for restored wallets where transaction_labels
    // may not have been re-created (ordinal labels are only written during live transfers)
    const isOrdinalTx = ordinalTxids.has(tx.tx_hash)
      || /Transferred ordinal [0-9a-f]{64}_\d+/.test(tx.description ?? '')
    const isOrdinalReceiveTx = ordinalByTxid.has(tx.tx_hash)

    if (isLockTx) {
      return { type: 'Locked', icon: <Lock size={14} strokeWidth={1.75} /> }
    }
    if (isUnlockTx) {
      return { type: 'Unlocked', icon: <Unlock size={14} strokeWidth={1.75} /> }
    }
    if (isOrdinalTx) {
      return { type: 'Ordinal Transfer', icon: null }
    }
    if (isOrdinalReceiveTx) {
      return { type: 'Ordinal Received', icon: null }
    }
    if (tx.amount != null && tx.amount > 0) {
      return { type: 'Received', icon: <ArrowDownLeft size={14} strokeWidth={1.75} /> }
    }
    if (tx.amount != null && tx.amount < 0) {
      return { type: 'Sent', icon: <ArrowUpRight size={14} strokeWidth={1.75} /> }
    }
    return { type: 'Transaction', icon: <Circle size={14} strokeWidth={1.75} /> }
  }, [lockTxidSet, lockTxids, unlockTxids, ordinalTxids, ordinalByTxid])

  // For ordinal transfer txs, extract the origin directly from the description.
  // New format: "Transferred ordinal {txid}_{vout} to {addr}..."
  // This allows thumbnail lookup from ordinalContentCache even after the ordinal
  // is no longer in the ordinals array (i.e. after it's been transferred out).
  // Does NOT depend on ordinalTxids — description is the source of truth here,
  // so this works correctly after a fresh seed restore where transaction_labels
  // may not have the 'ordinal' label re-created.
  // Legacy fallback: "Transferred ordinal {txid.slice(0,8)}..." — try ordinalByOrigin map.
  const getOrdinalProps = useCallback((tx: TxHistoryItem) => {
    // Check if this is a received ordinal (currently owned, transferred=false)
    const receivedOrdinal = ordinalByTxid.get(tx.tx_hash)
    if (receivedOrdinal) {
      return {
        ordinalOrigin: receivedOrdinal.origin,
        ordinalContentType: receivedOrdinal.contentType,
        ordinalCachedContent: ordinalContentCache.get(receivedOrdinal.origin)
      }
    }

    if (!tx.description) return {}

    // New format: full "txid_vout" origin embedded in description
    const newMatch = tx.description.match(/Transferred ordinal ([0-9a-f]{64}_\d+)/)
    if (newMatch) {
      const origin = newMatch[1]!
      const cachedContent = ordinalContentCache.get(origin)
      // Get contentType from ordinals array if still present, else undefined
      const contentType = ordinalByOrigin.get(origin)?.contentType
      return { ordinalOrigin: origin, ordinalContentType: contentType, ordinalCachedContent: cachedContent }
    }

    // Legacy fallback: old txid prefix format — requires ordinal still in state
    const legacyMatch = tx.description.match(/Transferred ordinal ([0-9a-f]{8})/)
    if (!legacyMatch) return {}
    const ord = ordinalByOrigin.get(
      // Try to find by matching origin that starts with this prefix
      Array.from(ordinalByOrigin.keys()).find(k => k.startsWith(legacyMatch[1]!)) ?? ''
    )
    if (!ord) return {}
    return {
      ordinalOrigin: ord.origin,
      ordinalContentType: ord.contentType,
      ordinalCachedContent: ordinalContentCache.get(ord.origin)
    }
  }, [ordinalByTxid, ordinalByOrigin, ordinalContentCache])

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
              const ordinalProps = getOrdinalProps(tx)
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
                    {...ordinalProps}
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
          const ordinalProps = getOrdinalProps(tx)

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
              {...ordinalProps}
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
