import { memo } from 'react'
import { Lock } from 'lucide-react'
import { useWalletState } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { useNetwork } from '../../contexts/NetworkContext'

function BalanceDisplayComponent() {
  const { balance, ordBalance, locks } = useWalletState()
  const { displayInSats, toggleDisplayUnit, formatBSVShort, formatUSD } = useUI()
  const { syncing } = useNetwork()

  const totalBalance = balance + ordBalance
  const lockedBalance = locks.reduce((sum, l) => sum + l.satoshis, 0)
  const isInitialSync = totalBalance === 0 && syncing

  return (
    <div className="balance-row" aria-live="polite">
      {isInitialSync ? (
        <>
          <div className="balance-main">
            <div className="balance-skeleton-bar balance-skeleton-bar--main skeleton" aria-label="Loading balance..." />
          </div>
          <div className="balance-sub">
            <div className="balance-skeleton-bar balance-skeleton-bar--sub skeleton" />
          </div>
        </>
      ) : (
        <>
          <div
            className="balance-main"
            onClick={toggleDisplayUnit}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && toggleDisplayUnit()}
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
      {lockedBalance > 0 && (
        <div className="balance-locked">
          <Lock size={11} strokeWidth={2} />
          {displayInSats
            ? `${lockedBalance.toLocaleString()} locked`
            : `${formatBSVShort(lockedBalance)} locked`
          }
        </div>
      )}
    </div>
  )
}

export const BalanceDisplay = memo(BalanceDisplayComponent)
