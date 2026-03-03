/**
 * FeeEstimation Component Tests
 *
 * Tests the fee estimation display including:
 * - Rendering with default fee rate
 * - Fee tier selection callback
 * - Fee display (sats + USD)
 * - No render when inputCount is 0
 * - onFeeRateChange NOT called on mount (Q-74 fix)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { FeeEstimation } from './FeeEstimation'

// Mock the UI context
vi.mock('../../contexts/UIContext', () => ({
  useUI: () => ({
    formatUSD: vi.fn((sats: number) => (sats / 100000000 * 50).toFixed(2)),
  }),
}))

// Use the real domain constants (they are plain exports, no side effects)

describe('FeeEstimation', () => {
  const defaultProps = {
    inputCount: 2,
    outputCount: 2,
    currentFee: 100,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders with fee amount and USD equivalent', () => {
    render(<FeeEstimation {...defaultProps} />)

    expect(screen.getByText('Transaction Fee')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText(/sats/)).toBeInTheDocument()
  })

  it('returns null when inputCount is 0', () => {
    const { container } = render(
      <FeeEstimation inputCount={0} outputCount={2} currentFee={0} />
    )

    expect(container.innerHTML).toBe('')
  })

  it('does NOT call onFeeRateChange on initial mount (Q-74 fix)', () => {
    const mockOnFeeRateChange = vi.fn()

    render(
      <FeeEstimation
        {...defaultProps}
        onFeeRateChange={mockOnFeeRateChange}
      />
    )

    // The isFirstRender ref should prevent the callback on mount
    expect(mockOnFeeRateChange).not.toHaveBeenCalled()
  })

  it('calls onFeeRateChange when a different fee tier is selected', () => {
    const mockOnFeeRateChange = vi.fn()

    render(
      <FeeEstimation
        {...defaultProps}
        onFeeRateChange={mockOnFeeRateChange}
      />
    )

    // Initially "Standard" is selected (rate 0.1). Click "Low" (rate 0.05).
    const lowButton = screen.getByRole('button', { name: /low/i })
    act(() => {
      fireEvent.click(lowButton)
    })

    expect(mockOnFeeRateChange).toHaveBeenCalledWith(0.05)
  })

  it('renders fee tier buttons when onFeeRateChange is provided', () => {
    render(
      <FeeEstimation
        {...defaultProps}
        onFeeRateChange={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /low/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /standard/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fast/i })).toBeInTheDocument()
  })

  it('does not render fee tier buttons when onFeeRateChange is not provided', () => {
    render(<FeeEstimation {...defaultProps} />)

    expect(screen.queryByRole('button', { name: /low/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /standard/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /fast/i })).not.toBeInTheDocument()
  })

  // Q-80: Boundary tests for fee rate clamping
  // MIN_FEE_RATE = 0.001, MAX_FEE_RATE = 1.0 (from domain/transaction/fees)
  it('clamps custom rate to MIN_FEE_RATE when rate is below minimum', () => {
    const mockOnFeeRateChange = vi.fn()

    render(
      <FeeEstimation
        {...defaultProps}
        onFeeRateChange={mockOnFeeRateChange}
      />
    )

    // Open custom fee rate input
    const customToggle = screen.getByText(/custom fee rate/i)
    act(() => {
      fireEvent.click(customToggle)
    })

    // Set a rate below minimum (MIN_FEE_RATE is 0.001)
    const slider = screen.getByRole('slider')
    act(() => {
      fireEvent.change(slider, { target: { value: '0.0001' } })
    })

    // The callback should receive MIN_FEE_RATE (0.001), not the below-minimum value
    expect(mockOnFeeRateChange).toHaveBeenLastCalledWith(0.001)
  })

  it('clamps custom rate to MAX_FEE_RATE when rate exceeds maximum', () => {
    const mockOnFeeRateChange = vi.fn()

    render(
      <FeeEstimation
        {...defaultProps}
        onFeeRateChange={mockOnFeeRateChange}
      />
    )

    // Open custom fee rate input
    const customToggle = screen.getByText(/custom fee rate/i)
    act(() => {
      fireEvent.click(customToggle)
    })

    // Set a rate above maximum (MAX_FEE_RATE is 1.0)
    const slider = screen.getByRole('slider')
    act(() => {
      fireEvent.change(slider, { target: { value: '999' } })
    })

    // The callback should receive MAX_FEE_RATE (1.0), not 999
    expect(mockOnFeeRateChange).toHaveBeenCalled()
    const lastCall = mockOnFeeRateChange.mock.calls[mockOnFeeRateChange.mock.calls.length - 1]!
    expect(lastCall[0]).toBe(1.0)
  })
})
