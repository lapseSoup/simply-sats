/**
 * AccountSwitcher Component
 *
 * Dropdown component for switching between wallet accounts.
 * Shows current account with balance preview and allows account management.
 */

import { useState, useRef, useEffect, memo, useCallback, useMemo } from 'react'
import { Check, ChevronDown, Plus, Download, Settings } from 'lucide-react'
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
        <Check className="check-icon" size={16} strokeWidth={2} />
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
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Current account: ${activeAccount?.name || 'Account 1'}`}
      >
        <div className="account-avatar">
          {activeAccount?.name.charAt(0).toUpperCase() || 'A'}
        </div>
        <span className="account-name">{activeAccount?.name || 'Account 1'}</span>
        <ChevronDown className={`dropdown-arrow ${isOpen ? 'open' : ''}`} size={12} strokeWidth={2} />
      </button>

      {isOpen && (
        <div className="account-dropdown">
          <div className="account-list" role="listbox">
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
              <Plus size={16} strokeWidth={1.75} />
              Add Account
            </button>
            <button
              className="account-action-button"
              onClick={handleImportClick}
            >
              <Download size={16} strokeWidth={1.75} />
              Import Account
            </button>
            <button
              className="account-action-button"
              onClick={handleManageClick}
            >
              <Settings size={16} strokeWidth={1.75} />
              Manage Accounts
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
