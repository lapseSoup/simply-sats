/**
 * EmptyState Component Tests
 *
 * Tests the EmptyState presentational component including:
 * - Rendering title (required)
 * - Rendering optional description
 * - Rendering optional icon
 * - Action button presence / absence
 * - Size variant CSS classes
 * - Additional className prop
 * - Pre-configured convenience variants
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  EmptyState,
  NoTransactionsEmpty,
  NoOrdinalsEmpty,
  NoTokensEmpty,
  NoLocksEmpty,
  NoContactsEmpty,
  NoSearchResultsEmpty,
  ErrorStateEmpty
} from './EmptyState'

describe('EmptyState', () => {
  // ---- Required props ----------------------------------------------------

  it('renders the title', () => {
    render(<EmptyState title="Nothing here yet" />)
    expect(screen.getByRole('heading', { name: 'Nothing here yet' })).toBeInTheDocument()
  })

  it('title renders as an h3 element', () => {
    render(<EmptyState title="My Title" />)
    const heading = screen.getByRole('heading', { level: 3 })
    expect(heading).toHaveTextContent('My Title')
  })

  // ---- Optional description ----------------------------------------------

  it('renders description when provided', () => {
    render(<EmptyState title="Empty" description="No items to show" />)
    expect(screen.getByText('No items to show')).toBeInTheDocument()
  })

  it('does not render description element when omitted', () => {
    render(<EmptyState title="Empty" />)
    expect(document.querySelector('.empty-state-description')).toBeNull()
  })

  // ---- Optional icon -----------------------------------------------------

  it('renders icon wrapper when icon is provided', () => {
    render(<EmptyState title="With icon" icon={<span data-testid="my-icon" />} />)
    expect(screen.getByTestId('my-icon')).toBeInTheDocument()
    expect(document.querySelector('.empty-state-icon')).toBeInTheDocument()
  })

  it('does not render icon wrapper when icon is omitted', () => {
    render(<EmptyState title="No icon" />)
    expect(document.querySelector('.empty-state-icon')).toBeNull()
  })

  // ---- Action button -----------------------------------------------------

  it('renders action button when action prop is provided', () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        title="Empty"
        action={{ label: 'Add Item', onClick }}
      />
    )
    expect(screen.getByRole('button', { name: 'Add Item' })).toBeInTheDocument()
  })

  it('calls action.onClick when action button is clicked', () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        title="Empty"
        action={{ label: 'Do It', onClick }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Do It' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('action button has type="button" attribute', () => {
    render(
      <EmptyState
        title="Empty"
        action={{ label: 'Click Me', onClick: vi.fn() }}
      />
    )
    expect(screen.getByRole('button', { name: 'Click Me' })).toHaveAttribute('type', 'button')
  })

  it('action button has expected CSS classes', () => {
    render(
      <EmptyState
        title="Empty"
        action={{ label: 'Btn', onClick: vi.fn() }}
      />
    )
    const btn = screen.getByRole('button', { name: 'Btn' })
    expect(btn).toHaveClass('empty-state-action', 'btn', 'btn-primary')
  })

  it('does not render action button when action prop is omitted', () => {
    render(<EmptyState title="Empty" />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  // ---- Size variants -----------------------------------------------------

  it('uses medium size class by default', () => {
    render(<EmptyState title="Default size" />)
    const root = document.querySelector('.empty-state-medium')
    expect(root).toBeInTheDocument()
  })

  it('applies small size class when size="small"', () => {
    render(<EmptyState title="Small" size="small" />)
    expect(document.querySelector('.empty-state-small')).toBeInTheDocument()
  })

  it('applies large size class when size="large"', () => {
    render(<EmptyState title="Large" size="large" />)
    expect(document.querySelector('.empty-state-large')).toBeInTheDocument()
  })

  // ---- className prop ----------------------------------------------------

  it('appends custom className to root element', () => {
    render(<EmptyState title="Custom class" className="my-custom-class" />)
    const root = document.querySelector('.my-custom-class')
    expect(root).toBeInTheDocument()
    // Should also still have the base class
    expect(root).toHaveClass('empty-state')
  })
})

// ---- Pre-configured variants -------------------------------------------

describe('NoTransactionsEmpty', () => {
  it('renders title', () => {
    render(<NoTransactionsEmpty />)
    expect(screen.getByText('No Transactions Yet')).toBeInTheDocument()
  })

  it('renders Receive BSV button when onReceive is provided', () => {
    const onReceive = vi.fn()
    render(<NoTransactionsEmpty onReceive={onReceive} />)
    const btn = screen.getByRole('button', { name: 'Receive BSV' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onReceive).toHaveBeenCalledOnce()
  })

  it('does not render button when onReceive is omitted', () => {
    render(<NoTransactionsEmpty />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('NoOrdinalsEmpty', () => {
  it('renders title', () => {
    render(<NoOrdinalsEmpty />)
    expect(screen.getByText('No Ordinals Yet')).toBeInTheDocument()
  })

  it('renders View Ordinals Address button when onReceive is provided', () => {
    const onReceive = vi.fn()
    render(<NoOrdinalsEmpty onReceive={onReceive} />)
    const btn = screen.getByRole('button', { name: 'View Ordinals Address' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onReceive).toHaveBeenCalledTimes(1)
  })
})

describe('NoTokensEmpty', () => {
  it('renders title', () => {
    render(<NoTokensEmpty />)
    expect(screen.getByText('No Tokens Found')).toBeInTheDocument()
  })

  it('renders Check Again button when onRefresh provided', () => {
    const onRefresh = vi.fn()
    render(<NoTokensEmpty onRefresh={onRefresh} />)
    expect(screen.getByRole('button', { name: 'Check Again' })).toBeInTheDocument()
  })

  it('renders Checking... button label when loading', () => {
    render(<NoTokensEmpty onRefresh={vi.fn()} loading />)
    expect(screen.getByRole('button', { name: 'Checking...' })).toBeInTheDocument()
  })
})

describe('NoLocksEmpty', () => {
  it('renders title', () => {
    render(<NoLocksEmpty />)
    expect(screen.getByText('No Locks Yet')).toBeInTheDocument()
  })

  it('renders Lock Sats button when onLock provided', () => {
    const onLock = vi.fn()
    render(<NoLocksEmpty onLock={onLock} />)
    const btn = screen.getByRole('button', { name: 'Lock Sats' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onLock).toHaveBeenCalledTimes(1)
  })
})

describe('NoContactsEmpty', () => {
  it('renders title', () => {
    render(<NoContactsEmpty />)
    expect(screen.getByText('No contacts yet')).toBeInTheDocument()
  })

  it('renders Add Contact button when onAdd provided', () => {
    const onAdd = vi.fn()
    render(<NoContactsEmpty onAdd={onAdd} />)
    const btn = screen.getByRole('button', { name: 'Add Contact' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onAdd).toHaveBeenCalledTimes(1)
  })
})

describe('NoSearchResultsEmpty', () => {
  it('renders title', () => {
    render(<NoSearchResultsEmpty />)
    expect(screen.getByText('No results found')).toBeInTheDocument()
  })
})

describe('ErrorStateEmpty', () => {
  it('renders title', () => {
    render(<ErrorStateEmpty />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('renders Try Again button when onRetry provided', () => {
    const onRetry = vi.fn()
    render(<ErrorStateEmpty onRetry={onRetry} />)
    const btn = screen.getByRole('button', { name: 'Try Again' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
