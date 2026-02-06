import { useState, useEffect } from 'react'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import { SimplySatsLogo } from '../shared/SimplySatsLogo'
import { AccountSwitcher } from './AccountSwitcher'
import { getBalanceFromDB } from '../../services/database'
import { walletLogger } from '../../services/logger'

interface HeaderProps {
  onSettingsClick: () => void
  onAccountModalOpen: (mode: 'create' | 'import' | 'manage') => void
}

export function Header({ onSettingsClick, onAccountModalOpen }: HeaderProps) {
  const {
    wallet,
    networkInfo,
    performSync,
    fetchData,
    accounts,
    activeAccountId,
    switchAccount,
    balance
  } = useWallet()
  const { formatBSVShort } = useUI()

  // Track manual sync separately for button animation
  const [manualSyncing, setManualSyncing] = useState(false)

  // Store balances for all accounts
  const [accountBalances, setAccountBalances] = useState<Record<number, number>>({})

  // Fetch balances for all accounts
  useEffect(() => {
    const fetchAccountBalances = async () => {
      const balances: Record<number, number> = {}
      for (const account of accounts) {
        if (account.id) {
          try {
            // Sum default + derived baskets for each account
            const defaultBal = await getBalanceFromDB('default', account.id)
            const derivedBal = await getBalanceFromDB('derived', account.id)
            balances[account.id] = defaultBal + derivedBal
          } catch {
            balances[account.id] = 0
          }
        }
      }
      setAccountBalances(balances)
    }

    if (accounts.length > 0) {
      fetchAccountBalances()
    }
  }, [accounts, balance]) // Re-fetch when accounts change or when balance updates (after sync)

  const handleSync = async () => {
    setManualSyncing(true)
    try {
      await performSync(false)
      await fetchData()
    } finally {
      setManualSyncing(false)
    }
  }

  const handleSwitchAccount = async (accountId: number) => {
    if (accountId !== activeAccountId) {
      const success = await switchAccount(accountId)
      if (!success) {
        walletLogger.error('Failed to switch account - session password may be missing')
      }
      // fetchData is triggered automatically by App.tsx useEffect
      // when wallet + activeAccountId state updates after re-render
    }
  }

  // Format balance for account preview
  const formatBalance = (sats: number) => {
    if (sats >= 100000000) {
      return formatBSVShort(sats) + ' BSV'
    }
    return sats.toLocaleString() + ' sats'
  }

  // Derive network status for indicator
  const networkStatus = !networkInfo ? 'offline' : networkInfo.overlayHealthy ? 'online' : 'degraded'
  const statusTooltip = !networkInfo
    ? 'Network: Disconnected'
    : `Block ${networkInfo.blockHeight?.toLocaleString() || '...'} | Overlay: ${networkInfo.overlayHealthy ? 'Healthy' : 'Degraded'}`

  return (
    <>
      <header className="header">
        <div className="header-left">
          {wallet ? (
            <AccountSwitcher
              accounts={accounts}
              activeAccountId={activeAccountId}
              onSwitchAccount={handleSwitchAccount}
              onCreateAccount={() => onAccountModalOpen('create')}
              onImportAccount={() => onAccountModalOpen('import')}
              onManageAccounts={() => onAccountModalOpen('manage')}
              formatBalance={formatBalance}
              accountBalances={accountBalances}
            />
          ) : (
            <div className="logo">
              <div className="logo-icon">
                <SimplySatsLogo size={18} />
              </div>
              Simply Sats
              <span className="header-badge">BRC-100</span>
            </div>
          )}
        </div>

        <div className="header-actions">
          <div
            className="header-status"
            title={statusTooltip}
          >
            <span className={`status-dot ${networkStatus}`} aria-hidden="true"></span>
            <span className="sr-only">Current block height:</span>
            {networkInfo?.blockHeight?.toLocaleString() || '...'}
          </div>
          <button
            className={`icon-btn ${manualSyncing ? 'active' : ''}`}
            onClick={handleSync}
            title="Sync wallet"
            aria-label={manualSyncing ? 'Syncing...' : 'Sync wallet'}
            disabled={manualSyncing}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className={manualSyncing ? 'spinning' : ''}
            >
              <path d="M1 8C1 4.13 4.13 1 8 1C10.12 1 12 2 13.25 3.5L15 2V6H11L13 4C12 2.5 10 1.5 8 1.5C4.41 1.5 1.5 4.41 1.5 8" />
              <path d="M15 8C15 11.87 11.87 15 8 15C5.88 15 4 14 2.75 12.5L1 14V10H5L3 12C4 13.5 6 14.5 8 14.5C11.59 14.5 14.5 11.59 14.5 8" />
            </svg>
          </button>
          <button
            className="icon-btn"
            onClick={onSettingsClick}
            aria-label="Settings"
            title="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              {/* Gear/cog icon */}
              <path d="M6.5 1.5h3l.3 1.8.7.3 1.5-1 2.1 2.1-1 1.5.3.7 1.8.3v3l-1.8.3-.3.7 1 1.5-2.1 2.1-1.5-1-.7.3-.3 1.8h-3l-.3-1.8-.7-.3-1.5 1-2.1-2.1 1-1.5-.3-.7-1.8-.3v-3l1.8-.3.3-.7-1-1.5 2.1-2.1 1.5 1 .7-.3.3-1.8z" />
              <circle cx="8" cy="8" r="2" />
            </svg>
          </button>
        </div>
      </header>

      <style>{`
        .header-left {
          display: flex;
          align-items: center;
          min-width: 0;
          flex: 1;
        }

        .icon-btn svg {
          display: block;
        }

        .icon-btn svg.spinning {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  )
}
