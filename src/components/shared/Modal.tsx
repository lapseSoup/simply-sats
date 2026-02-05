import { useEffect, useId, type ReactNode } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useKeyboardNav } from '../../hooks/useKeyboardNav'

interface ModalProps {
  children: ReactNode
  onClose: () => void
  title: string
  className?: string
  closeOnOverlayClick?: boolean
}

export function Modal({
  children,
  onClose,
  title,
  className = '',
  closeOnOverlayClick = true
}: ModalProps) {
  const titleId = useId()
  const focusTrapRef = useFocusTrap({ enabled: true })

  // Escape key closes modal
  useKeyboardNav({
    onEscape: onClose,
    enabled: true
  })

  // Prevent body scroll when modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (closeOnOverlayClick && e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={focusTrapRef}
        className={`modal ${className}`}
      >
        <div className="modal-header">
          <h2 id={titleId} className="modal-title">{title}</h2>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close modal"
            type="button"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
