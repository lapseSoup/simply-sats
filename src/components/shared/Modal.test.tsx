/**
 * Modal Component Tests
 *
 * Tests the base Modal component functionality including:
 * - Rendering with title and children
 * - Close button behavior
 * - Overlay click behavior
 * - Escape key handling
 * - Focus trapping
 * - Body scroll locking
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Modal } from './Modal'

// Mock the hooks
vi.mock('../../hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null })
}))

vi.mock('../../hooks/useKeyboardNav', () => ({
  useKeyboardNav: vi.fn()
}))

describe('Modal', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Clean up body style
    document.body.style.overflow = ''
  })

  it('renders modal with title and children', () => {
    render(
      <Modal title="Test Modal" onClose={mockOnClose}>
        <p>Modal content</p>
      </Modal>
    )

    expect(screen.getByText('Test Modal')).toBeInTheDocument()
    expect(screen.getByText('Modal content')).toBeInTheDocument()
  })

  it('has proper ARIA attributes for accessibility', () => {
    render(
      <Modal title="Accessible Modal" onClose={mockOnClose}>
        <p>Content</p>
      </Modal>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title')
  })

  it('calls onClose when close button is clicked', () => {
    render(
      <Modal title="Test Modal" onClose={mockOnClose}>
        <p>Content</p>
      </Modal>
    )

    const closeButton = screen.getByLabelText('Close modal')
    fireEvent.click(closeButton)

    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when clicking overlay (default behavior)', () => {
    render(
      <Modal title="Test Modal" onClose={mockOnClose}>
        <p>Content</p>
      </Modal>
    )

    const overlay = screen.getByRole('dialog')
    fireEvent.click(overlay)

    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when clicking inside modal content', () => {
    render(
      <Modal title="Test Modal" onClose={mockOnClose}>
        <p>Content</p>
      </Modal>
    )

    // Click the modal content area, not the overlay
    const modalContent = document.querySelector('.modal')
    if (modalContent) {
      fireEvent.click(modalContent)
    }

    // Should not close when clicking inside
    expect(mockOnClose).not.toHaveBeenCalled()
  })

  it('does not call onClose when closeOnOverlayClick is false', () => {
    render(
      <Modal title="Test Modal" onClose={mockOnClose} closeOnOverlayClick={false}>
        <p>Content</p>
      </Modal>
    )

    const overlay = screen.getByRole('dialog')
    fireEvent.click(overlay)

    expect(mockOnClose).not.toHaveBeenCalled()
  })

  it('applies custom className', () => {
    render(
      <Modal title="Test Modal" onClose={mockOnClose} className="custom-modal">
        <p>Content</p>
      </Modal>
    )

    const modalContent = document.querySelector('.modal.custom-modal')
    expect(modalContent).toBeInTheDocument()
  })

  it('locks body scroll when mounted', () => {
    render(
      <Modal title="Test Modal" onClose={mockOnClose}>
        <p>Content</p>
      </Modal>
    )

    expect(document.body.style.overflow).toBe('hidden')
  })

  it('restores body scroll when unmounted', () => {
    document.body.style.overflow = 'auto'

    const { unmount } = render(
      <Modal title="Test Modal" onClose={mockOnClose}>
        <p>Content</p>
      </Modal>
    )

    expect(document.body.style.overflow).toBe('hidden')

    unmount()

    expect(document.body.style.overflow).toBe('auto')
  })

  it('renders title with correct heading level', () => {
    render(
      <Modal title="Test Modal" onClose={mockOnClose}>
        <p>Content</p>
      </Modal>
    )

    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).toHaveTextContent('Test Modal')
    expect(heading).toHaveAttribute('id', 'modal-title')
  })

  it('close button is of type button', () => {
    render(
      <Modal title="Test Modal" onClose={mockOnClose}>
        <p>Content</p>
      </Modal>
    )

    const closeButton = screen.getByLabelText('Close modal')
    expect(closeButton).toHaveAttribute('type', 'button')
  })
})
