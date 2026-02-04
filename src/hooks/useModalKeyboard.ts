/**
 * Modal Keyboard Navigation Hook
 *
 * Provides comprehensive keyboard navigation for modal dialogs,
 * including list navigation, escape handling, and Enter submission.
 */

import { useEffect, useCallback, useRef, useState } from 'react'

export interface UseModalKeyboardOptions {
  /** Called when Escape is pressed */
  onClose?: () => void
  /** Called when Enter is pressed (outside inputs) */
  onSubmit?: () => void
  /** Whether the modal is open/active */
  isOpen?: boolean
  /** List of items for arrow key navigation */
  items?: unknown[]
  /** Called when selected item changes via keyboard */
  onItemSelect?: (index: number) => void
  /** Initial selected index */
  initialIndex?: number
  /** Allow wrap-around navigation */
  wrapAround?: boolean
}

export interface UseModalKeyboardReturn {
  /** Current selected index for list navigation */
  selectedIndex: number
  /** Set the selected index programmatically */
  setSelectedIndex: (index: number) => void
  /** Reset selection to initial state */
  resetSelection: () => void
  /** Props to spread on list container for accessibility */
  listProps: {
    role: 'listbox'
    'aria-activedescendant': string | undefined
    tabIndex: number
  }
  /** Get props for a list item */
  getItemProps: (index: number) => {
    id: string
    role: 'option'
    'aria-selected': boolean
    tabIndex: number
    onMouseEnter: () => void
    onClick: () => void
  }
}

/**
 * Hook for comprehensive modal keyboard navigation
 *
 * Features:
 * - Escape key to close
 * - Enter key to submit (when not in input)
 * - Arrow keys for list navigation
 * - Automatic focus management
 * - Accessibility attributes
 *
 * @example
 * ```tsx
 * function MyModal({ isOpen, onClose, items }) {
 *   const { selectedIndex, listProps, getItemProps } = useModalKeyboard({
 *     isOpen,
 *     onClose,
 *     items,
 *     onItemSelect: (index) => console.log('Selected:', items[index])
 *   })
 *
 *   return (
 *     <ul {...listProps}>
 *       {items.map((item, i) => (
 *         <li key={i} {...getItemProps(i)}>
 *           {item.name}
 *         </li>
 *       ))}
 *     </ul>
 *   )
 * }
 * ```
 */
export function useModalKeyboard(options: UseModalKeyboardOptions = {}): UseModalKeyboardReturn {
  const {
    onClose,
    onSubmit,
    isOpen = true,
    items = [],
    onItemSelect,
    initialIndex = -1,
    wrapAround = true
  } = options

  const [selectedIndex, setSelectedIndex] = useState(initialIndex)
  const listId = useRef(`modal-list-${Math.random().toString(36).slice(2, 9)}`)

  // Reset selection when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(initialIndex)
    }
  }, [isOpen, initialIndex])

  const navigateUp = useCallback(() => {
    if (items.length === 0) return

    setSelectedIndex(current => {
      let next = current - 1
      if (next < 0) {
        next = wrapAround ? items.length - 1 : 0
      }
      return next
    })
  }, [items.length, wrapAround])

  const navigateDown = useCallback(() => {
    if (items.length === 0) return

    setSelectedIndex(current => {
      let next = current + 1
      if (next >= items.length) {
        next = wrapAround ? 0 : items.length - 1
      }
      return next
    })
  }, [items.length, wrapAround])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return

    const target = e.target as HTMLElement
    const isInInput = target.tagName === 'INPUT' ||
                      target.tagName === 'TEXTAREA' ||
                      target.isContentEditable

    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        onClose?.()
        break

      case 'Enter':
        if (!isInInput) {
          e.preventDefault()
          if (selectedIndex >= 0 && selectedIndex < items.length) {
            onItemSelect?.(selectedIndex)
          } else {
            onSubmit?.()
          }
        }
        break

      case 'ArrowUp':
        if (!isInInput && items.length > 0) {
          e.preventDefault()
          navigateUp()
        }
        break

      case 'ArrowDown':
        if (!isInInput && items.length > 0) {
          e.preventDefault()
          navigateDown()
        }
        break

      case 'Home':
        if (!isInInput && items.length > 0) {
          e.preventDefault()
          setSelectedIndex(0)
        }
        break

      case 'End':
        if (!isInInput && items.length > 0) {
          e.preventDefault()
          setSelectedIndex(items.length - 1)
        }
        break
    }
  }, [isOpen, onClose, onSubmit, selectedIndex, items.length, onItemSelect, navigateUp, navigateDown])

  // Notify parent when selection changes
  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex < items.length) {
      onItemSelect?.(selectedIndex)
    }
  }, [selectedIndex, items.length, onItemSelect])

  // Add keyboard listener
  useEffect(() => {
    if (!isOpen) return

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleKeyDown])

  const resetSelection = useCallback(() => {
    setSelectedIndex(initialIndex)
  }, [initialIndex])

  const getItemId = (index: number) => `${listId.current}-item-${index}`

  const listProps = {
    role: 'listbox' as const,
    'aria-activedescendant': selectedIndex >= 0 ? getItemId(selectedIndex) : undefined,
    tabIndex: 0
  }

  const getItemProps = (index: number) => ({
    id: getItemId(index),
    role: 'option' as const,
    'aria-selected': index === selectedIndex,
    tabIndex: index === selectedIndex ? 0 : -1,
    onMouseEnter: () => setSelectedIndex(index),
    onClick: () => {
      setSelectedIndex(index)
      onItemSelect?.(index)
    }
  })

  return {
    selectedIndex,
    setSelectedIndex,
    resetSelection,
    listProps,
    getItemProps
  }
}

export default useModalKeyboard
