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
            <span className="balance-unit clickable">
              sats
              <svg
                className="toggle-hint"
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                {/* Simple up/down arrows to indicate toggle */}
                <path d="M5 1L5 9" />
                <path d="M2 3.5L5 1L8 3.5" />
                <path d="M2 6.5L5 9L8 6.5" />
              </svg>
            </span>
          </>
        ) : (
          <>
            <span className="balance-value">{formatBSVShort(totalBalance)}</span>{' '}
            <span className="balance-unit clickable">
              BSV
              <svg
                className="toggle-hint"
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                {/* Simple up/down arrows to indicate toggle */}
                <path d="M5 1L5 9" />
                <path d="M2 3.5L5 1L8 3.5" />
                <path d="M2 6.5L5 9L8 6.5" />
              </svg>
            </span>
          </>
        )}
      </div>
      <div className="balance-sub">${formatUSD(totalBalance)} USD</div>

      <style>{`
        .balance-unit.clickable {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          cursor: pointer;
          vertical-align: baseline;
        }

        .toggle-hint {
          opacity: 0.35;
          transition: opacity 0.15s ease;
        }

        .balance-main:hover .toggle-hint {
          opacity: 0.7;
        }
      `}</style>
    </div>
  )
}
