import { useState } from 'react'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import { calculateLockFee, DEFAULT_FEE_RATE } from '../../adapters/walletAdapter'
import { getTimelockScriptSize } from '../../services/wallet'
import { Modal } from '../shared/Modal'
import { ConfirmationModal } from '../shared/ConfirmationModal'

// Short lock warning threshold: less than 6 blocks (~1 hour)
const SHORT_LOCK_WARNING_BLOCKS = 6
// Long lock warning threshold: 1 week = ~1008 blocks (10 min per block)
const LONG_LOCK_WARNING_BLOCKS = 1008

// Helper to calculate estimated unlock date - defined outside component to avoid render purity issues
function calculateEstimatedUnlockDate(blocks: number): Date | null {
  if (blocks <= 0) return null
  return new Date(Date.now() + blocks * 10 * 60 * 1000)
}

interface LockModalProps {
  onClose: () => void
}

export function LockModal({ onClose }: LockModalProps) {
  const {
    wallet,
    balance,
    networkInfo,
    handleLock
  } = useWallet()
  const { displayInSats, showToast } = useUI()

  const [lockAmount, setLockAmount] = useState('')
  const [lockBlocks, setLockBlocks] = useState('')
  const [locking, setLocking] = useState(false)
  const [lockError, setLockError] = useState('')
  const [showLongLockWarning, setShowLongLockWarning] = useState(false)
  const [showShortLockWarning, setShowShortLockWarning] = useState(false)

  if (!wallet) return null

  const lockSats = displayInSats
    ? Math.round(parseFloat(lockAmount || '0'))
    : Math.round(parseFloat(lockAmount || '0') * 100000000)
  const blocks = parseInt(lockBlocks || '0')
  const currentHeight = networkInfo?.blockHeight || 0
  const unlockBlock = currentHeight + blocks

  // Check if this is a short lock (< 1 hour)
  const isShortLock = blocks > 0 && blocks < SHORT_LOCK_WARNING_BLOCKS
  // Check if this is a long lock (> 1 week)
  const isLongLock = blocks > LONG_LOCK_WARNING_BLOCKS

  // Estimate unlock time (average 10 min per block)
  const estimatedMinutes = blocks * 10
  const estimatedHours = Math.floor(estimatedMinutes / 60)
  const estimatedDays = Math.floor(estimatedHours / 24)
  const estimatedWeeks = Math.floor(estimatedDays / 7)
  const estimatedMonths = Math.floor(estimatedDays / 30)

  let timeEstimate = ''
  if (estimatedMonths > 0) {
    timeEstimate = `~${estimatedMonths} month${estimatedMonths > 1 ? 's' : ''}`
  } else if (estimatedWeeks > 0) {
    timeEstimate = `~${estimatedWeeks} week${estimatedWeeks > 1 ? 's' : ''}`
  } else if (estimatedDays > 0) {
    timeEstimate = `~${estimatedDays} day${estimatedDays > 1 ? 's' : ''}`
  } else if (estimatedHours > 0) {
    timeEstimate = `~${estimatedHours} hour${estimatedHours > 1 ? 's' : ''}`
  } else if (estimatedMinutes > 0) {
    timeEstimate = `~${estimatedMinutes} min`
  }

  // Format date for display
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Calculate exact fee using actual script size
  let fee = 0
  if (wallet && blocks > 0) {
    const scriptSize = getTimelockScriptSize(wallet.walletPubKey, unlockBlock)
    fee = calculateLockFee(1, DEFAULT_FEE_RATE, scriptSize)
  } else {
    fee = calculateLockFee(1, DEFAULT_FEE_RATE)
  }

  const executeLock = async () => {
    setShowLongLockWarning(false)
    setShowShortLockWarning(false)
    setLocking(true)
    setLockError('')

    const result = await handleLock(lockSats, blocks)

    if (result.success) {
      showToast(`Locked ${lockSats.toLocaleString()} sats for ${blocks} blocks!`)
      onClose()
    } else {
      setLockError(result.error || 'Lock failed')
    }

    setLocking(false)
  }

  const handleSubmit = async () => {
    if (!lockAmount || !lockBlocks || lockSats <= 0 || blocks <= 0) return

    // Show warning for short locks
    if (isShortLock) {
      setShowShortLockWarning(true)
      return
    }

    // Show warning for long locks
    if (isLongLock) {
      setShowLongLockWarning(true)
      return
    }

    await executeLock()
  }

  // Short lock warning modal
  if (showShortLockWarning && blocks > 0) {
    return (
      <ConfirmationModal
        title="Short Lock Duration"
        message={`You're locking sats for only ${blocks} block${blocks > 1 ? 's' : ''} (~${blocks * 10} minutes). This is a very short duration.`}
        details={`Lock Amount: ${lockSats.toLocaleString()} sats\nDuration: ${blocks} block${blocks > 1 ? 's' : ''}\n\nAre you sure this is intentional? Locks are irreversible once created.`}
        type="info"
        confirmText="Yes, Lock Anyway"
        cancelText="Change Duration"
        onConfirm={executeLock}
        onCancel={() => setShowShortLockWarning(false)}
      />
    )
  }

  // Long lock warning modal
  if (showLongLockWarning && blocks > 0) {
    const unlockDate = calculateEstimatedUnlockDate(blocks)
    return (
      <ConfirmationModal
        title="⚠️ Long Lock Duration"
        message={`You are about to lock ${lockSats.toLocaleString()} sats for ${timeEstimate}. Your funds will be completely inaccessible until the lock expires.`}
        details={`Lock Amount: ${lockSats.toLocaleString()} sats\nDuration: ${blocks.toLocaleString()} blocks (${timeEstimate})\nEstimated Unlock: ${unlockDate ? formatDate(unlockDate) : 'Unknown'}\n\nThis action CANNOT be undone or reversed. Make sure you don't need these funds before the unlock date.`}
        type="danger"
        confirmText={`Lock for ${timeEstimate}`}
        cancelText="Go Back"
        onConfirm={executeLock}
        onCancel={() => setShowLongLockWarning(false)}
        confirmDelaySeconds={3}
      />
    )
  }

  return (
    <Modal onClose={onClose} title="Lock BSV" className="send-modal">
      <div className="modal-content compact">
          <div className="form-group">
            <label className="form-label" htmlFor="lock-amount" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Amount ({displayInSats ? 'sats' : 'BSV'})</span>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
                {displayInSats ? balance.toLocaleString() : (balance / 100000000).toFixed(8)} available
              </span>
            </label>
            <input
              id="lock-amount"
              type="number"
              className="form-input"
              placeholder=""
              step={displayInSats ? '1' : '0.00000001'}
              value={lockAmount}
              onChange={e => setLockAmount(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="lock-blocks">Lock Duration (blocks)</label>
            <input
              id="lock-blocks"
              type="number"
              className="form-input"
              placeholder=""
              min="1"
              value={lockBlocks}
              onChange={e => setLockBlocks(e.target.value)}
            />
            <div className="form-hint" id="lock-hint">
              {blocks > 0 ? (
                <>Unlocks at block {unlockBlock.toLocaleString()} {timeEstimate && `(${timeEstimate})`}</>
              ) : (
                <>1 block ≈ 10 minutes</>
              )}
            </div>
          </div>

          {/* Long lock warning inline */}
          {isLongLock && blocks > 0 && (() => {
            const unlockDate = calculateEstimatedUnlockDate(blocks)
            return (
              <div className="lock-warning" role="alert">
                <span className="lock-warning-icon">⚠️</span>
                <div className="lock-warning-content">
                  <strong>Long lock duration</strong>
                  <p>
                    Locking for more than 1 week. Estimated unlock: {unlockDate && formatDate(unlockDate)}
                  </p>
                </div>
              </div>
            )
          })()}

          <div className="send-summary compact">
            <div className="send-summary-row">
              <span>Current Block</span>
              <span>{currentHeight.toLocaleString()}</span>
            </div>
            {lockSats > 0 && blocks > 0 && (
              <>
                <div className="send-summary-row">
                  <span>Lock Amount</span>
                  <span>{lockSats.toLocaleString()} sats</span>
                </div>
                <div className="send-summary-row">
                  <span>Unlock Block</span>
                  <span>{unlockBlock.toLocaleString()}</span>
                </div>
                {blocks > 0 && (() => {
                  const unlockDate = calculateEstimatedUnlockDate(blocks)
                  return unlockDate ? (
                    <div className="send-summary-row">
                      <span>Est. Unlock Date</span>
                      <span style={{ fontSize: '0.8rem' }}>{formatDate(unlockDate)}</span>
                    </div>
                  ) : null
                })()}
                <div className="send-summary-row">
                  <span>Fee</span>
                  <span>{fee} sats</span>
                </div>
              </>
            )}
          </div>

          {lockError && (
            <div className="warning compact" role="alert">
              <span className="warning-icon">⚠️</span>
              <span className="warning-text">{lockError}</span>
            </div>
          )}
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={locking || !lockAmount || !lockBlocks || lockSats <= 0 || blocks <= 0}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            {!locking && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            )}
            {locking ? 'Locking...' : `Lock ${lockSats > 0 ? lockSats.toLocaleString() + ' sats' : 'BSV'}`}
          </button>
        </div>

      <style>{`
        .lock-warning {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          padding: 0.75rem;
          background: rgba(234, 179, 8, 0.1);
          border: 1px solid rgba(234, 179, 8, 0.3);
          border-radius: 0.5rem;
          margin-bottom: 0.75rem;
        }

        .lock-warning-icon {
          font-size: 1.25rem;
          flex-shrink: 0;
        }

        .lock-warning-content {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .lock-warning-content strong {
          color: #eab308;
          font-size: 0.875rem;
        }

        .lock-warning-content p {
          margin: 0;
          color: rgba(234, 179, 8, 0.8);
          font-size: 0.8125rem;
          line-height: 1.4;
        }
      `}</style>
      </Modal>
  )
}
