import { useState } from 'react'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import { SimplySatsLogo } from '../shared/SimplySatsLogo'
import { AccountSwitcher } from './AccountSwitcher'
import { PasswordPromptModal } from '../modals/PasswordPromptModal'

interface HeaderProps {
  onSettingsClick: () => void
  onAccountModalOpen: (mode: 'create' | 'import' | 'manage') => void
}

export function Header({ onSettingsClick, onAccountModalOpen }: HeaderProps) {
  const {
    networkInfo,
    syncing,
    performSync,
    fetchData,
    accounts,
    activeAccountId,
    switchAccount,
    lockWallet,
    balance
  } = useWallet()
  const { formatBSVShort } = useUI()

  // Password prompt state for account switching
  const [passwordPrompt, setPasswordPrompt] = useState<{
    accountId: number
    accountName: string
  } | null>(null)

  const handleSync = async () => {
    await performSync(false)
    await fetchData()
  }

  const handleSwitchAccount = (accountId: number) => {
    const account = accounts.find(a => a.id === accountId)
    if (account && accountId !== activeAccountId) {
      setPasswordPrompt({
        accountId,
        accountName: account.name
      })
    }
  }

  const handlePasswordSubmit = async (password: string): Promise<boolean> => {
    if (!passwordPrompt) return false
    const success = await switchAccount(passwordPrompt.accountId, password)
    if (success) {
      setPasswordPrompt(null)
    }
    return success
  }

  // Format balance for account preview
  const formatBalance = (sats: number) => {
    if (sats >= 100000000) {
      return formatBSVShort(sats) + ' BSV'
    }
    return sats.toLocaleString() + ' sats'
  }

  // Build account balances map (currently only active account has balance)
  const accountBalances: Record<number, number> = {}
  if (activeAccountId) {
    accountBalances[activeAccountId] = balance
  }

  return (
    <>
      <header className="header">
        <div className="header-left">
          {accounts.length > 0 ? (
            <AccountSwitcher
              accounts={accounts}
              activeAccountId={activeAccountId}
              onSwitchAccount={handleSwitchAccount}
              onCreateAccount={() => onAccountModalOpen('create')}
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
            title={`Block ${networkInfo?.blockHeight?.toLocaleString() || '...'}`}
          >
            <span className="status-dot online" aria-hidden="true"></span>
            <span className="sr-only">Current block height:</span>
            {networkInfo?.blockHeight?.toLocaleString() || '...'}
          </div>
          <button
            className="icon-btn"
            onClick={lockWallet}
            title="Lock wallet"
            aria-label="Lock wallet"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="7" width="10" height="7" rx="1" />
              <path d="M5 7V5C5 3.34 6.34 2 8 2C9.66 2 11 3.34 11 5V7" />
            </svg>
          </button>
          <button
            className={`icon-btn ${syncing ? 'active' : ''}`}
            onClick={handleSync}
            title="Sync wallet"
            aria-label={syncing ? 'Syncing...' : 'Sync wallet'}
            disabled={syncing}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className={syncing ? 'spinning' : ''}
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

      {/* Password prompt for account switching */}
      <PasswordPromptModal
        isOpen={passwordPrompt !== null}
        title={`Switch to ${passwordPrompt?.accountName || 'Account'}`}
        message="Enter the password to unlock this account."
        submitLabel="Switch Account"
        onSubmit={handlePasswordSubmit}
        onCancel={() => setPasswordPrompt(null)}
      />

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
