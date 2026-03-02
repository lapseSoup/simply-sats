/**
 * Address Picker Component
 *
 * Dropdown/popover for selecting saved and recent BSV addresses.
 * Used on the Send BSV form for quick address selection.
 *
 * @module components/shared/AddressPicker
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { BookOpen } from 'lucide-react'
import { getAddressBook, getRecentAddresses } from '../../infrastructure/database'
import type { AddressBookEntry } from '../../infrastructure/database'

interface AddressPickerProps {
  onSelect: (address: string) => void
  accountId: number
}

function truncateAddress(addr: string): string {
  if (addr.length <= 16) return addr
  return `${addr.slice(0, 8)}...${addr.slice(-8)}`
}

export function AddressPicker({ onSelect, accountId }: AddressPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [recentAddresses, setRecentAddresses] = useState<AddressBookEntry[]>([])
  const [savedAddresses, setSavedAddresses] = useState<AddressBookEntry[]>([])
  const wrapperRef = useRef<HTMLDivElement>(null)

  const loadAddresses = useCallback(async () => {
    const [recentResult, savedResult] = await Promise.all([
      getRecentAddresses(accountId, 5),
      getAddressBook(accountId),
    ])

    if (recentResult.ok) {
      setRecentAddresses(recentResult.value)
    }
    if (savedResult.ok) {
      setSavedAddresses(savedResult.value)
    }
  }, [accountId])

  // Load addresses on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Async data fetch on mount is intentional
    void loadAddresses()
  }, [loadAddresses])

  // Reload when dropdown opens
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Async data fetch on open is intentional
      void loadAddresses()
    }
  }, [isOpen, loadAddresses])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    const handleMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [isOpen])

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  const handleSelect = useCallback(
    (address: string) => {
      onSelect(address)
      setIsOpen(false)
    },
    [onSelect]
  )

  const hasRecent = recentAddresses.length > 0
  const hasSaved = savedAddresses.length > 0
  const isEmpty = !hasRecent && !hasSaved

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={toggle}
        aria-label="Open address book"
        aria-expanded={isOpen}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isOpen ? 'var(--accent)' : 'var(--text-secondary)',
          borderRadius: '4px',
        }}
      >
        <BookOpen size={16} />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Address book"
          className="address-picker-dropdown"
        >
          {isEmpty && (
            <div className="address-picker-empty">
              No saved addresses
            </div>
          )}

          {hasRecent && (
            <div>
              <div className="address-picker-section-label">
                Recent
              </div>
              {recentAddresses.map((entry) => (
                <AddressRow
                  key={`recent-${entry.address}`}
                  entry={entry}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          )}

          {hasRecent && hasSaved && (
            <div className="address-picker-divider" />
          )}

          {hasSaved && (
            <div>
              <div className="address-picker-section-label">
                Saved
              </div>
              {savedAddresses.map((entry) => (
                <AddressRow
                  key={`saved-${entry.address}`}
                  entry={entry}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AddressRow({
  entry,
  onSelect,
}: {
  entry: AddressBookEntry
  onSelect: (address: string) => void
}) {
  const handleClick = useCallback(() => {
    onSelect(entry.address)
  }, [onSelect, entry.address])

  return (
    <div
      role="option"
      tabIndex={0}
      className="address-picker-row"
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
    >
      {entry.label && (
        <div
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            lineHeight: 1.3,
          }}
        >
          {entry.label}
        </div>
      )}
      <div
        style={{
          fontSize: '12px',
          color: 'var(--text-secondary)',
          fontFamily: 'monospace',
          lineHeight: 1.3,
        }}
      >
        {truncateAddress(entry.address)}
      </div>
    </div>
  )
}
