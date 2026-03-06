/**
 * AddressPicker Component Tests
 *
 * Tests the address picker dropdown including:
 * - Rendering and toggle behavior
 * - Address list display (recent + saved)
 * - Selection callback
 * - Empty state
 * - Accessibility attributes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddressPicker } from './AddressPicker'

const mockLoadAddresses = vi.fn()

vi.mock('../../hooks/useAddressBook', () => ({
  useAddressBook: () => ({
    loadAddresses: (...args: unknown[]) => mockLoadAddresses(...args),
  }),
}))

const sampleRecent = [
  { id: 1, address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', label: 'Alice', lastUsedAt: Date.now(), useCount: 3, accountId: 1 },
  { id: 2, address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', label: 'Bob', lastUsedAt: Date.now() - 1000, useCount: 1, accountId: 1 },
]

const sampleSaved = [
  { id: 3, address: '1CounterpartyXXXXXXXXXXXXXXXUWLpVr', label: 'Savings', lastUsedAt: 0, useCount: 0, accountId: 1 },
]

describe('AddressPicker', () => {
  const mockOnSelect = vi.fn()
  const accountId = 1

  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadAddresses.mockResolvedValue({ recent: sampleRecent, saved: sampleSaved })
  })

  it('renders the address book toggle button', async () => {
    render(<AddressPicker onSelect={mockOnSelect} accountId={accountId} />)

    // Wait for the async loadAddresses on mount to settle
    await waitFor(() => {
      expect(mockLoadAddresses).toHaveBeenCalled()
    })

    const toggleBtn = screen.getByLabelText('Open address book')
    expect(toggleBtn).toBeInTheDocument()
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens dropdown and displays recent and saved addresses', async () => {
    render(<AddressPicker onSelect={mockOnSelect} accountId={accountId} />)

    const toggleBtn = screen.getByLabelText('Open address book')
    fireEvent.click(toggleBtn)

    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true')

    // Wait for addresses to load
    await waitFor(() => {
      expect(screen.getByText('Recent')).toBeInTheDocument()
      expect(screen.getByText('Saved')).toBeInTheDocument()
    })

    // Check individual entries render with labels
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Savings')).toBeInTheDocument()
  })

  it('calls onSelect with the address when an entry is clicked', async () => {
    render(<AddressPicker onSelect={mockOnSelect} accountId={accountId} />)

    fireEvent.click(screen.getByLabelText('Open address book'))

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })

    // Click the Alice entry row
    fireEvent.click(screen.getByText('Alice'))

    expect(mockOnSelect).toHaveBeenCalledWith('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')
  })

  it('closes the dropdown after selecting an address', async () => {
    render(<AddressPicker onSelect={mockOnSelect} accountId={accountId} />)

    fireEvent.click(screen.getByLabelText('Open address book'))

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Alice'))

    // Dropdown should close — listbox should no longer be present
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('shows empty state when no addresses exist', async () => {
    mockLoadAddresses.mockResolvedValue({ recent: [], saved: [] })

    render(<AddressPicker onSelect={mockOnSelect} accountId={accountId} />)

    fireEvent.click(screen.getByLabelText('Open address book'))

    await waitFor(() => {
      expect(screen.getByText('No saved addresses')).toBeInTheDocument()
    })
  })

  it('renders aria-selected attribute on address rows', async () => {
    render(<AddressPicker onSelect={mockOnSelect} accountId={accountId} />)

    fireEvent.click(screen.getByLabelText('Open address book'))

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })

    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      expect(option).toHaveAttribute('aria-selected')
    }
  })
})
