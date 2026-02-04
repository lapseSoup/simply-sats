import type { PaymentNotification } from '../../services/messageBox'

interface PaymentAlertProps {
  payment: PaymentNotification | null
  onDismiss: () => void
}

export function PaymentAlert({ payment, onDismiss }: PaymentAlertProps) {
  if (!payment) return null

  return (
    <div className="payment-alert" onClick={onDismiss}>
      <div className="payment-alert-icon">💰</div>
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
}
