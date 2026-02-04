import { useEffect, useCallback } from 'react'

interface UseKeyboardNavOptions {
  onEscape?: () => void
  onArrowLeft?: () => void
  onArrowRight?: () => void
  onArrowUp?: () => void
  onArrowDown?: () => void
  onEnter?: () => void
  enabled?: boolean
}

export function useKeyboardNav(options: UseKeyboardNavOptions) {
  const {
    onEscape,
    onArrowLeft,
    onArrowRight,
    onArrowUp,
    onArrowDown,
    onEnter,
    enabled = true
  } = options

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enabled) return

    // Don't trigger if user is typing in an input
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      // Allow Escape even in inputs
      if (e.key === 'Escape' && onEscape) {
        onEscape()
        return
      }
      return
    }

    switch (e.key) {
      case 'Escape':
        onEscape?.()
        break
      case 'ArrowLeft':
        onArrowLeft?.()
        break
      case 'ArrowRight':
        onArrowRight?.()
        break
      case 'ArrowUp':
        e.preventDefault() // Prevent page scroll
        onArrowUp?.()
        break
      case 'ArrowDown':
        e.preventDefault() // Prevent page scroll
        onArrowDown?.()
        break
      case 'Enter':
        onEnter?.()
        break
    }
  }, [enabled, onEscape, onArrowLeft, onArrowRight, onArrowUp, onArrowDown, onEnter])

  useEffect(() => {
    if (!enabled) return

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, handleKeyDown])
}
