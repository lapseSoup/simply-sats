/**
 * Toast Component Tests
 *
 * Tests the Toast component in two modes:
 * - Legacy mode: single string message prop
 * - Queue mode: array of ToastItem objects with types and dismiss support
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Toast } from './Toast'
import type { ToastItem } from '../../contexts/UIContext'

describe('Toast', () => {
  // ---- Legacy mode -------------------------------------------------------

  describe('legacy mode (message prop only)', () => {
    it('renders the message string', () => {
      render(<Toast message="Copied to clipboard" />)
      expect(screen.getByText('Copied to clipboard')).toBeInTheDocument()
    })

    it('has role="status" and aria-live="polite"', () => {
      render(<Toast message="Done" />)
      const el = screen.getByRole('status')
      expect(el).toHaveAttribute('aria-live', 'polite')
    })

    it('renders nothing when message is null', () => {
      const { container } = render(<Toast message={null} />)
      expect(container.firstChild).toBeNull()
    })
  })

  // ---- Queue mode --------------------------------------------------------

  describe('queue mode (toasts array)', () => {
    const makeToast = (overrides: Partial<ToastItem> = {}): ToastItem => ({
      id: 'toast-1',
      message: 'Hello queue',
      type: 'success',
      ...overrides
    })

    it('renders the toast-stack wrapper', () => {
      render(<Toast message={null} toasts={[makeToast()]} />)
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('has role="status" and aria-live="polite" on the stack', () => {
      render(<Toast message={null} toasts={[makeToast()]} />)
      const stack = screen.getByRole('status')
      expect(stack).toHaveAttribute('aria-live', 'polite')
    })

    it('renders each toast message', () => {
      const toasts: ToastItem[] = [
        { id: '1', message: 'First toast', type: 'success' },
        { id: '2', message: 'Second toast', type: 'error' }
      ]
      render(<Toast message={null} toasts={toasts} />)
      expect(screen.getByText('First toast')).toBeInTheDocument()
      expect(screen.getByText('Second toast')).toBeInTheDocument()
    })

    it('renders a success toast with class toast-success', () => {
      render(<Toast message={null} toasts={[makeToast({ type: 'success' })]} />)
      const item = document.querySelector('.toast-success')
      expect(item).toBeInTheDocument()
    })

    it('renders an error toast with class toast-error', () => {
      render(<Toast message={null} toasts={[makeToast({ type: 'error' })]} />)
      const item = document.querySelector('.toast-error')
      expect(item).toBeInTheDocument()
    })

    it('renders a warning toast with class toast-warning', () => {
      render(<Toast message={null} toasts={[makeToast({ type: 'warning' })]} />)
      const item = document.querySelector('.toast-warning')
      expect(item).toBeInTheDocument()
    })

    it('renders an info toast with class toast-info', () => {
      render(<Toast message={null} toasts={[makeToast({ type: 'info' })]} />)
      const item = document.querySelector('.toast-info')
      expect(item).toBeInTheDocument()
    })

    it('shows dismiss button on error toast without hover (always visible)', () => {
      const onDismiss = vi.fn()
      render(
        <Toast
          message={null}
          toasts={[makeToast({ id: 'err-1', type: 'error' })]}
          onDismiss={onDismiss}
        />
      )
      // Error toasts always show the dismiss button regardless of hover
      const btn = screen.getByRole('button', { name: 'Dismiss notification' })
      expect(btn).toBeInTheDocument()
    })

    it('calls onDismiss with the correct toast id when dismiss button is clicked', () => {
      const onDismiss = vi.fn()
      render(
        <Toast
          message={null}
          toasts={[makeToast({ id: 'err-42', type: 'error' })]}
          onDismiss={onDismiss}
        />
      )
      const btn = screen.getByRole('button', { name: 'Dismiss notification' })
      fireEvent.click(btn)
      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(onDismiss).toHaveBeenCalledWith('err-42')
    })

    it('shows dismiss button on mouseenter and hides it on mouseleave for non-error toasts', () => {
      const onDismiss = vi.fn()
      const toasts: ToastItem[] = [{ id: 'info-1', message: 'Info msg', type: 'info' }]
      render(<Toast message={null} toasts={toasts} onDismiss={onDismiss} />)

      // Before hover — dismiss button should not be present
      expect(screen.queryByRole('button', { name: 'Dismiss notification' })).toBeNull()

      // Hover over the toast item
      const item = document.querySelector('.toast-info')
      expect(item).not.toBeNull()
      fireEvent.mouseEnter(item!)
      expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument()

      // Mouse leave — dismiss button disappears
      fireEvent.mouseLeave(item!)
      expect(screen.queryByRole('button', { name: 'Dismiss notification' })).toBeNull()
    })

    it('calls onDismiss with correct id when dismiss button clicked on non-error toast after hover', () => {
      const onDismiss = vi.fn()
      const toasts: ToastItem[] = [{ id: 'hover-42', message: 'Info msg', type: 'info' }]
      render(<Toast message={null} toasts={toasts} onDismiss={onDismiss} />)
      const item = document.querySelector('.toast-info')
      expect(item).not.toBeNull()
      fireEvent.mouseEnter(item!)
      const btn = screen.getByRole('button', { name: 'Dismiss notification' })
      fireEvent.click(btn)
      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(onDismiss).toHaveBeenCalledWith('hover-42')
    })

    it('does not show dismiss button when onDismiss is not provided', () => {
      render(
        <Toast
          message={null}
          toasts={[makeToast({ type: 'error' })]}
          // no onDismiss
        />
      )
      expect(screen.queryByRole('button', { name: 'Dismiss notification' })).toBeNull()
    })

    it('prefers queue mode over legacy mode when both toasts and message are provided', () => {
      render(
        <Toast
          message="Legacy message"
          toasts={[{ id: '1', message: 'Queue message', type: 'success' }]}
        />
      )
      // Queue message rendered inside toast-stack
      expect(document.querySelector('.toast-stack')).toBeInTheDocument()
      expect(screen.getByText('Queue message')).toBeInTheDocument()
      // Legacy message not separately rendered
      expect(screen.queryByText('Legacy message')).toBeNull()
    })
  })
})
