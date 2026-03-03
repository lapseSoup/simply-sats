/**
 * QRScannerModal Component Tests
 *
 * Tests the QR scanner modal functionality including:
 * - Tab rendering (camera/upload)
 * - Tab switching
 * - Upload tab interactions
 * - Callbacks (onScan, onClose)
 * - Error display
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QRScannerModal } from './QRScannerModal'

// Mock html5-qrcode — browser-only QR library
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
    getState: vi.fn().mockReturnValue(1), // NOT_STARTED
  })),
}))

// Mock jsqr — canvas-based QR decoder
vi.mock('jsqr', () => ({
  default: vi.fn().mockReturnValue(null),
}))

// Mock the BSV address validator
vi.mock('../../domain/wallet/validation', () => ({
  isValidBSVAddress: vi.fn((addr: string) => addr.startsWith('1') && addr.length >= 26),
}))

// Mock the Modal's hooks to avoid DOM measurement issues in jsdom
vi.mock('../../hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}))

vi.mock('../../hooks/useKeyboardNav', () => ({
  useKeyboardNav: vi.fn(),
}))

describe('QRScannerModal', () => {
  const mockOnScan = vi.fn()
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders with correct title and tab buttons', () => {
    render(<QRScannerModal onScan={mockOnScan} onClose={mockOnClose} />)

    expect(screen.getByRole('heading', { name: /scan qr code/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /camera/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /upload image/i })).toBeInTheDocument()
  })

  it('starts on the camera tab by default', () => {
    render(<QRScannerModal onScan={mockOnScan} onClose={mockOnClose} />)

    const cameraBtn = screen.getByRole('button', { name: /camera/i })
    expect(cameraBtn.className).toContain('active')

    // Camera tab content: scanner hint text should be visible
    expect(screen.getByText(/position a qr code/i)).toBeInTheDocument()
  })

  it('switches to upload tab when Upload Image button is clicked', () => {
    render(<QRScannerModal onScan={mockOnScan} onClose={mockOnClose} />)

    const uploadTabBtn = screen.getByRole('button', { name: /upload image/i })
    fireEvent.click(uploadTabBtn)

    expect(uploadTabBtn.className).toContain('active')
    // Upload tab content
    expect(screen.getByText(/click to select an image/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/upload qr code image/i)).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    render(<QRScannerModal onScan={mockOnScan} onClose={mockOnClose} />)

    const closeButton = screen.getByLabelText('Close modal')
    fireEvent.click(closeButton)

    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when clicking the modal overlay', () => {
    render(<QRScannerModal onScan={mockOnScan} onClose={mockOnClose} />)

    const overlay = screen.getByRole('dialog')
    // Click the overlay itself (not child elements)
    fireEvent.click(overlay)

    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('renders the file input for image upload on upload tab', () => {
    render(<QRScannerModal onScan={mockOnScan} onClose={mockOnClose} />)

    // Switch to upload tab
    fireEvent.click(screen.getByRole('button', { name: /upload image/i }))

    const fileInput = screen.getByLabelText(/upload qr code image/i) as HTMLInputElement
    expect(fileInput).toBeInTheDocument()
    expect(fileInput.type).toBe('file')
    expect(fileInput.accept).toContain('image/png')
    expect(fileInput.accept).toContain('image/jpeg')
  })
})
