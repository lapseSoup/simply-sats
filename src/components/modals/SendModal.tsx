import { useState, useCallback } from 'react'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import { calculateExactFee, calculateTxFee, calculateMaxSend, DEFAULT_FEE_RATE } from '../../adapters/walletAdapter'
import { Modal } from '../shared/Modal'
import { ConfirmationModal, SEND_CONFIRMATION_THRESHOLD, HIGH_VALUE_THRESHOLD } from '../shared/ConfirmationModal'
import { FeeEstimation } from '../shared/FeeEstimation'
import { CoinControlModal } from './CoinControlModal'
import type { UTXO as DatabaseUTXO } from '../../services/database'

interface SendModalProps {
  onClose: () => void
}

export function SendModal({ onClose }: SendModalProps) {
  const {
    wallet,
    balance,
    utxos,
    handleSend
  } = useWallet()
  const { displayInSats, showToast, formatUSD } = useUI()

  const [sendAddress, setSendAddress] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [addressError, setAddressError] = useState('')

  // Validate BSV address format
  const validateAddress = useCallback((addr: string) => {
    if (!addr) {
      setAddressError('')
      return
    }
    // BSV addresses start with 1, 3, or q (for bech32) and are 25-34 chars
    // Legacy P2PKH starts with 1, P2SH starts with 3
    if (!/^[13][a-km-zA-HJ-NP-Z1-9]{24,33}$/.test(addr)) {
      setAddressError('Invalid BSV address format')
    } else {
      setAddressError('')
    }
  }, [])
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [showCoinControl, setShowCoinControl] = useState(false)
  const [selectedUtxos, setSelectedUtxos] = useState<DatabaseUTXO[] | null>(null)
  const [feeRate, setFeeRate] = useState(DEFAULT_FEE_RATE)

  // Handle fee rate changes
  const handleFeeRateChange = useCallback((rate: number) => {
    setFeeRate(rate)
  }, [])

  if (!wallet) return null

  // Parse amount based on display mode (sats or BSV)
  const sendSats = displayInSats
    ? Math.round(parseFloat(sendAmount || '0'))
    : Math.round(parseFloat(sendAmount || '0') * 100000000)
  const availableSats = balance

  // Calculate number of inputs (fallback if no UTXOs available yet)
  const numInputs = utxos.length > 0 ? utxos.length : Math.max(1, Math.ceil(balance / 10000))
  const totalUtxoValue = utxos.length > 0 ? utxos.reduce((sum, u) => sum + u.satoshis, 0) : balance

  // Calculate fee using domain layer functions with adjustable rate
  let fee = 0
  let inputCount = 0
  let outputCount = 0
  if (sendSats > 0) {
    if (utxos.length > 0) {
      // Use domain layer calculateExactFee with adjustable fee rate
      const feeInfo = calculateExactFee(sendSats, utxos, feeRate)
      fee = feeInfo.fee
      inputCount = feeInfo.inputCount
      outputCount = feeInfo.outputCount
    } else {
      // Fallback when UTXOs not loaded - estimate based on input count
      const isMaxSend = sendSats >= totalUtxoValue - 50
      outputCount = isMaxSend ? 1 : 2
      inputCount = numInputs
      fee = calculateTxFee(numInputs, outputCount, feeRate)
    }
  }

  // Calculate max sendable using domain layer function with current fee rate
  const maxSendResult = utxos.length > 0
    ? calculateMaxSend(utxos, feeRate)
    : { maxSats: Math.max(0, totalUtxoValue - calculateTxFee(numInputs, 1, feeRate)), fee: 0, numInputs }
  const maxSendSats = maxSendResult.maxSats

  // Check if confirmation is required based on amount
  const requiresConfirmation = sendSats >= SEND_CONFIRMATION_THRESHOLD
  const isHighValue = sendSats >= HIGH_VALUE_THRESHOLD

  const handleSubmitClick = () => {
    if (!sendAddress || !sendAmount) return

    // Show confirmation for large amounts
    if (requiresConfirmation) {
      setShowConfirmation(true)
    } else {
      executeSend()
    }
  }

  const executeSend = async () => {
    setShowConfirmation(false)
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

  // Format amount for display in confirmation
  const formatAmount = (sats: number) => {
    if (sats >= 100000000) {
      return `${(sats / 100000000).toFixed(8)} BSV`
    }
    return `${sats.toLocaleString()} sats`
  }

  return (
    <>
      {showConfirmation && (
        <ConfirmationModal
          title={isHighValue ? 'Large Transaction' : 'Confirm Send'}
          message={
            isHighValue
              ? `You are about to send a large amount. Please verify the details carefully.`
              : `Are you sure you want to send this transaction?`
          }
          details={`Amount: ${formatAmount(sendSats)}\nFee: ${fee} sats\nTotal: ${formatAmount(sendSats + fee)}\nTo: ${sendAddress}`}
          type={isHighValue ? 'warning' : 'info'}
          confirmText="Send"
          cancelText="Cancel"
          onConfirm={executeSend}
          onCancel={() => setShowConfirmation(false)}
          confirmDelaySeconds={isHighValue ? 3 : 0}
        />
      )}
    <Modal onClose={onClose} title="Send BSV" className="send-modal">
      <div className="modal-content compact">
          <div className="form-group">
            <label className="form-label" htmlFor="send-address">To</label>
            <input
              id="send-address"
              type="text"
              className={`form-input mono ${addressError ? 'input-error' : ''}`}
              placeholder="Enter BSV address"
              value={sendAddress}
              onChange={e => {
                setSendAddress(e.target.value)
                validateAddress(e.target.value)
              }}
              autoComplete="off"
              aria-invalid={!!addressError}
              aria-describedby={addressError ? 'address-error' : undefined}
            />
            {addressError && (
              <div id="address-error" className="form-error" role="alert">{addressError}</div>
            )}
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
            {sendSats > 0 && (
              <div className="form-hint" style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>
                ≈ ${formatUSD(sendSats)} USD
              </div>
            )}
          </div>

          <div className="send-summary compact">
            <div className="send-summary-row">
              <span>Balance</span>
              <span>{availableSats.toLocaleString()} sats <span style={{ color: 'var(--text-tertiary)' }}>(${formatUSD(availableSats)})</span></span>
            </div>
            {sendSats > 0 && (
              <>
                <div className="send-summary-row">
                  <span>Send</span>
                  <span>{sendSats.toLocaleString()} sats <span style={{ color: 'var(--text-tertiary)' }}>(${formatUSD(sendSats)})</span></span>
                </div>
                <div className="send-summary-row total">
                  <span>Total</span>
                  <span>{(sendSats + fee).toLocaleString()} sats <span style={{ color: 'var(--text-tertiary)' }}>(${formatUSD(sendSats + fee)})</span></span>
                </div>
              </>
            )}
          </div>

          {/* Fee Estimation with adjustable rate */}
          {sendSats > 0 && (
            <FeeEstimation
              inputCount={inputCount}
              outputCount={outputCount}
              currentFee={fee}
              onFeeRateChange={handleFeeRateChange}
              showDetails={false}
              compact={false}
            />
          )}

          {/* Coin Control Section */}
          <div style={{
            borderTop: '1px solid var(--border)',
            paddingTop: 12,
            marginTop: 12
          }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowCoinControl(true)}
              style={{ width: '100%', fontSize: 12, padding: '8px 12px' }}
            >
              {selectedUtxos
                ? `🎯 Using ${selectedUtxos.length} selected UTXOs`
                : '⚙️ Coin Control (Advanced)'}
            </button>
            {selectedUtxos && (
              <button
                type="button"
                onClick={() => setSelectedUtxos(null)}
                style={{
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  fontSize: 11,
                  cursor: 'pointer',
                  marginTop: 4
                }}
              >
                Clear selection (use automatic)
              </button>
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
            onClick={handleSubmitClick}
            disabled={sending || !sendAddress || !sendAmount || !!addressError || sendSats + fee > availableSats}
          >
            {sending ? 'Sending...' : `Send ${sendSats > 0 ? sendSats.toLocaleString() + ' sats' : 'BSV'}`}
          </button>
        </div>
      </Modal>

    {/* Coin Control Modal */}
    {showCoinControl && (
      <CoinControlModal
        requiredAmount={sendSats + fee}
        onConfirm={(utxos) => {
          setSelectedUtxos(utxos)
          setShowCoinControl(false)
        }}
        onCancel={() => setShowCoinControl(false)}
      />
    )}
    </>
  )
}
