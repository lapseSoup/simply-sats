import { ArrowUpDown } from 'lucide-react'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'

export function BalanceDisplay() {
  const { balance, ordBalance, syncing } = useWallet()
  const { displayInSats, toggleDisplayUnit, formatBSVShort, formatUSD } = useUI()

  const totalBalance = balance + ordBalance

  return (
    <div className="balance-row">
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
            <span className="balance-value" style={{ fontVariantNumeric: 'tabular-nums' }}>{totalBalance.toLocaleString()}</span>{' '}
            <span className="balance-unit clickable">
              sats
              <ArrowUpDown className="toggle-hint" size={10} strokeWidth={1.5} aria-hidden="true" />
            </span>
          </>
        ) : (
          <>
            <span className="balance-value" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatBSVShort(totalBalance)}</span>{' '}
            <span className="balance-unit clickable">
              BSV
              <ArrowUpDown className="toggle-hint" size={10} strokeWidth={1.5} aria-hidden="true" />
            </span>
          </>
        )}
      </div>
      <div className="balance-sub">
        ${formatUSD(totalBalance)} USD
        {syncing && <span className="sync-indicator" aria-label="Syncing"> syncing...</span>}
      </div>

    </div>
  )
}
