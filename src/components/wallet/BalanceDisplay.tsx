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

  return (
    <div className="balance-row" aria-live="polite">
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
      {lockedBalance > 0 && (
        <div className="balance-locked">
          <Lock size={11} strokeWidth={2} />
          {displayInSats
            ? `${lockedBalance.toLocaleString()} locked`
            : `${formatBSVShort(lockedBalance)} locked`
          }
        </div>
      )}
      <div className="balance-sub">
        ${formatUSD(totalBalance)} USD
      </div>
    </div>
  )
}

export const BalanceDisplay = memo(BalanceDisplayComponent)
