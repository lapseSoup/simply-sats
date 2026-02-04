import { useState } from 'react'
import { useWallet } from '../../contexts/WalletContext'
import { calculateExactFee, calculateTxFee } from '../../services/wallet'

interface SendModalProps {
  onClose: () => void
}

export function SendModal({ onClose }: SendModalProps) {
  const {
    wallet,
    balance,
    utxos,
    displayInSats,
    handleSend,
    showToast
  } = useWallet()

  const [sendAddress, setSendAddress] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  if (!wallet) return null

  // Parse amount based on display mode (sats or BSV)
  const sendSats = displayInSats
    ? Math.round(parseFloat(sendAmount || '0'))
    : Math.round(parseFloat(sendAmount || '0') * 100000000)
  const availableSats = balance

  // Calculate number of inputs
  const numInputs = utxos.length > 0 ? utxos.length : Math.max(1, Math.ceil(balance / 10000))
  const totalUtxoValue = utxos.length > 0 ? utxos.reduce((sum, u) => sum + u.satoshis, 0) : balance

  // Calculate fee
  let fee = 0
  if (sendSats > 0) {
    if (utxos.length > 0) {
      const feeInfo = calculateExactFee(sendSats, utxos)
      fee = feeInfo.fee
    } else {
      const isMaxSend = sendSats >= totalUtxoValue - 50
      const numOutputs = isMaxSend ? 1 : 2
      fee = calculateTxFee(numInputs, numOutputs)
    }
  }

  // Calculate max sendable with 1 output (no change)
  const maxFee = calculateTxFee(numInputs, 1)
  const maxSendSats = Math.max(0, totalUtxoValue - maxFee)

  const handleSubmit = async () => {
    if (!sendAddress || !sendAmount) return

    setSending(true)
    setSendError('')

    const result = await handleSend(sendAddress, sendSats)

    if (result.success) {
      showToast(`Sent ${sendSats.toLocaleString()} sats!`)
      onClose()
    } else {
      setSendError(result.error || 'Send failed')
    }

    setSending(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal send-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Send BSV</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content compact">
          <div className="form-group">
            <label className="form-label" htmlFor="send-address">To</label>
            <input
              id="send-address"
              type="text"
              className="form-input mono"
              placeholder="Enter BSV address"
              value={sendAddress}
              onChange={e => setSendAddress(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="send-amount">
              Amount ({displayInSats ? 'sats' : 'BSV'})
            </label>
            <div className="input-with-action">
              <input
                id="send-amount"
                type="number"
                className="form-input"
                placeholder={displayInSats ? '0' : '0.00000000'}
                step={displayInSats ? '1' : '0.00000001'}
                value={sendAmount}
                onChange={e => setSendAmount(e.target.value)}
              />
              <button
                className="input-action"
                onClick={() => setSendAmount(displayInSats ? String(maxSendSats) : (maxSendSats / 100000000).toFixed(8))}
                type="button"
              >
                MAX
              </button>
            </div>
          </div>

          <div className="send-summary compact">
            <div className="send-summary-row">
              <span>Balance</span>
              <span>{availableSats.toLocaleString()} sats</span>
            </div>
            {sendSats > 0 && (
              <>
                <div className="send-summary-row">
                  <span>Send</span>
                  <span>{sendSats.toLocaleString()} sats</span>
                </div>
                <div className="send-summary-row">
                  <span>Fee</span>
                  <span>{fee} sats</span>
                </div>
                <div className="send-summary-row total">
                  <span>Total</span>
                  <span>{(sendSats + fee).toLocaleString()} sats</span>
                </div>
              </>
            )}
          </div>

          {sendError && (
            <div className="warning compact" role="alert">
              <span className="warning-icon">⚠️</span>
              <span className="warning-text">{sendError}</span>
            </div>
          )}
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={sending || !sendAddress || !sendAmount || sendSats + fee > availableSats}
          >
            {sending ? 'Sending...' : `Send ${sendSats > 0 ? sendSats.toLocaleString() + ' sats' : 'BSV'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
