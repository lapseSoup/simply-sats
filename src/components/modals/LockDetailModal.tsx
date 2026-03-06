import { Unlock, Sparkles } from 'lucide-react'
import { openExternalUrl } from '../../utils/opener'
import { useUI } from '../../contexts/UIContext'
import type { LockedUTXO } from '../../domain/types'
import { Modal } from '../shared/Modal'
import { formatTimeRemaining, AVERAGE_BLOCK_TIME_SECONDS } from '../../utils/timeFormatting'

interface LockDetailModalProps {
  lock: LockedUTXO
  currentHeight: number
  formatUSD: (sats: number) => string
  onClose: () => void
  onUnlock?: (lock: LockedUTXO) => void
  isUnlocking?: boolean
}

export function LockDetailModal({
  lock,
  currentHeight,
  formatUSD,
  onClose,
  onUnlock,
  isUnlocking = false
}: LockDetailModalProps) {
  const { copyToClipboard } = useUI()

  const blocksRemaining = Math.max(0, lock.unlockBlock - currentHeight)
  const isUnlockable = currentHeight >= lock.unlockBlock
  const estimatedSeconds = blocksRemaining * AVERAGE_BLOCK_TIME_SECONDS

  const openOnWoC = () => {
    openExternalUrl(`https://whatsonchain.com/tx/${lock.txid}`)
  }

  return (
    <Modal title="Lock Details" onClose={onClose}>
      <div className="modal-content">
        {/* Lock Info */}
        <div className="tx-detail-section">
          <div className="tx-detail-row">
            <span className="tx-detail-label">Lock Amount</span>
            <span className="tx-detail-value">
              {lock.satoshis.toLocaleString()} sats
              <span className="tx-detail-usd">
                (${formatUSD(lock.satoshis)})
              </span>
            </span>
          </div>

          <div className="tx-detail-row">
            <span className="tx-detail-label">Transaction ID</span>
            <span className="tx-detail-value tx-detail-mono">
              {lock.txid.slice(0, 12)}...{lock.txid.slice(-8)}
            </span>
          </div>

          <div className="tx-detail-row">
            <span className="tx-detail-label">Unlock Block</span>
            <span className="tx-detail-value">{lock.unlockBlock.toLocaleString()}</span>
          </div>

          <div className="tx-detail-row">
            <span className="tx-detail-label">Current Block</span>
            <span className="tx-detail-value">{currentHeight.toLocaleString()}</span>
          </div>

          <div className="tx-detail-row">
            <span className="tx-detail-label">Blocks Remaining</span>
            <span className="tx-detail-value">
              {isUnlockable ? (
                <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Sparkles size={14} strokeWidth={1.75} /> Ready to unlock!
                </span>
              ) : (
                `${blocksRemaining.toLocaleString()} block${blocksRemaining !== 1 ? 's' : ''}`
              )}
            </span>
          </div>

          {!isUnlockable && (
            <div className="tx-detail-row">
              <span className="tx-detail-label">Estimated Time</span>
              <span className="tx-detail-value">{formatTimeRemaining(estimatedSeconds)}</span>
            </div>
          )}

          <div className="tx-detail-row">
            <span className="tx-detail-label">Status</span>
            <span className={`tx-detail-value tx-status ${isUnlockable ? 'confirmed' : 'pending'}`}>
              {isUnlockable ? 'Unlockable' : 'Locked'}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="modal-actions">
          <button
            className="btn btn-secondary"
            onClick={() => copyToClipboard(lock.txid, 'TXID copied!')}
          >
            Copy TXID
          </button>
          <button className="btn btn-secondary" onClick={openOnWoC}>
            View on Explorer
          </button>
          {isUnlockable && onUnlock && (
            <button
              className="btn btn-primary"
              onClick={() => onUnlock(lock)}
              disabled={isUnlocking}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              {isUnlocking ? (
                <>
                  <span className="spinner-small" aria-hidden="true" />
                  Unlocking...
                </>
              ) : (
                <><Unlock size={14} strokeWidth={1.75} /> Unlock</>
              )}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
