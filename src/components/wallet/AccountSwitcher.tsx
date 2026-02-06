/**
 * AccountSwitcher Component
 *
 * Dropdown component for switching between wallet accounts.
 * Shows current account with balance preview and allows account management.
 */

import { useState, useRef, useEffect, memo, useCallback, useMemo } from 'react'
import type { Account } from '../../services/accounts'

// Memoized account item to prevent unnecessary re-renders
const AccountItem = memo(function AccountItem({
  account,
  isActive,
  onSelect,
  balance,
  formatBalance
}: {
  account: Account
  isActive: boolean
  onSelect: () => void
  balance?: number
  formatBalance: (sats: number) => string
}) {
  return (
    <button
      className={`account-item ${isActive ? 'active' : ''}`}
      onClick={onSelect}
      role="option"
      aria-selected={isActive}
    >
      <div className="account-avatar">
        {account.name.charAt(0).toUpperCase()}
      </div>
      <div className="account-item-info">
        <span className="account-item-name">{account.name}</span>
        {balance !== undefined && (
          <span className="account-item-balance">{formatBalance(balance)}</span>
        )}
      </div>
      {isActive && (
        <svg
          className="check-icon"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 8L6 11L13 4" />
        </svg>
      )}
    </button>
  )
})

interface AccountSwitcherProps {
  accounts: Account[]
  activeAccountId: number | null
  onSwitchAccount: (accountId: number) => void
  onCreateAccount: () => void
  onImportAccount: () => void
  onManageAccounts: () => void
  formatBalance: (sats: number) => string
  accountBalances?: Record<number, number>
}

export function AccountSwitcher({
  accounts,
  activeAccountId,
  onSwitchAccount,
  onCreateAccount,
  onImportAccount,
  onManageAccounts,
  formatBalance,
  accountBalances = {}
}: AccountSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close on escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  const activeAccount = useMemo(
    () => accounts.find(a => a.id === activeAccountId),
    [accounts, activeAccountId]
  )

  // Sort accounts alphabetically by name
  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.name.localeCompare(b.name)),
    [accounts]
  )

  // Memoized handler to handle account selection
  const handleAccountSelect = useCallback((accountId: number) => {
    if (accountId !== activeAccountId) {
      onSwitchAccount(accountId)
    }
    setIsOpen(false)
  }, [activeAccountId, onSwitchAccount])

  const handleCreateClick = useCallback(() => {
    onCreateAccount()
    setIsOpen(false)
  }, [onCreateAccount])

  const handleImportClick = useCallback(() => {
    onImportAccount()
    setIsOpen(false)
  }, [onImportAccount])

  const handleManageClick = useCallback(() => {
    onManageAccounts()
    setIsOpen(false)
  }, [onManageAccounts])

  return (
    <div className="account-switcher" ref={dropdownRef}>
      <button
        className="account-switcher-button"
        onClick={() => accounts.length > 0 && setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Current account: ${activeAccount?.name || 'Account 1'}`}
      >
        <div className="account-avatar">
          {activeAccount?.name.charAt(0).toUpperCase() || 'A'}
        </div>
        <span className="account-name">{activeAccount?.name || 'Account 1'}</span>
        <svg
          className={`dropdown-arrow ${isOpen ? 'open' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>

      {isOpen && (
        <div className="account-dropdown" role="listbox">
          <div className="account-list">
            {sortedAccounts.map(account => (
              <AccountItem
                key={account.id}
                account={account}
                isActive={account.id === activeAccountId}
                onSelect={() => handleAccountSelect(account.id!)}
                balance={account.id ? accountBalances[account.id] : undefined}
                formatBalance={formatBalance}
              />
            ))}
          </div>

          <div className="account-actions">
            <button
              className="account-action-button"
              onClick={handleCreateClick}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3V13M3 8H13" />
              </svg>
              Add Account
            </button>
            <button
              className="account-action-button"
              onClick={handleImportClick}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 8L8 13L13 8M8 2V13" />
              </svg>
              Import Account
            </button>
            <button
              className="account-action-button"
              onClick={handleManageClick}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="8" cy="8" r="2" />
                <path d="M8 1V3M8 13V15M1 8H3M13 8H15M2.5 2.5L4 4M12 12L13.5 13.5M2.5 13.5L4 12M12 4L13.5 2.5" />
              </svg>
              Manage Accounts
            </button>
          </div>
        </div>
      )}

      <style>{`
        .account-switcher {
          position: relative;
        }

        .account-switcher-button {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px 4px 4px;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all 0.2s ease;
          height: 30px;
        }

        .account-switcher-button:hover {
          background: var(--bg-tertiary);
          border-color: var(--border-light);
        }

        .account-avatar {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 600;
          color: white;
          flex-shrink: 0;
        }

        .account-name {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 120px;
        }

        .dropdown-arrow {
          transition: transform 0.15s ease;
          color: var(--text-tertiary);
          flex-shrink: 0;
        }

        .dropdown-arrow.open {
          transform: rotate(180deg);
        }

        .account-dropdown {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          min-width: 240px;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          z-index: 100;
          overflow: hidden;
        }

        .account-list {
          max-height: 240px;
          overflow-y: auto;
          padding: 8px;
        }

        .account-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px 12px;
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: background 0.15s ease;
          text-align: left;
        }

        .account-item:hover {
          background: var(--bg-tertiary);
        }

        .account-item.active {
          background: var(--bg-elevated);
        }

        .account-item-info {
          display: flex;
          align-items: baseline;
          flex: 1;
          min-width: 0;
          gap: 8px;
        }

        .account-item-name {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .account-item-balance {
          font-size: 11px;
          color: var(--text-secondary);
          white-space: nowrap;
          font-weight: 500;
          margin-left: auto;
        }

        .check-icon {
          color: var(--accent);
          flex-shrink: 0;
        }

        .account-actions {
          padding: 8px;
          border-top: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .account-action-button {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
          background: transparent;
          border: none;
          border-radius: var(--radius-sm);
          cursor: pointer;
          font-size: 13px;
          color: var(--text-secondary);
          transition: all 0.15s ease;
        }

        .account-action-button:hover {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .account-action-button svg {
          flex-shrink: 0;
        }
      `}</style>
    </div>
  )
}
