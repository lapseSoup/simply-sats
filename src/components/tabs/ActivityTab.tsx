import { useState, useEffect } from 'react'
import { useWallet } from '../../contexts/WalletContext'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getTransactionsByLabel } from '../../services/database'

export function ActivityTab() {
  const { txHistory, locks } = useWallet()
  const [unlockTxids, setUnlockTxids] = useState<Set<string>>(new Set())

  // Fetch unlock transaction IDs from database
  useEffect(() => {
    const fetchUnlockTxids = async () => {
      try {
        const unlockTxs = await getTransactionsByLabel('unlock')
        setUnlockTxids(new Set(unlockTxs.map(tx => tx.txid)))
      } catch (e) {
        console.warn('Failed to fetch unlock transactions:', e)
      }
    }
    fetchUnlockTxids()
  }, [txHistory]) // Refresh when tx history changes

  const openOnWoC = (txid: string) => {
    openUrl(`https://whatsonchain.com/tx/${txid}`)
  }

  if (txHistory.length === 0) {
    return (
      <div className="tx-list">
        <div className="empty-state">
          <div className="empty-icon" aria-hidden="true">📭</div>
          <div className="empty-title">No Transactions Yet</div>
          <div className="empty-text">Your transaction history will appear here</div>
        </div>
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
      return { type: 'Received', icon: '📥' }
    }
    if (tx.amount && tx.amount < 0) {
      return { type: 'Sent', icon: '📤' }
    }
    return { type: 'Transaction', icon: '📄' }
  }

  return (
    <div className="tx-list" role="list" aria-label="Transaction history">
      {txHistory.map((tx) => {
        const { type: txType, icon: txIcon } = getTxTypeAndIcon(tx)

        return (
          <div
            key={tx.tx_hash}
            className="tx-item"
            onClick={() => openOnWoC(tx.tx_hash)}
            role="listitem"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && openOnWoC(tx.tx_hash)}
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
                <div className={`tx-amount-value ${tx.amount > 0 ? 'positive' : 'negative'}`}>
                  {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()} sats
                </div>
              ) : (
                <div className="tx-amount-value">View →</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
