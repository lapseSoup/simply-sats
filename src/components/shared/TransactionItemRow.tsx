import { memo, type ReactNode } from 'react'
import { OrdinalImage } from './OrdinalImage'
import type { TxHistoryItem } from '../../domain/types'
import { formatTxDate } from './transactionItem'

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
  onOrdinalContentNeeded,
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
  onOrdinalContentNeeded?: (origin: string, contentType?: string) => void
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
          onContentNeeded={onOrdinalContentNeeded}
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
                : <>{tx.amount > 0 ? '+' : '-'}{formatBSVShort(Math.abs(tx.amount))} BSV</>
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
