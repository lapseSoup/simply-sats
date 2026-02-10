import { useEffect, useId, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useKeyboardNav } from '../../hooks/useKeyboardNav'

type ModalSize = 'sm' | 'md' | 'lg'

const MODAL_WIDTHS: Record<ModalSize, string> = {
  sm: '360px',
  md: '420px',
  lg: '560px'
}

interface ModalProps {
  children: ReactNode
  onClose: () => void
  title: string
  className?: string
  closeOnOverlayClick?: boolean
  size?: ModalSize
}

export function Modal({
  children,
  onClose,
  title,
  className = '',
  closeOnOverlayClick = true,
  size = 'md'
}: ModalProps) {
  const titleId = useId()
  const focusTrapRef = useFocusTrap({ enabled: true })

  // Escape key closes modal
  useKeyboardNav({
    onEscape: onClose,
    enabled: true
  })

  // Prevent body/html scroll when modal is open
  useEffect(() => {
    const originalBodyOverflow = document.body.style.overflow
    const originalHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalBodyOverflow
      document.documentElement.style.overflow = originalHtmlOverflow
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
        style={size !== 'md' ? { maxWidth: MODAL_WIDTHS[size] } : undefined}
      >
        <div className="modal-header">
          <h2 id={titleId} className="modal-title">{title}</h2>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close modal"
            type="button"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
