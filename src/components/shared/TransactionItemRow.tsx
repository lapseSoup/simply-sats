import { memo, type ReactNode } from 'react'
import { OrdinalImage } from './OrdinalImage'

// Transaction type shared between ActivityTab and SearchTab
export type TxHistoryItem = {
  tx_hash: string
  amount?: number
  height: number
  description?: string
  createdAt?: number
}

export function formatTxDate(height: number, currentHeight: number, createdAt?: number): string | null {
  // Use block height to estimate confirmation time when available (more accurate than createdAt)
  const effectiveTs: number | null = (height > 0 && currentHeight > 0)
    ? Date.now() - (currentHeight - height) * 10 * 60 * 1000
    : (createdAt ?? null)

  if (!effectiveTs || effectiveTs <= 0) return null

  const diff = Date.now() - effectiveTs
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(diff / 86400000)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  const txDate = new Date(effectiveTs)
  return txDate.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    ...(txDate.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {})
  })
}

// Memoized transaction item to prevent unnecessary re-renders
export const TransactionItemRow = memo(function TransactionItemRow({
  tx,
  txType,
  txIcon,
  onClick,
  formatUSD,
  displayInSats,
  formatBSVShort,
  ordinalOrigin,
  ordinalContentType,
  ordinalCachedContent,
  currentHeight
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
  currentHeight: number
}) {
  const dateStr = formatTxDate(tx.height, currentHeight, tx.createdAt)

  return (
    <div
      className="tx-item"
      onClick={onClick}
      role="listitem"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      style={{ cursor: 'pointer' }}
    >
      {ordinalOrigin ? (
        <OrdinalImage
          origin={ordinalOrigin}
          contentType={ordinalContentType}
          size="sm"
          alt="Ordinal"
          lazy={false}
          cachedContent={ordinalCachedContent}
        />
      ) : (
        <div className="tx-icon" aria-hidden="true">
          {txIcon}
        </div>
      )}
      <div className="tx-info">
        <div className="tx-type">{txType}</div>
        <div className="tx-meta">
          {dateStr && <span>{dateStr}</span>}
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
            <div className="tx-amount-usd">
              ${formatUSD(Math.abs(tx.amount))}
            </div>
          </>
        ) : (
          <div className="tx-amount-value">View &rarr;</div>
        )}
      </div>
    </div>
  )
})
