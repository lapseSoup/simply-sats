import { useState, useEffect, memo, useCallback } from 'react'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import { getTransactionsByLabel } from '../../services/database'
import { uiLogger } from '../../services/logger'
import { TransactionDetailModal } from '../modals/TransactionDetailModal'
import { NoTransactionsEmpty } from '../shared/EmptyState'

// Transaction type for the component
type TxHistoryItem = { tx_hash: string; amount?: number; height: number }

// Memoized transaction item to prevent unnecessary re-renders
const TransactionItem = memo(function TransactionItem({
  tx,
  txType,
  txIcon,
  onClick,
  formatUSD
}: {
  tx: TxHistoryItem
  txType: string
  txIcon: string
  onClick: () => void
  formatUSD: (sats: number) => string
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
          <span className="tx-hash">{tx.tx_hash.slice(0, 8)}...{tx.tx_hash.slice(-6)}</span>
          {tx.height > 0 && <span>• Block {tx.height.toLocaleString()}</span>}
        </div>
      </div>
      <div className="tx-amount">
        {tx.amount ? (
          <>
            <div className={`tx-amount-value ${tx.amount > 0 ? 'positive' : 'negative'}`}>
              {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()} sats
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
  const { txHistory, locks } = useWallet()
  const { formatUSD } = useUI()
  const [unlockTxids, setUnlockTxids] = useState<Set<string>>(new Set())
  const [selectedTx, setSelectedTx] = useState<TxHistoryItem | null>(null)

  // Fetch unlock transaction IDs from database
  useEffect(() => {
    const fetchUnlockTxids = async () => {
      try {
        const unlockTxs = await getTransactionsByLabel('unlock')
        setUnlockTxids(new Set(unlockTxs.map(tx => tx.txid)))
      } catch (e) {
        uiLogger.warn('Failed to fetch unlock transactions', { error: String(e) })
      }
    }
    fetchUnlockTxids()
  }, [txHistory]) // Refresh when tx history changes

  const handleTxClick = useCallback((tx: TxHistoryItem) => {
    setSelectedTx(tx)
  }, [])

  const handleCloseModal = useCallback(() => {
    setSelectedTx(null)
  }, [])

  if (txHistory.length === 0) {
    return (
      <div className="tx-list">
        <NoTransactionsEmpty />
      </div>
    )
  }

  // Determine transaction type and icon
  const getTxTypeAndIcon = (tx: { tx_hash: string; amount?: number }) => {
    const isLockTx = locks.some(l => l.txid === tx.tx_hash)
    const isUnlockTx = unlockTxids.has(tx.tx_hash)

    if (isLockTx) {
      return { type: 'Locked', icon: '🔒' }
    }
    if (isUnlockTx) {
      return { type: 'Unlocked', icon: '🔓' }
    }
    if (tx.amount && tx.amount > 0) {
      return { type: 'Received', icon: '↓' }
    }
    if (tx.amount && tx.amount < 0) {
      return { type: 'Sent', icon: '↑' }
    }
    return { type: 'Transaction', icon: '•' }
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
