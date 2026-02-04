/**
 * ConfirmationModal Component Tests
 *
 * Tests the confirmation modal functionality including:
 * - Different confirmation types (warning, danger, info)
 * - Confirm and cancel button behavior
 * - Typed confirmation requirement
 * - Countdown delay
 * - Accessibility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ConfirmationModal } from './ConfirmationModal'

// Mock the hooks
vi.mock('../../hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null })
}))

vi.mock('../../hooks/useKeyboardNav', () => ({
  useKeyboardNav: vi.fn()
}))

describe('ConfirmationModal', () => {
  const defaultProps = {
    title: 'Confirm Action',
    message: 'Are you sure you want to proceed?',
    onConfirm: vi.fn(),
    onCancel: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.style.overflow = ''
  })

  it('renders with title and message', () => {
    render(<ConfirmationModal {...defaultProps} />)

    expect(screen.getByText('Confirm Action')).toBeInTheDocument()
    expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument()
  })

  it('has proper ARIA attributes for alertdialog', () => {
    render(<ConfirmationModal {...defaultProps} />)

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'confirmation-title')
    expect(dialog).toHaveAttribute('aria-describedby', 'confirmation-message')
  })

  it('calls onConfirm when confirm button is clicked', () => {
    render(<ConfirmationModal {...defaultProps} />)

    const confirmButton = screen.getByRole('button', { name: /confirm/i })
    fireEvent.click(confirmButton)

    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when cancel button is clicked', () => {
    render(<ConfirmationModal {...defaultProps} />)

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)

    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when clicking overlay', () => {
    render(<ConfirmationModal {...defaultProps} />)

    const overlay = screen.getByRole('alertdialog')
    fireEvent.click(overlay)

    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not call onCancel when clicking inside modal', () => {
    render(<ConfirmationModal {...defaultProps} />)

    const modalContent = document.querySelector('.confirmation-modal')
    if (modalContent) {
      fireEvent.click(modalContent)
    }

    expect(defaultProps.onCancel).not.toHaveBeenCalled()
  })

  it('renders optional details', () => {
    render(
      <ConfirmationModal
        {...defaultProps}
        details="Transaction ID: abc123"
      />
    )

    expect(screen.getByText('Transaction ID: abc123')).toBeInTheDocument()
  })

  it('uses custom button text', () => {
    render(
      <ConfirmationModal
        {...defaultProps}
        confirmText="Delete"
        cancelText="Keep"
      />
    )

    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep/i })).toBeInTheDocument()
  })

  describe('confirmation types', () => {
    it('renders warning type correctly', () => {
      render(<ConfirmationModal {...defaultProps} type="warning" />)

      expect(screen.getByText('⚠️')).toBeInTheDocument()
      const modal = document.querySelector('.confirmation-warning')
      expect(modal).toBeInTheDocument()
    })

    it('renders danger type correctly', () => {
      render(<ConfirmationModal {...defaultProps} type="danger" />)

      expect(screen.getByText('⛔')).toBeInTheDocument()
      const modal = document.querySelector('.confirmation-danger')
      expect(modal).toBeInTheDocument()
    })

    it('renders info type correctly', () => {
      render(<ConfirmationModal {...defaultProps} type="info" />)

      expect(screen.getByText('ℹ️')).toBeInTheDocument()
      const modal = document.querySelector('.confirmation-info')
      expect(modal).toBeInTheDocument()
    })
  })

  describe('typed confirmation', () => {
    it('disables confirm button until correct text is typed', () => {
      render(
        <ConfirmationModal
          {...defaultProps}
          requireTypedConfirmation="DELETE"
        />
      )

      const confirmButton = screen.getByRole('button', { name: /confirm/i })
      expect(confirmButton).toBeDisabled()

      const input = screen.getByLabelText(/type.*delete.*to confirm/i)
      fireEvent.change(input, { target: { value: 'DELETE' } })

      expect(confirmButton).not.toBeDisabled()
    })

    it('accepts case-insensitive typed confirmation', () => {
      render(
        <ConfirmationModal
          {...defaultProps}
          requireTypedConfirmation="DELETE"
        />
      )

      const confirmButton = screen.getByRole('button', { name: /confirm/i })
      const input = screen.getByLabelText(/type.*delete.*to confirm/i)

      fireEvent.change(input, { target: { value: 'delete' } })
      expect(confirmButton).not.toBeDisabled()

      fireEvent.change(input, { target: { value: 'DeLeTe' } })
      expect(confirmButton).not.toBeDisabled()
    })

    it('remains disabled with partial typed confirmation', () => {
      render(
        <ConfirmationModal
          {...defaultProps}
          requireTypedConfirmation="DELETE"
        />
      )

      const confirmButton = screen.getByRole('button', { name: /confirm/i })
      const input = screen.getByLabelText(/type.*delete.*to confirm/i)

      fireEvent.change(input, { target: { value: 'DEL' } })
      expect(confirmButton).toBeDisabled()
    })
  })

  describe('countdown delay', () => {
    it('disables confirm button during countdown', () => {
      render(
        <ConfirmationModal
          {...defaultProps}
          confirmDelaySeconds={3}
        />
      )

      const confirmButton = screen.getByRole('button', { name: /confirm.*3s/i })
      expect(confirmButton).toBeDisabled()
    })

    it('counts down and enables button when complete', async () => {
      render(
        <ConfirmationModal
          {...defaultProps}
          confirmDelaySeconds={3}
        />
      )

      // Initially at 3s
      expect(screen.getByRole('button', { name: /confirm.*3s/i })).toBeDisabled()

      // After 1 second
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      expect(screen.getByRole('button', { name: /confirm.*2s/i })).toBeDisabled()

      // After another second
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      expect(screen.getByRole('button', { name: /confirm.*1s/i })).toBeDisabled()

      // After final second
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      const confirmButton = screen.getByRole('button', { name: /confirm/i })
      expect(confirmButton).not.toBeDisabled()
      expect(confirmButton).toHaveTextContent('Confirm')
    })
  })

  describe('combined requirements', () => {
    it('requires both countdown and typed confirmation', async () => {
      render(
        <ConfirmationModal
          {...defaultProps}
          confirmDelaySeconds={2}
          requireTypedConfirmation="YES"
        />
      )

      const input = screen.getByLabelText(/type.*yes.*to confirm/i)
      const confirmButton = screen.getByRole('button', { name: /confirm.*2s/i })

      // Type correct text but countdown still active
      fireEvent.change(input, { target: { value: 'YES' } })
      expect(confirmButton).toBeDisabled()

      // Advance one second at a time
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      expect(screen.getByRole('button', { name: /confirm.*1s/i })).toBeDisabled()

      await act(async () => {
        vi.advanceTimersByTime(1000)
      })

      // Now should be enabled
      const enabledButton = screen.getByRole('button', { name: /confirm/i })
      expect(enabledButton).not.toBeDisabled()
    })
  })

  it('locks body scroll when mounted', () => {
    render(<ConfirmationModal {...defaultProps} />)
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('buttons have type="button" attribute', () => {
    render(<ConfirmationModal {...defaultProps} />)

    const buttons = screen.getAllByRole('button')
    buttons.forEach(button => {
      expect(button).toHaveAttribute('type', 'button')
    })
  })
})
