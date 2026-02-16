import { useState } from 'react'
import { Check, X, AlertTriangle, AlertCircle, Info } from 'lucide-react'
import type { ToastItem } from '../../contexts/UIContext'

interface ToastProps {
  message: string | null
  toasts?: ToastItem[]
  onDismiss?: (id: string) => void
}

function ToastIcon({ type }: { type: ToastItem['type'] }) {
  switch (type) {
    case 'error': return <AlertCircle size={14} strokeWidth={2} />
    case 'warning': return <AlertTriangle size={14} strokeWidth={2} />
    case 'info': return <Info size={14} strokeWidth={2} />
    default: return <Check size={14} strokeWidth={2} />
  }
}

export function Toast({ message, toasts, onDismiss }: ToastProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // Queue mode: render stacked toasts
  if (toasts && toasts.length > 0) {
    return (
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`copy-toast toast-${toast.type}`}
            onMouseEnter={() => setHoveredId(toast.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <ToastIcon type={toast.type} /> {toast.message}
            {(hoveredId === toast.id || toast.type === 'error') && onDismiss && (
              <button
                className="toast-dismiss"
                onClick={() => onDismiss(toast.id)}
                aria-label="Dismiss notification"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    )
  }

  // Legacy fallback: single message
  if (!message) return null

  return (
    <div className="copy-toast" role="status" aria-live="polite"><Check size={14} strokeWidth={2} /> {message}</div>
  )
}
