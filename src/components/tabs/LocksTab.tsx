import { useState, useEffect, memo, useCallback, useMemo } from 'react'
import { useWallet } from '../../contexts/WalletContext'
import type { LockedUTXO } from '../../services/wallet'
import { openUrl } from '@tauri-apps/plugin-opener'

interface LocksTabProps {
  onLock: () => void
  onUnlock: (lock: LockedUTXO) => void
  onUnlockAll: () => void
  unlocking: string | null
}

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

function formatCountdownTimer(seconds: number): { days: string; hours: string; minutes: string; seconds: string } {
  if (seconds <= 0) {
    return { days: '00', hours: '00', minutes: '00', seconds: '00' }
  }

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  return {
    days: String(days).padStart(2, '0'),
    hours: String(hours).padStart(2, '0'),
    minutes: String(minutes).padStart(2, '0'),
    seconds: String(secs).padStart(2, '0')
  }
}

function formatFullTimeRemaining(seconds: number): string {
  if (seconds <= 0) return 'Ready to unlock!'

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  const parts = []
  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`)
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`)
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`)

  if (parts.length === 0) return 'Less than a minute'
  return `Approximately ${parts.join(', ')}`
}

interface ProgressRingProps {
  progress: number
  size?: number
  strokeWidth?: number
  isUnlockable?: boolean
}

function ProgressRing({ progress, size = 48, strokeWidth = 4, isUnlockable = false }: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (progress / 100) * circumference

  return (
    <div className="progress-ring-container">
      <svg
        width={size}
        height={size}
        className="progress-ring"
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {/* Background circle */}
        <circle
          className="progress-ring-bg"
          strokeWidth={strokeWidth}
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        {/* Progress circle */}
        <circle
          className={`progress-ring-progress ${isUnlockable ? 'complete' : ''}`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
            transform: 'rotate(-90deg)',
            transformOrigin: '50% 50%'
          }}
        />
      </svg>
      <div className="progress-ring-content">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {isUnlockable ? (
            <>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 9.9-1" />
            </>
          ) : (
            <>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </>
          )}
        </svg>
      </div>
    </div>
  )
}

export function LocksTab({ onLock, onUnlock, onUnlockAll, unlocking }: LocksTabProps) {
  const { locks, networkInfo } = useWallet()
  const [, forceUpdate] = useState(0)

  // Update time estimates every minute
  useEffect(() => {
    const interval = setInterval(() => {
      forceUpdate(n => n + 1)
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  const openOnWoC = useCallback((txid: string) => {
    openUrl(`https://whatsonchain.com/tx/${txid}`)
  }, [])

  const currentHeight = networkInfo?.blockHeight || 0

  // Memoize lock categorization
  const { unlockableLocks, lockedLocks, totalLocked } = useMemo(() => {
    const unlockable = locks.filter(lock => currentHeight >= lock.unlockBlock)
    const locked = locks.filter(lock => currentHeight < lock.unlockBlock)
    const total = locks.reduce((sum, lock) => sum + lock.satoshis, 0)
    return { unlockableLocks: unlockable, lockedLocks: locked, totalLocked: total }
  }, [locks, currentHeight])

  return (
    <div className="locks-tab">
      {/* Summary Card */}
      {locks.length > 0 && (
        <div className="locks-summary">
          <div className="locks-summary-item">
            <span className="locks-summary-label">Total Locked</span>
            <span className="locks-summary-value">{totalLocked.toLocaleString()} sats</span>
          </div>
          <div className="locks-summary-item">
            <span className="locks-summary-label">Active Locks</span>
            <span className="locks-summary-value">{lockedLocks.length}</span>
          </div>
          <div className="locks-summary-item">
            <span className="locks-summary-label">Ready to Unlock</span>
            <span className="locks-summary-value unlockable">{unlockableLocks.length}</span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="locks-actions">
        <button
          className="btn btn-primary"
          onClick={onLock}
          aria-label="Create a new lock"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Lock BSV
        </button>
        {unlockableLocks.length > 1 && (
          <button
            className="btn btn-secondary"
            onClick={onUnlockAll}
            aria-label={`Unlock all ${unlockableLocks.length} ready locks`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 9.9-1" />
            </svg>
            Unlock All ({unlockableLocks.length})
          </button>
        )}
      </div>

      {/* Locks List */}
      {locks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)' }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div className="empty-title">No Locks Yet</div>
          <div className="empty-text">
            Lock your BSV until a specific block height.
            Great for savings goals and commitments.
          </div>
        </div>
      ) : (
        <div className="locks-list" role="list" aria-label="Locked UTXOs">
          {/* Unlockable locks first */}
          {unlockableLocks.length > 0 && (
            <div className="locks-section">
              <h3 className="locks-section-title">
                <span className="pulse-dot" aria-hidden="true" />
                Ready to Unlock
              </h3>
              {unlockableLocks.map((lock) => {
                const isUnlocking = unlocking === lock.txid
                return (
                  <LockItem
                    key={lock.txid}
                    lock={lock}
                    currentHeight={currentHeight}
                    isUnlockable={true}
                    isUnlocking={isUnlocking}
                    onUnlock={onUnlock}
                    onOpenWoC={openOnWoC}
                  />
                )
              })}
            </div>
          )}

          {/* Pending locks */}
          {lockedLocks.length > 0 && (
            <div className="locks-section">
              {unlockableLocks.length > 0 && (
                <h3 className="locks-section-title">Still Locked</h3>
              )}
              {lockedLocks.map((lock) => (
                <LockItem
                  key={lock.txid}
                  lock={lock}
                  currentHeight={currentHeight}
                  isUnlockable={false}
                  isUnlocking={false}
                  onUnlock={onUnlock}
                  onOpenWoC={openOnWoC}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface LockItemProps {
  lock: LockedUTXO
  currentHeight: number
  isUnlockable: boolean
  isUnlocking: boolean
  onUnlock: (lock: LockedUTXO) => void
  onOpenWoC: (txid: string) => void
}

const LockItem = memo(function LockItem({ lock, currentHeight, isUnlockable, isUnlocking, onUnlock, onOpenWoC }: LockItemProps) {
  const blocksRemaining = Math.max(0, lock.unlockBlock - currentHeight)
  const [estimatedSecondsRemaining, setEstimatedSecondsRemaining] = useState(
    blocksRemaining * AVERAGE_BLOCK_TIME_SECONDS
  )

  // Update countdown every second for a real-time feel
  useEffect(() => {
    if (isUnlockable) return

    const startTime = Date.now()
    const initialSeconds = blocksRemaining * AVERAGE_BLOCK_TIME_SECONDS

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const remaining = Math.max(0, initialSeconds - elapsed)
      setEstimatedSecondsRemaining(remaining)
    }, 1000)

    return () => clearInterval(interval)
  }, [blocksRemaining, isUnlockable])

  // Calculate progress percentage
  // We estimate lock duration based on createdAt timestamp vs unlock block
  const lockDuration = lock.createdAt
    ? lock.unlockBlock - Math.floor(lock.createdAt / 600000) // 600000ms = 10min average block
    : blocksRemaining + 100 // Fallback if no createdAt

  const progressPercent = isUnlockable
    ? 100
    : Math.max(0, Math.min(99, ((lockDuration - blocksRemaining) / lockDuration) * 100))

  const countdown = formatCountdownTimer(estimatedSecondsRemaining)
  const showDetailedCountdown = blocksRemaining <= 144 // Show detailed countdown for last ~24 hours

  return (
    <div
      className={`lock-card ${isUnlockable ? 'unlockable' : ''}`}
      role="listitem"
      aria-label={`${lock.satoshis.toLocaleString()} sats locked until block ${lock.unlockBlock.toLocaleString()}`}
    >
      <div className="lock-card-main">
        <div
          className="lock-progress-ring"
          onClick={() => onOpenWoC(lock.txid)}
          role="button"
          tabIndex={0}
          aria-label="View transaction on WhatsOnChain"
          onKeyDown={(e) => e.key === 'Enter' && onOpenWoC(lock.txid)}
        >
          <ProgressRing
            progress={progressPercent}
            size={56}
            strokeWidth={4}
            isUnlockable={isUnlockable}
          />
        </div>

        <div className="lock-info">
          <div className="lock-amount">
            {lock.satoshis.toLocaleString()} sats
          </div>
          <div className="lock-details">
            {isUnlockable ? (
              <span className="unlock-ready-badge">✨ Ready to unlock!</span>
            ) : showDetailedCountdown ? (
              <div className="countdown-timer">
                <div className="countdown-unit">
                  <span className="countdown-value">{countdown.hours}</span>
                  <span className="countdown-label">h</span>
                </div>
                <span className="countdown-separator">:</span>
                <div className="countdown-unit">
                  <span className="countdown-value">{countdown.minutes}</span>
                  <span className="countdown-label">m</span>
                </div>
                <span className="countdown-separator">:</span>
                <div className="countdown-unit">
                  <span className="countdown-value">{countdown.seconds}</span>
                  <span className="countdown-label">s</span>
                </div>
              </div>
            ) : (
              <>
                <span className="lock-time-remaining">
                  {formatTimeRemaining(estimatedSecondsRemaining)}
                </span>
                <span className="lock-blocks">
                  {blocksRemaining.toLocaleString()} blocks
                </span>
              </>
            )}
          </div>
          <div className="lock-target">
            Target block: {lock.unlockBlock.toLocaleString()}
          </div>
        </div>

        <div className="lock-actions">
          {isUnlockable ? (
            <button
              className="btn btn-unlock"
              onClick={() => onUnlock(lock)}
              disabled={isUnlocking}
              aria-label={`Unlock ${lock.satoshis.toLocaleString()} sats`}
            >
              {isUnlocking ? (
                <>
                  <span className="spinner-small" aria-hidden="true" />
                  Unlocking...
                </>
              ) : (
                <>🔓 Unlock</>
              )}
            </button>
          ) : (
            <div className="lock-countdown" title={formatFullTimeRemaining(estimatedSecondsRemaining)}>
              <span className="lock-percent">{Math.round(progressPercent)}%</span>
              <span className="lock-status">complete</span>
            </div>
          )}
        </div>
      </div>

      {/* Expanded progress bar for locked items */}
      {!isUnlockable && (
        <div className="lock-progress-bar-container">
          <div
            className="lock-progress-bar"
            style={{ width: `${progressPercent}%` }}
            role="progressbar"
            aria-valuenow={Math.round(progressPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}
    </div>
  )
})
