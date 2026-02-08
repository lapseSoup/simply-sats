import { Check } from 'lucide-react'

interface ToastItem {
  id: string
  message: string
}

interface ToastProps {
  message: string | null
  toasts?: ToastItem[]
}

export function Toast({ message, toasts }: ToastProps) {
  // Queue mode: render stacked toasts
  if (toasts && toasts.length > 0) {
    return (
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="copy-toast">
            <Check size={14} strokeWidth={2} /> {toast.message}
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
