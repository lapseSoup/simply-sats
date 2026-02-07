import { Unlock, Sparkles } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useUI } from '../../contexts/UIContext'
import type { LockedUTXO } from '../../services/wallet'
import { Modal } from '../shared/Modal'

// Average BSV block time is ~10 minutes (600 seconds)
const AVERAGE_BLOCK_TIME_SECONDS = 600

function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return 'Ready!'

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) {
    return `~${days}d ${hours}h`
  } else if (hours > 0) {
    return `~${hours}h ${minutes}m`
  } else if (minutes > 0) {
    return `~${minutes}m`
  } else {
    return '<1m'
  }
}

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

  // Calculate progress percentage using block-based approach
  let progressPercent: number
  if (isUnlockable) {
    progressPercent = 100
  } else if (lock.lockBlock && lock.lockBlock < lock.unlockBlock) {
    const totalBlocks = lock.unlockBlock - lock.lockBlock
    const elapsed = currentHeight - lock.lockBlock
    progressPercent = Math.max(0, Math.min(99, (elapsed / totalBlocks) * 100))
  } else {
    // Fallback for old locks without lockBlock
    progressPercent = currentHeight > 0 ? Math.min(50, Math.max(1, 100 - (blocksRemaining / 10))) : 0
  }

  const openOnWoC = () => {
    openUrl(`https://whatsonchain.com/tx/${lock.txid}`)
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
            <span className="tx-detail-label">Progress</span>
            <span className="tx-detail-value">{Math.round(progressPercent)}% complete</span>
          </div>

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
