import { useState, useEffect, memo, useMemo } from 'react'
import { Lock, Unlock, Sparkles } from 'lucide-react'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import type { LockedUTXO } from '../../services/wallet'
import { NoLocksEmpty } from '../shared/EmptyState'
import { LockDetailModal } from '../modals/LockDetailModal'

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
        {isUnlockable ? (
          <Unlock size={20} strokeWidth={2} />
        ) : (
          <Lock size={20} strokeWidth={2} />
        )}
      </div>
    </div>
  )
}

export function LocksTab({ onLock, onUnlock, onUnlockAll, unlocking }: LocksTabProps) {
  const { locks, networkInfo } = useWallet()
  const { formatUSD } = useUI()
  const [tick, forceUpdate] = useState(0)
  const [selectedLock, setSelectedLock] = useState<LockedUTXO | null>(null)

  // Update time estimates every minute
  useEffect(() => {
    const interval = setInterval(() => {
      forceUpdate(n => n + 1)
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  const currentHeight = networkInfo?.blockHeight || 0

  // Capture current time once per render cycle (re-computed each minute via tick)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [tick])

  // Memoize lock categorization
  const { unlockableLocks, lockedLocks } = useMemo(() => {
    const unlockable = locks.filter(lock => currentHeight >= lock.unlockBlock)
    const locked = locks.filter(lock => currentHeight < lock.unlockBlock)
    return { unlockableLocks: unlockable, lockedLocks: locked }
  }, [locks, currentHeight])

  return (
    <>
      <div className="locks-tab">
        {/* Locks List */}
        {locks.length === 0 ? (
          <NoLocksEmpty onLock={onLock} />
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
                      now={now}
                      isUnlockable={true}
                      isUnlocking={isUnlocking}
                      onUnlock={onUnlock}
                      onClick={setSelectedLock}
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
                    now={now}
                    isUnlockable={false}
                    isUnlocking={false}
                    onUnlock={onUnlock}
                    onClick={setSelectedLock}
                  />
                ))}
              </div>
            )}

            {/* Action buttons at bottom */}
            <div className="locks-footer-actions">
              <button
                className="btn btn-secondary"
                onClick={onLock}
                aria-label="Create a new lock"
              >
                + New Lock
              </button>
              {unlockableLocks.length > 1 && (
                <button
                  className="btn btn-secondary"
                  onClick={onUnlockAll}
                  aria-label={`Unlock all ${unlockableLocks.length} ready locks`}
                >
                  Unlock All ({unlockableLocks.length})
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {selectedLock && (
        <LockDetailModal
          lock={selectedLock}
          currentHeight={currentHeight}
          formatUSD={formatUSD}
          onClose={() => setSelectedLock(null)}
          onUnlock={(lock) => {
            setSelectedLock(null)
            onUnlock(lock)
          }}
          isUnlocking={unlocking === selectedLock.txid}
        />
      )}
    </>
  )
}

interface LockItemProps {
  lock: LockedUTXO
  currentHeight: number
  now: number
  isUnlockable: boolean
  isUnlocking: boolean
  onUnlock: (lock: LockedUTXO) => void
  onClick: (lock: LockedUTXO) => void
}

const LockItem = memo(function LockItem({ lock, currentHeight, now, isUnlockable, isUnlocking, onUnlock, onClick }: LockItemProps) {
  const blocksRemaining = Math.max(0, lock.unlockBlock - currentHeight)
  const estimatedSeconds = blocksRemaining * AVERAGE_BLOCK_TIME_SECONDS

  // Calculate progress percentage
  // Estimate the block height when the lock was created using the timestamp delta
  const estimatedCreationBlock = lock.createdAt && currentHeight > 0
    ? currentHeight - Math.round((now - lock.createdAt) / (AVERAGE_BLOCK_TIME_SECONDS * 1000))
    : 0
  const lockDurationBlocks = estimatedCreationBlock > 0
    ? Math.max(lock.unlockBlock - estimatedCreationBlock, blocksRemaining + 1)
    : blocksRemaining + 1 // Fallback: treat as just started
  const blocksElapsed = lockDurationBlocks - blocksRemaining

  const progressPercent = isUnlockable
    ? 100
    : Math.max(0, Math.min(99, (blocksElapsed / lockDurationBlocks) * 100))

  return (
    <div
      className={`lock-card ${isUnlockable ? 'unlockable' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${lock.satoshis.toLocaleString()} sats locked until block ${lock.unlockBlock.toLocaleString()}`}
      onClick={() => onClick(lock)}
      onKeyDown={(e) => e.key === 'Enter' && onClick(lock)}
      style={{ cursor: 'pointer' }}
    >
      <div className="lock-card-main">
        <div className="lock-progress-ring">
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
              <span className="unlock-ready-badge"><Sparkles size={12} strokeWidth={1.75} /> Ready to unlock!</span>
            ) : currentHeight > 0 ? (
              <>
                <span className="lock-blocks-remaining">
                  {blocksRemaining.toLocaleString()} block{blocksRemaining !== 1 ? 's' : ''} remaining
                </span>
                <span className="lock-time-estimate">
                  {formatTimeRemaining(estimatedSeconds)} estimated
                </span>
              </>
            ) : (
              <span className="lock-blocks-remaining">Loading...</span>
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
              onClick={(e) => { e.stopPropagation(); onUnlock(lock) }}
              disabled={isUnlocking}
              aria-label={`Unlock ${lock.satoshis.toLocaleString()} sats`}
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
          ) : (
            <div className="lock-countdown" title={`${blocksRemaining.toLocaleString()} blocks remaining (~${formatTimeRemaining(estimatedSeconds)})`}>
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
