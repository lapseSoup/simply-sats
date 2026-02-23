import { memo, useCallback } from 'react'
import { CircleDollarSign } from 'lucide-react'
import type { PaymentNotification } from '../../services/messageBox'

interface PaymentAlertProps {
  payment: PaymentNotification | null
  onDismiss: () => void
}

export const PaymentAlert = memo(function PaymentAlert({ payment, onDismiss }: PaymentAlertProps) {
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      onDismiss()
    }
  }, [onDismiss])

  if (!payment) return null

  return (
    <div
      className="payment-alert"
      role="alert"
      tabIndex={0}
      aria-label="Payment received notification. Press Enter or Escape to dismiss."
      onClick={onDismiss}
      onKeyDown={handleKeyDown}
    >
      <div className="payment-alert-icon"><CircleDollarSign size={24} strokeWidth={2} /></div>
      <div className="payment-alert-content">
        <div className="payment-alert-title">Payment Received!</div>
        <div className="payment-alert-amount">
          {payment.amount?.toLocaleString() || 'Unknown'} sats
        </div>
        <div className="payment-alert-tx">
          TX: {payment.txid.slice(0, 16)}...
        </div>
      </div>
    </div>
  )
})
