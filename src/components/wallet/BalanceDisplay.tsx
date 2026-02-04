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
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M1 6C1 3.24 3.24 1 6 1C7.38 1 8.63 1.56 9.53 2.47L11 1V4.5H7.5L9 3C8.25 2.37 7.17 2 6 2C3.79 2 2 3.79 2 6" />
                <path d="M11 6C11 8.76 8.76 11 6 11C4.62 11 3.37 10.44 2.47 9.53L1 11V7.5H4.5L3 9C3.75 9.63 4.83 10 6 10C8.21 10 10 8.21 10 6" />
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
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M1 6C1 3.24 3.24 1 6 1C7.38 1 8.63 1.56 9.53 2.47L11 1V4.5H7.5L9 3C8.25 2.37 7.17 2 6 2C3.79 2 2 3.79 2 6" />
                <path d="M11 6C11 8.76 8.76 11 6 11C4.62 11 3.37 10.44 2.47 9.53L1 11V7.5H4.5L3 9C3.75 9.63 4.83 10 6 10C8.21 10 10 8.21 10 6" />
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
          gap: 0.25rem;
          cursor: pointer;
          border-bottom: 1px dashed var(--color-text-secondary, rgba(255, 255, 255, 0.3));
          padding-bottom: 1px;
        }

        .toggle-hint {
          opacity: 0.5;
          transition: opacity 0.15s ease, transform 0.15s ease;
        }

        .balance-main:hover .toggle-hint {
          opacity: 1;
          transform: rotate(180deg);
        }
      `}</style>
    </div>
  )
}
