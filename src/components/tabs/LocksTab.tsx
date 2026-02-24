import { useState, memo, useMemo } from 'react'
import { Lock, Unlock, Sparkles } from 'lucide-react'
import { useWalletState } from '../../contexts'
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


export const LocksTab = memo(function LocksTab({ onLock, onUnlock, onUnlockAll, unlocking }: LocksTabProps) {
  const { locks, networkInfo } = useWalletState()
  const { formatUSD } = useUI()
  const [selectedLock, setSelectedLock] = useState<LockedUTXO | null>(null)

  const currentHeight = networkInfo?.blockHeight || 0

  // Memoize lock categorization
  const { unlockableLocks, lockedLocks } = useMemo(() => {
    const unlockable = locks
      .filter(lock => currentHeight >= lock.unlockBlock)
      .sort((a, b) => b.satoshis - a.satoshis)
    const locked = locks
      .filter(lock => currentHeight < lock.unlockBlock)
      .sort((a, b) => a.unlockBlock - b.unlockBlock)
    return { unlockableLocks: unlockable, lockedLocks: locked }
  }, [locks, currentHeight])

  return (
    <>
      <div className="locks-tab">
        {/* Locks List */}
        {locks.length === 0 ? (
          <NoLocksEmpty onLock={onLock} />
        ) : (
          <>
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
                      key={`${lock.txid}:${lock.vout}`}
                      lock={lock}
                      currentHeight={currentHeight}
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
                    key={`${lock.txid}:${lock.vout}`}
                    lock={lock}
                    currentHeight={currentHeight}
                    isUnlockable={false}
                    isUnlocking={false}
                    onUnlock={onUnlock}
                    onClick={setSelectedLock}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Action buttons - sticky footer, always visible */}
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
          </>
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
})

interface LockItemProps {
  lock: LockedUTXO
  currentHeight: number
  isUnlockable: boolean
  isUnlocking: boolean
  onUnlock: (lock: LockedUTXO) => void
  onClick: (lock: LockedUTXO) => void
}

const LockItem = memo(function LockItem({ lock, currentHeight, isUnlockable, isUnlocking, onUnlock, onClick }: LockItemProps) {
  const blocksRemaining = Math.max(0, lock.unlockBlock - currentHeight)
  const estimatedSeconds = blocksRemaining * AVERAGE_BLOCK_TIME_SECONDS

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
        <div className="lock-icon-container" aria-hidden="true">
          {isUnlockable ? (
            <Unlock size={24} strokeWidth={1.75} />
          ) : (
            <Lock size={24} strokeWidth={1.75} />
          )}
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

        {isUnlockable && (
          <div className="lock-actions">
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
          </div>
        )}
      </div>
    </div>
  )
})
