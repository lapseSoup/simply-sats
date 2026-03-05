import { memo } from 'react'
import { Lock } from 'lucide-react'
import { useWalletState } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { useSyncStatus } from '../../contexts/NetworkContext'
import { BalanceSkeleton } from '../shared/Skeleton'

function BalanceDisplayComponent() {
  const { balance, ordBalance, locks, activeAccountId, scopedDataAccountId } = useWalletState()
  const { displayInSats, toggleDisplayUnit, formatBSVShort, formatUSD } = useUI()
  const { syncing } = useSyncStatus()

  const totalBalance = balance + ordBalance
  const lockedBalance = locks.reduce((sum, l) => sum + l.satoshis, 0)
  const isAccountDataReady = activeAccountId == null || scopedDataAccountId === activeAccountId
  const showSkeleton = !isAccountDataReady || (totalBalance === 0 && syncing)

  return (
    <div className="balance-row" aria-live="polite">
      {showSkeleton ? (
        <BalanceSkeleton />
      ) : (
        <>
          <div
            className="balance-main"
            onClick={toggleDisplayUnit}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDisplayUnit() } }}
            aria-label={`Balance: ${displayInSats ? totalBalance.toLocaleString() + ' sats' : formatBSVShort(totalBalance) + ' BSV'}. Click to toggle display unit.`}
          >
            {displayInSats ? (
              <>
                <span className={`balance-value${syncing ? ' updating' : ''}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{totalBalance.toLocaleString()}</span>{' '}
                <span className="balance-unit clickable">sats</span>
              </>
            ) : (
              <>
                <span className={`balance-value${syncing ? ' updating' : ''}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{formatBSVShort(totalBalance)}</span>{' '}
                <span className="balance-unit clickable">BSV</span>
              </>
            )}
          </div>
          <div className="balance-sub">
            ${formatUSD(totalBalance)} USD
          </div>
        </>
      )}
      {showSkeleton ? null : lockedBalance > 0 ? (
        <div className="balance-locked">
          <Lock size={11} strokeWidth={2} />
          {displayInSats
            ? `${lockedBalance.toLocaleString()} locked`
            : `${formatBSVShort(lockedBalance)} locked`
          }
        </div>
      ) : null}
    </div>
  )
}

export const BalanceDisplay = memo(BalanceDisplayComponent)
