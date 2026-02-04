/**
 * useKeyboardNav Hook Tests
 *
 * Tests the keyboard navigation hook for:
 * - Arrow key handling
 * - Escape key handling
 * - Enter key handling
 * - Input field exclusion
 * - Enable/disable behavior
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardNav } from './useKeyboardNav'

describe('useKeyboardNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const dispatchKeydown = (key: string, target?: HTMLElement) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true
    })

    // Set the target
    if (target) {
      Object.defineProperty(event, 'target', { value: target, writable: false })
    }

    window.dispatchEvent(event)
    return event
  }

  it('calls onEscape when Escape key is pressed', () => {
    const onEscape = vi.fn()

    renderHook(() => useKeyboardNav({ onEscape }))

    dispatchKeydown('Escape')

    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('calls onArrowLeft when ArrowLeft key is pressed', () => {
    const onArrowLeft = vi.fn()

    renderHook(() => useKeyboardNav({ onArrowLeft }))

    dispatchKeydown('ArrowLeft')

    expect(onArrowLeft).toHaveBeenCalledTimes(1)
  })

  it('calls onArrowRight when ArrowRight key is pressed', () => {
    const onArrowRight = vi.fn()

    renderHook(() => useKeyboardNav({ onArrowRight }))

    dispatchKeydown('ArrowRight')

    expect(onArrowRight).toHaveBeenCalledTimes(1)
  })

  it('calls onArrowUp when ArrowUp key is pressed', () => {
    const onArrowUp = vi.fn()

    renderHook(() => useKeyboardNav({ onArrowUp }))

    dispatchKeydown('ArrowUp')

    expect(onArrowUp).toHaveBeenCalledTimes(1)
  })

  it('calls onArrowDown when ArrowDown key is pressed', () => {
    const onArrowDown = vi.fn()

    renderHook(() => useKeyboardNav({ onArrowDown }))

    dispatchKeydown('ArrowDown')

    expect(onArrowDown).toHaveBeenCalledTimes(1)
  })

  it('calls onEnter when Enter key is pressed', () => {
    const onEnter = vi.fn()

    renderHook(() => useKeyboardNav({ onEnter }))

    dispatchKeydown('Enter')

    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('does not call handlers when disabled', () => {
    const onEscape = vi.fn()
    const onArrowLeft = vi.fn()

    renderHook(() => useKeyboardNav({ onEscape, onArrowLeft, enabled: false }))

    dispatchKeydown('Escape')
    dispatchKeydown('ArrowLeft')

    expect(onEscape).not.toHaveBeenCalled()
    expect(onArrowLeft).not.toHaveBeenCalled()
  })

  it('does not call handlers for unrecognized keys', () => {
    const onEscape = vi.fn()

    renderHook(() => useKeyboardNav({ onEscape }))

    dispatchKeydown('a')
    dispatchKeydown('Space')
    dispatchKeydown('Tab')

    expect(onEscape).not.toHaveBeenCalled()
  })

  it('ignores arrow keys when target is an INPUT element', () => {
    const onArrowLeft = vi.fn()

    renderHook(() => useKeyboardNav({ onArrowLeft }))

    const input = document.createElement('input')
    document.body.appendChild(input)

    dispatchKeydown('ArrowLeft', input)

    expect(onArrowLeft).not.toHaveBeenCalled()

    document.body.removeChild(input)
  })

  it('ignores arrow keys when target is a TEXTAREA element', () => {
    const onArrowUp = vi.fn()

    renderHook(() => useKeyboardNav({ onArrowUp }))

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)

    dispatchKeydown('ArrowUp', textarea)

    expect(onArrowUp).not.toHaveBeenCalled()

    document.body.removeChild(textarea)
  })

  it('still calls onEscape when target is an INPUT element', () => {
    const onEscape = vi.fn()

    renderHook(() => useKeyboardNav({ onEscape }))

    const input = document.createElement('input')
    document.body.appendChild(input)

    dispatchKeydown('Escape', input)

    expect(onEscape).toHaveBeenCalledTimes(1)

    document.body.removeChild(input)
  })

  it('can handle multiple handlers simultaneously', () => {
    const onEscape = vi.fn()
    const onArrowUp = vi.fn()
    const onArrowDown = vi.fn()
    const onEnter = vi.fn()

    renderHook(() => useKeyboardNav({ onEscape, onArrowUp, onArrowDown, onEnter }))

    dispatchKeydown('Escape')
    dispatchKeydown('ArrowUp')
    dispatchKeydown('ArrowDown')
    dispatchKeydown('Enter')

    expect(onEscape).toHaveBeenCalledTimes(1)
    expect(onArrowUp).toHaveBeenCalledTimes(1)
    expect(onArrowDown).toHaveBeenCalledTimes(1)
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('cleans up event listener on unmount', () => {
    const onEscape = vi.fn()
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() => useKeyboardNav({ onEscape }))

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))

    removeEventListenerSpy.mockRestore()
  })

  it('works with undefined optional handlers', () => {
    // Should not throw when handlers are undefined
    expect(() => {
      renderHook(() => useKeyboardNav({}))
      dispatchKeydown('Escape')
      dispatchKeydown('ArrowLeft')
    }).not.toThrow()
  })

  it('enabled defaults to true', () => {
    const onEscape = vi.fn()

    renderHook(() => useKeyboardNav({ onEscape }))

    dispatchKeydown('Escape')

    expect(onEscape).toHaveBeenCalled()
  })
})
