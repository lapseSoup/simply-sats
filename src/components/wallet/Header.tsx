import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Settings } from 'lucide-react'
import { useWalletState, useWalletActions } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { SimplySatsLogo } from '../shared/SimplySatsLogo'
import { AccountSwitcher } from './AccountSwitcher'
import { getBalanceFromDB } from '../../infrastructure/database'
import { walletLogger } from '../../services/logger'
import { getLastSwitchDiag } from '../../hooks/useAccountSwitching'

interface HeaderProps {
  onSettingsClick: () => void
  onAccountModalOpen: (mode: 'create' | 'import' | 'manage') => void
  onAccountSwitch?: () => void
}

export function Header({ onSettingsClick, onAccountModalOpen, onAccountSwitch }: HeaderProps) {
  const { wallet, networkInfo, syncing, accounts, activeAccountId, balance } = useWalletState()
  const { performSync, fetchData, switchAccount } = useWalletActions()
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
            const defaultResult = await getBalanceFromDB('default', account.id)
            const derivedResult = await getBalanceFromDB('derived', account.id)
            const defaultBal = defaultResult.ok ? defaultResult.value : 0
            const derivedBal = derivedResult.ok ? derivedResult.value : 0
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

  const handleSync = useCallback(async () => {
    setManualSyncing(true)
    try {
      await performSync(false)
      await fetchData()
    } finally {
      setManualSyncing(false)
    }
  }, [performSync, fetchData])

  const handleSwitchAccount = useCallback(async (accountId: number) => {
    if (accountId !== activeAccountId) {
      const success = await switchAccount(accountId)
      if (success) {
        onAccountSwitch?.()
      } else {
        const diag = getLastSwitchDiag()
        walletLogger.error('Failed to switch account', { diag })
        const isLocked = diag.toLowerCase().includes('mnemonic') || diag.toLowerCase().includes('locked') || diag.toLowerCase().includes('no pwd')
        showToast(
          isLocked
            ? 'Please unlock your wallet to switch accounts.'
            : 'Failed to switch account. Please try again.',
          'warning'
        )
      }
      // fetchData is triggered automatically by App.tsx useEffect
      // when wallet + activeAccountId state updates after re-render
    }
  }, [activeAccountId, switchAccount, onAccountSwitch, showToast])

  // Format balance for account preview
  const formatBalance = useCallback((sats: number) => {
    if (sats >= 100000000) {
      return formatBSVShort(sats) + ' BSV'
    }
    return sats.toLocaleString() + ' sats'
  }, [formatBSVShort])

  // Derive network status for indicator
  const networkStatus = !networkInfo ? 'offline' : 'online'
  const statusTooltip = !networkInfo
    ? 'Network: Disconnected'
    : `Block ${networkInfo.blockHeight?.toLocaleString() || '...'}${networkInfo.overlayHealthy ? ' | Overlay: Healthy' : ''}`

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
