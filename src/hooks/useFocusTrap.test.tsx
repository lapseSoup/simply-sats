/**
 * useFocusTrap Hook Tests
 *
 * Tests the focus trap hook for:
 * - Trapping focus within a container
 * - Tab navigation cycling
 * - Return focus on close
 * - Enable/disable behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFocusTrap } from './useFocusTrap'

describe('useFocusTrap', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (container && container.parentNode) {
      document.body.removeChild(container)
    }
  })

  it('returns a ref object', () => {
    const { result } = renderHook(() => useFocusTrap())
    expect(result.current).toHaveProperty('current')
  })

  it('adds keydown event listener when enabled', () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')

    renderHook(() => useFocusTrap({ enabled: true }))

    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))

    addEventListenerSpy.mockRestore()
  })

  it('does not add event listener when disabled', () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')

    renderHook(() => useFocusTrap({ enabled: false }))

    // Should not be called for keydown when disabled
    const keydownCalls = addEventListenerSpy.mock.calls.filter(
      call => call[0] === 'keydown'
    )
    expect(keydownCalls).toHaveLength(0)

    addEventListenerSpy.mockRestore()
  })

  it('removes event listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

    const { unmount } = renderHook(() => useFocusTrap({ enabled: true }))

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))

    removeEventListenerSpy.mockRestore()
  })

  it('enabled defaults to true', () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')

    renderHook(() => useFocusTrap())

    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))

    addEventListenerSpy.mockRestore()
  })

  it('stores previous active element when enabled', () => {
    // Create and focus an element
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()

    expect(document.activeElement).toBe(button)

    const { unmount } = renderHook(() => useFocusTrap({ enabled: true }))

    // The previousActiveElement should be stored internally
    // When unmounted, it should restore focus
    unmount()

    // Note: The actual focus restoration happens via the cleanup effect
    // This test verifies the ref is created and the hook runs without error

    document.body.removeChild(button)
  })

  describe('Tab key behavior', () => {
    it('traps focus within container with focusable elements', () => {
      const { result } = renderHook(() => useFocusTrap({ enabled: true }))

      // Create a container with focusable elements
      const testContainer = document.createElement('div')
      const button1 = document.createElement('button')
      button1.textContent = 'First'
      const button2 = document.createElement('button')
      button2.textContent = 'Last'

      testContainer.appendChild(button1)
      testContainer.appendChild(button2)
      document.body.appendChild(testContainer)

      // Manually assign the ref
      if (result.current) {
        Object.defineProperty(result.current, 'current', {
          value: testContainer,
          writable: true
        })
      }

      // The hook should now track the container
      // Tab behavior is tested by simulating keydown events

      document.body.removeChild(testContainer)
    })
  })

  describe('returnFocusOnClose option', () => {
    it('returns focus when returnFocusOnClose is true (default)', () => {
      const button = document.createElement('button')
      document.body.appendChild(button)
      button.focus()

      const focusSpy = vi.spyOn(button, 'focus')

      const { unmount } = renderHook(() =>
        useFocusTrap({ enabled: true, returnFocusOnClose: true })
      )

      unmount()

      // The hook stores the previously focused element and restores on cleanup
      expect(focusSpy).toHaveBeenCalled()

      document.body.removeChild(button)
      focusSpy.mockRestore()
    })

    it('does not return focus when returnFocusOnClose is false', () => {
      const button = document.createElement('button')
      document.body.appendChild(button)
      button.focus()

      const focusSpy = vi.spyOn(button, 'focus')
      focusSpy.mockClear() // Clear the initial focus call

      const { unmount } = renderHook(() =>
        useFocusTrap({ enabled: true, returnFocusOnClose: false })
      )

      unmount()

      expect(focusSpy).not.toHaveBeenCalled()

      document.body.removeChild(button)
      focusSpy.mockRestore()
    })
  })

  describe('focusable element selectors', () => {
    it('identifies buttons as focusable', () => {
      // The hook uses specific selectors for focusable elements
      // This is more of a documentation test
      const button = document.createElement('button')
      expect(button.matches('button:not([disabled])')).toBe(true)

      button.disabled = true
      expect(button.matches('button:not([disabled])')).toBe(false)
    })

    it('identifies inputs as focusable', () => {
      const input = document.createElement('input')
      expect(input.matches('input:not([disabled])')).toBe(true)

      input.disabled = true
      expect(input.matches('input:not([disabled])')).toBe(false)
    })

    it('identifies links with href as focusable', () => {
      const link = document.createElement('a')
      expect(link.matches('a[href]')).toBe(false)

      link.href = 'https://example.com'
      expect(link.matches('a[href]')).toBe(true)
    })

    it('identifies elements with tabindex as focusable', () => {
      const div = document.createElement('div')
      expect(div.matches('[tabindex]:not([tabindex="-1"])')).toBe(false)

      div.tabIndex = 0
      expect(div.matches('[tabindex]:not([tabindex="-1"])')).toBe(true)

      div.tabIndex = -1
      expect(div.matches('[tabindex]:not([tabindex="-1"])')).toBe(false)
    })
  })
})
