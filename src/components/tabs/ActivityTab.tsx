import { useState, useRef, useEffect, memo, useCallback, useMemo, type ReactNode, type CSSProperties } from 'react'
import { ArrowDownLeft, ArrowUpRight, Lock, Unlock, Circle } from 'lucide-react'
import { List } from 'react-window'
import { useWalletState, useSyncContext, useNetworkInfo } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { useLabeledTransactions } from '../../hooks/useTransactionLabels'
import { TransactionDetailModal } from '../modals/TransactionDetailModal'
import { NoTransactionsEmpty } from '../shared/EmptyState'
import { ActivityListSkeleton } from '../shared/Skeleton'
import { TransactionItemRow, type TxHistoryItem } from '../shared/TransactionItemRow'

const VIRTUALIZATION_THRESHOLD = 50
const TX_ITEM_HEIGHT = 80 // ~68px item + 12px gap

// ── Data passed to the virtualized row component via react-window's rowProps ──
interface ActivityRowData {
  txHistory: TxHistoryItem[]
  getTxTypeAndIcon: (tx: { tx_hash: string; amount?: number; description?: string }) => { type: string; icon: ReactNode }
  getOrdinalProps: (tx: TxHistoryItem) => {
    ordinalOrigin?: string
    ordinalContentType?: string
    ordinalCachedContent?: { contentData?: Uint8Array; contentText?: string; contentType?: string }
  }
  handleTxClick: (tx: TxHistoryItem) => void
  formatUSD: (sats: number) => string
  displayInSats: boolean
  formatBSVShort: (sats: number) => string
  currentHeight: number
}

/**
 * Module-level row component for react-window.
 *
 * CRITICAL: This MUST be defined outside the ActivityTab render function so its reference
 * is stable across renders. react-window v2 wraps rowComponent with:
 *   useMemo(() => memo(rowComponent), [rowComponent])
 * If rowComponent changes reference (e.g. inline function), React treats it as a NEW
 * component type → unmounts ALL visible rows → DOM destroyed → OrdinalImage remounts →
 * CSS opacity transition replays → visible thumbnail flicker.
 *
 * Data flows through rowProps (which react-window passes as props). When rowProps change,
 * react-window recreates elements but React sees the SAME component type → UPDATE (not
 * unmount/remount) → no DOM destruction → no flicker.
 */
function ActivityRow({
  index, style,
  txHistory, getTxTypeAndIcon, getOrdinalProps, handleTxClick,
  formatUSD, displayInSats, formatBSVShort, currentHeight
}: { index: number; style: CSSProperties; ariaAttributes?: Record<string, unknown> } & ActivityRowData) {
  const tx = txHistory[index]!
  const { type: txType, icon: txIcon } = getTxTypeAndIcon(tx)
  const ordinalProps = getOrdinalProps(tx)
  return (
    <div style={{ ...style, paddingBottom: 12 }}>
      <TransactionItemRow
        tx={tx}
        txType={txType}
        txIcon={txIcon}
        onClick={() => handleTxClick(tx)}
        formatUSD={formatUSD}
        displayInSats={displayInSats}
        formatBSVShort={formatBSVShort}
        currentHeight={currentHeight}
        {...ordinalProps}
      />
    </div>
  )
}

export const ActivityTab = memo(function ActivityTab() {
  const { txHistory, locks, loading, activeAccountId, scopedDataAccountId, ordinals, contentCacheSnapshot } = useWalletState()
  const { fetchOrdinalContentIfMissing } = useSyncContext()
  const { formatUSD, displayInSats, formatBSVShort } = useUI()
  const { networkInfo } = useNetworkInfo()
  const currentHeight = networkInfo?.blockHeight ?? 0
  const isAccountDataReady = activeAccountId == null || scopedDataAccountId === activeAccountId

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

  // Measure the content area height for the virtualized list.
  // We observe #main-content (the bounded flex child of .app) rather than
  // the virtual container div, because the container has no intrinsic height
  // of its own — measuring it would be circular (its height = List height = containerHeight).
  // Observing #main-content gives us the actual available viewport height and
  // correctly updates when the window is resized.
  useEffect(() => {
    if (!shouldVirtualize) return
    const el = document.getElementById('main-content')
    if (!el) return
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
        if (!contentCacheSnapshot.has(origin)) {
          missing.push({ origin, contentType: ordinalByOrigin.get(origin)?.contentType })
        }
      }
    }
    return missing
  }, [txHistory, ordinalByOrigin, contentCacheSnapshot])

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
  // This allows thumbnail lookup from contentCacheSnapshot even after the ordinal
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
        ordinalCachedContent: contentCacheSnapshot.get(receivedOrdinal.origin)
      }
    }

    if (!tx.description) return {}

    // New format: full "txid_vout" origin embedded in description
    const newMatch = tx.description.match(/Transferred ordinal ([0-9a-f]{64}_\d+)/)
    if (newMatch) {
      const origin = newMatch[1]!
      const cachedContent = contentCacheSnapshot.get(origin)
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
      ordinalCachedContent: contentCacheSnapshot.get(ord.origin)
    }
  }, [ordinalByTxid, ordinalByOrigin, contentCacheSnapshot])

  if (!isAccountDataReady) {
    return (
      <div className="tx-list">
        <ActivityListSkeleton />
      </div>
    )
  }

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
        <div ref={containerRef} className="tx-list-virtual-container" role="list" aria-label="Transaction history" style={{ height: containerHeight }}>
          <List<ActivityRowData>
            rowCount={txHistory.length}
            rowHeight={TX_ITEM_HEIGHT}
            rowProps={{
              txHistory, getTxTypeAndIcon, getOrdinalProps, handleTxClick,
              formatUSD, displayInSats, formatBSVShort, currentHeight
            }}
            overscanCount={5}
            style={{ height: containerHeight }}
            rowComponent={ActivityRow}
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
            <TransactionItemRow
              key={tx.tx_hash}
              tx={tx}
              txType={txType}
              txIcon={txIcon}
              onClick={() => handleTxClick(tx)}
              formatUSD={formatUSD}
              displayInSats={displayInSats}
              formatBSVShort={formatBSVShort}
              currentHeight={currentHeight}
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
})
