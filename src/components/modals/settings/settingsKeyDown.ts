import type { KeyboardEvent } from 'react'

/** Keyboard accessibility helper for clickable divs — triggers handler on Enter or Space. */
export const handleKeyDown = (handler: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    handler()
  }
}
