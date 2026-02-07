import { useState, useEffect } from 'react'
import { RefreshCw, Settings } from 'lucide-react'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import { SimplySatsLogo } from '../shared/SimplySatsLogo'
import { AccountSwitcher } from './AccountSwitcher'
import { getBalanceFromDB } from '../../services/database'
import { walletLogger } from '../../services/logger'

interface HeaderProps {
  onSettingsClick: () => void
  onAccountModalOpen: (mode: 'create' | 'import' | 'manage') => void
  onAccountSwitch?: () => void
}

export function Header({ onSettingsClick, onAccountModalOpen, onAccountSwitch }: HeaderProps) {
  const {
    wallet,
    networkInfo,
    syncing,
    performSync,
    fetchData,
    accounts,
    activeAccountId,
    switchAccount,
    balance
  } = useWallet()
  const { formatBSVShort, showToast } = useUI()

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
      if (success) {
        onAccountSwitch?.()
      } else {
        walletLogger.error('Failed to switch account - session password may be missing')
        showToast('Please unlock wallet to switch accounts')
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
            {networkInfo?.blockHeight ? networkInfo.blockHeight.toLocaleString() : '...'}
          </div>
          <button
            className={`icon-btn ${syncing || manualSyncing ? 'active' : ''}`}
            onClick={handleSync}
            title="Sync wallet"
            aria-label={syncing || manualSyncing ? 'Syncing...' : 'Sync wallet'}
            disabled={manualSyncing}
          >
            <RefreshCw size={16} strokeWidth={1.75} className={syncing || manualSyncing ? 'spinning' : ''} />
          </button>
          <button
            className="icon-btn"
            onClick={onSettingsClick}
            aria-label="Settings"
            title="Settings"
          >
            <Settings size={16} strokeWidth={1.75} />
          </button>
        </div>
      </header>
  )
}
