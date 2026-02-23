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
  isSwitching,
  onSelect,
  balance,
  formatBalance
}: {
  account: Account
  isActive: boolean
  isSwitching: boolean
  onSelect: () => void
  balance?: number
  formatBalance: (sats: number) => string
}) {
  return (
    <button
      className={`account-item ${isActive ? 'active' : ''}`}
      onClick={onSelect}
      disabled={isSwitching}
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
      {isSwitching ? (
        <span className="spinner-small" />
      ) : isActive ? (
        <Check className="check-icon" size={16} strokeWidth={2} />
      ) : null}
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
  const [switchingAccountId, setSwitchingAccountId] = useState<number | null>(null)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const closeDropdown = useCallback(() => {
    setIsOpen(false)
    setFocusedIndex(-1)
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        closeDropdown()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [closeDropdown])

  // Keyboard navigation when dropdown is open
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeDropdown()
        return
      }

      if (!isOpen) return

      const buttons = dropdownRef.current?.querySelectorAll<HTMLButtonElement>(
        '.account-dropdown button'
      )
      if (!buttons || buttons.length === 0) return
      const count = buttons.length

      let nextIndex = -1

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          nextIndex = focusedIndex < count - 1 ? focusedIndex + 1 : 0
          break
        case 'ArrowUp':
          event.preventDefault()
          nextIndex = focusedIndex > 0 ? focusedIndex - 1 : count - 1
          break
        case 'Home':
          event.preventDefault()
          nextIndex = 0
          break
        case 'End':
          event.preventDefault()
          nextIndex = count - 1
          break
        case 'Tab':
          event.preventDefault()
          if (event.shiftKey) {
            nextIndex = focusedIndex > 0 ? focusedIndex - 1 : count - 1
          } else {
            nextIndex = focusedIndex < count - 1 ? focusedIndex + 1 : 0
          }
          break
        default:
          return
      }

      setFocusedIndex(nextIndex)
      buttons[nextIndex]?.focus()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, focusedIndex, closeDropdown])

  // Auto-focus active account when dropdown opens
  useEffect(() => {
    if (!isOpen) return

    // Use requestAnimationFrame to ensure the dropdown DOM is rendered
    requestAnimationFrame(() => {
      const buttons = dropdownRef.current?.querySelectorAll<HTMLButtonElement>(
        '.account-dropdown button'
      )
      if (!buttons || buttons.length === 0) return

      // Find the active account button index
      const activeIndex = Array.from(buttons).findIndex(
        btn => btn.getAttribute('aria-selected') === 'true'
      )
      const initialIndex = activeIndex >= 0 ? activeIndex : 0
      setFocusedIndex(initialIndex)
      buttons[initialIndex]?.focus()
    })
  }, [isOpen])

  const activeAccount = useMemo(
    () => accounts.find(a => a.id === activeAccountId),
    [accounts, activeAccountId]
  )

  // Sort accounts alphabetically by name
  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.name.localeCompare(b.name)),
    [accounts]
  )

  // Memoized handler to handle account selection with loading indicator
  const handleAccountSelect = useCallback((accountId: number) => {
    if (accountId === activeAccountId) {
      closeDropdown()
      return
    }
    setSwitchingAccountId(accountId)
    onSwitchAccount(accountId)
    // Brief delay to show the spinner before closing
    setTimeout(() => {
      closeDropdown()
      setSwitchingAccountId(null)
    }, 200)
  }, [activeAccountId, onSwitchAccount, closeDropdown])

  const handleCreateClick = useCallback(() => {
    onCreateAccount()
    closeDropdown()
  }, [onCreateAccount, closeDropdown])

  const handleImportClick = useCallback(() => {
    onImportAccount()
    closeDropdown()
  }, [onImportAccount, closeDropdown])

  const handleManageClick = useCallback(() => {
    onManageAccounts()
    closeDropdown()
  }, [onManageAccounts, closeDropdown])

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
                isSwitching={switchingAccountId === account.id}
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
