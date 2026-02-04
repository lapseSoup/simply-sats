import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'

export function BalanceDisplay() {
  const { balance, ordBalance } = useWallet()
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
            <span className="balance-value">{totalBalance.toLocaleString()}</span>{' '}
            <span className="balance-unit clickable">sats</span>
          </>
        ) : (
          <>
            <span className="balance-value">{formatBSVShort(totalBalance)}</span>{' '}
            <span className="balance-unit clickable">BSV</span>
          </>
        )}
      </div>
      <div className="balance-sub">${formatUSD(totalBalance)} USD</div>
    </div>
  )
}
