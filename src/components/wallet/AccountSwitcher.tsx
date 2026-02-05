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
  onSelect
}: {
  account: Account
  isActive: boolean
  onSelect: () => void
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
        <span className="account-item-address">
          {account.identityAddress.slice(0, 8)}...{account.identityAddress.slice(-6)}
        </span>
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
  onManageAccounts: () => void
  formatBalance: (sats: number) => string
  accountBalances?: Record<number, number>
}

export function AccountSwitcher({
  accounts,
  activeAccountId,
  onSwitchAccount,
  onCreateAccount,
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

  const handleManageClick = useCallback(() => {
    onManageAccounts()
    setIsOpen(false)
  }, [onManageAccounts])

  if (accounts.length === 0) {
    return null
  }

  return (
    <div className="account-switcher" ref={dropdownRef}>
      <button
        className="account-switcher-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Current account: ${activeAccount?.name || 'Select account'}`}
      >
        <div className="account-avatar">
          {activeAccount?.name.charAt(0).toUpperCase() || '?'}
        </div>
        <div className="account-info">
          <span className="account-name">{activeAccount?.name || 'No Account'}</span>
          {activeAccountId && accountBalances[activeAccountId] !== undefined && (
            <span className="account-balance-preview">
              {formatBalance(accountBalances[activeAccountId])}
            </span>
          )}
        </div>
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
            {accounts.map(account => (
              <AccountItem
                key={account.id}
                account={account}
                isActive={account.id === activeAccountId}
                onSelect={() => handleAccountSelect(account.id!)}
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
          gap: 8px;
          padding: 4px 10px 4px 4px;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all 0.2s ease;
          min-width: 130px;
          height: 30px;
        }

        .account-switcher-button:hover {
          background: var(--bg-tertiary);
          border-color: var(--border-light);
        }

        .account-avatar {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 600;
          color: white;
          flex-shrink: 0;
        }

        .account-info {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          flex: 1;
          min-width: 0;
          line-height: 1.2;
        }

        .account-name {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .account-balance-preview {
          font-size: 10px;
          color: var(--text-tertiary);
        }

        .dropdown-arrow {
          transition: transform 0.15s ease;
          color: var(--text-tertiary);
          margin-left: auto;
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
          flex-direction: column;
          flex: 1;
          min-width: 0;
          gap: 2px;
        }

        .account-item-name {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 140px;
        }

        .account-item-address {
          font-size: 11px;
          color: var(--text-tertiary);
          font-family: var(--font-mono);
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
