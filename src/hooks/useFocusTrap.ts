import { useEffect, useRef, useCallback } from 'react'

const FOCUSABLE_SELECTORS = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

interface UseFocusTrapOptions {
  enabled?: boolean
  returnFocusOnClose?: boolean
}

export function useFocusTrap(options: UseFocusTrapOptions = {}) {
  const { enabled = true, returnFocusOnClose = true } = options
  const containerRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  // Store the previously focused element when trap is enabled
  useEffect(() => {
    if (enabled) {
      previousActiveElement.current = document.activeElement as HTMLElement
    }

    return () => {
      if (enabled && returnFocusOnClose && previousActiveElement.current) {
        previousActiveElement.current.focus()
      }
    }
  }, [enabled, returnFocusOnClose])

  // Focus first focusable element when trap is enabled
  useEffect(() => {
    if (!enabled || !containerRef.current) return

    const focusableElements = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
    if (focusableElements.length > 0) {
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => {
        focusableElements[0].focus()
      })
    }
  }, [enabled])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enabled || !containerRef.current || e.key !== 'Tab') return

    const focusableElements = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
    if (focusableElements.length === 0) return

    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    // Shift+Tab on first element -> go to last
    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault()
      lastElement.focus()
    }
    // Tab on last element -> go to first
    else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault()
      firstElement.focus()
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enabled, handleKeyDown])

  return containerRef
}
