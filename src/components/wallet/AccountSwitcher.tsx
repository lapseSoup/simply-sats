/**
 * AccountSwitcher Component
 *
 * Dropdown component for switching between wallet accounts.
 * Shows current account with balance preview and allows account management.
 */

import { useState, useRef, useEffect } from 'react'
import type { Account } from '../../services/accounts'

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

  const activeAccount = accounts.find(a => a.id === activeAccountId)

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
              <button
                key={account.id}
                className={`account-item ${account.id === activeAccountId ? 'active' : ''}`}
                onClick={() => {
                  if (account.id !== activeAccountId) {
                    onSwitchAccount(account.id!)
                  }
                  setIsOpen(false)
                }}
                role="option"
                aria-selected={account.id === activeAccountId}
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
                {account.id === activeAccountId && (
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
            ))}
          </div>

          <div className="account-actions">
            <button
              className="account-action-button"
              onClick={() => {
                onCreateAccount()
                setIsOpen(false)
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3V13M3 8H13" />
              </svg>
              Add Account
            </button>
            <button
              className="account-action-button"
              onClick={() => {
                onManageAccounts()
                setIsOpen(false)
              }}
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
          gap: 0.5rem;
          padding: 0.375rem 0.75rem;
          background: var(--color-surface-2, rgba(255, 255, 255, 0.05));
          border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
          border-radius: 0.5rem;
          cursor: pointer;
          transition: all 0.15s ease;
          min-width: 140px;
        }

        .account-switcher-button:hover {
          background: var(--color-surface-3, rgba(255, 255, 255, 0.08));
          border-color: var(--color-border-hover, rgba(255, 255, 255, 0.2));
        }

        .account-avatar {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--color-primary, #f7931a), var(--color-secondary, #ff6b00));
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.75rem;
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
        }

        .account-name {
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--color-text, #fff);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .account-balance-preview {
          font-size: 0.6875rem;
          color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
        }

        .dropdown-arrow {
          transition: transform 0.15s ease;
          color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
        }

        .dropdown-arrow.open {
          transform: rotate(180deg);
        }

        .account-dropdown {
          position: absolute;
          top: calc(100% + 0.5rem);
          right: 0;
          min-width: 220px;
          background: var(--color-surface, #1a1a2e);
          border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
          border-radius: 0.75rem;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          z-index: 100;
          overflow: hidden;
        }

        .account-list {
          max-height: 240px;
          overflow-y: auto;
          padding: 0.5rem;
        }

        .account-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          width: 100%;
          padding: 0.625rem 0.75rem;
          background: transparent;
          border: none;
          border-radius: 0.5rem;
          cursor: pointer;
          transition: background 0.15s ease;
          text-align: left;
        }

        .account-item:hover {
          background: var(--color-surface-2, rgba(255, 255, 255, 0.05));
        }

        .account-item.active {
          background: var(--color-surface-3, rgba(255, 255, 255, 0.08));
        }

        .account-item-info {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-width: 0;
        }

        .account-item-name {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--color-text, #fff);
        }

        .account-item-address {
          font-size: 0.75rem;
          color: var(--color-text-secondary, rgba(255, 255, 255, 0.5));
          font-family: monospace;
        }

        .check-icon {
          color: var(--color-primary, #f7931a);
          flex-shrink: 0;
        }

        .account-actions {
          padding: 0.5rem;
          border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .account-action-button {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
          padding: 0.5rem 0.75rem;
          background: transparent;
          border: none;
          border-radius: 0.375rem;
          cursor: pointer;
          font-size: 0.8125rem;
          color: var(--color-text-secondary, rgba(255, 255, 255, 0.7));
          transition: all 0.15s ease;
        }

        .account-action-button:hover {
          background: var(--color-surface-2, rgba(255, 255, 255, 0.05));
          color: var(--color-text, #fff);
        }

        .account-action-button svg {
          flex-shrink: 0;
        }
      `}</style>
    </div>
  )
}
