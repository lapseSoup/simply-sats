import { useState, useCallback, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useWallet } from '../../contexts/WalletContext'
import { isValidBSVAddress } from '../../domain/wallet/validation'
import { useUI } from '../../contexts/UIContext'
import { calculateExactFee, calculateTxFee, calculateMaxSend } from '../../adapters/walletAdapter'
import { P2PKH_INPUT_SIZE, P2PKH_OUTPUT_SIZE, TX_OVERHEAD } from '../../domain/transaction/fees'
import { Modal } from '../shared/Modal'
import { ConfirmationModal, SEND_CONFIRMATION_THRESHOLD, HIGH_VALUE_THRESHOLD } from '../shared/ConfirmationModal'
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
    feeRateKB,
    handleSend
  } = useWallet()
  const { displayInSats, showToast, formatUSD } = useUI()

  const [sendAddress, setSendAddress] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [addressError, setAddressError] = useState('')

  // Validate BSV address format and checksum using domain validator
  const validateAddress = useCallback((addr: string) => {
    if (!addr) {
      setAddressError('')
      return
    }
    if (!isValidBSVAddress(addr)) {
      setAddressError('Invalid BSV address')
    } else {
      setAddressError('')
    }
  }, [])
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [showCoinControl, setShowCoinControl] = useState(false)
  const [selectedUtxos, setSelectedUtxos] = useState<DatabaseUTXO[] | null>(null)

  // Use fee rate from settings (convert from sats/KB to sats/byte)
  const feeRate = feeRateKB / 1000

  // Parse amount based on display mode (sats or BSV)
  const rawSendSats = displayInSats
    ? Math.round(parseFloat(sendAmount || '0'))
    : Math.round(parseFloat(sendAmount || '0') * 100000000)
  const sendSats = Number.isNaN(rawSendSats) ? 0 : rawSendSats
  const availableSats = balance

  // Calculate number of inputs (fallback if no UTXOs available yet)
  const numInputs = utxos.length > 0 ? utxos.length : Math.max(1, Math.ceil(balance / 10000))
  const totalUtxoValue = utxos.length > 0 ? utxos.reduce((sum, u) => sum + u.satoshis, 0) : balance

  // Calculate fee using domain layer functions with fee rate from settings
  const feeCalc = useMemo(() => {
    if (sendSats <= 0) {
      return { fee: 0, inputCount: 0, outputCount: 0, txSize: 0 }
    }

    let calcFee = 0
    let calcInputCount = 0
    let calcOutputCount = 0

    if (utxos.length > 0) {
      const feeInfo = calculateExactFee(sendSats, utxos, feeRate)
      calcFee = feeInfo.fee
      calcInputCount = feeInfo.inputCount
      calcOutputCount = feeInfo.outputCount
    } else {
      // Fallback when UTXOs not loaded
      const isMaxSend = sendSats >= totalUtxoValue - 50
      calcOutputCount = isMaxSend ? 1 : 2
      calcInputCount = numInputs
      calcFee = calculateTxFee(numInputs, calcOutputCount, feeRate)
    }

    // Calculate estimated transaction size
    const calcTxSize = TX_OVERHEAD + (calcInputCount * P2PKH_INPUT_SIZE) + (calcOutputCount * P2PKH_OUTPUT_SIZE)

    return { fee: calcFee, inputCount: calcInputCount, outputCount: calcOutputCount, txSize: calcTxSize }
  }, [sendSats, utxos, feeRate, totalUtxoValue, numInputs])

  const { fee, inputCount, outputCount, txSize } = feeCalc

  // Calculate max sendable using domain layer function with current fee rate
  const maxSendResult = useMemo(() => {
    if (utxos.length > 0) {
      return calculateMaxSend(utxos, feeRate)
    }
    return { maxSats: Math.max(0, totalUtxoValue - calculateTxFee(numInputs, 1, feeRate)), fee: 0, numInputs }
  }, [utxos, feeRate, totalUtxoValue, numInputs])

  const maxSendSats = maxSendResult.maxSats

  if (!wallet) return null

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

    // Pass selected UTXOs to handleSend if coin control was used
    const result = await handleSend(sendAddress, sendSats, selectedUtxos ?? undefined)

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
                autoComplete="off"
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
                <div className="send-summary-row">
                  <span>Fee <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>({feeRateKB} sats/KB)</span></span>
                  <span>{fee} sats <span style={{ color: 'var(--text-tertiary)' }}>(${formatUSD(fee)})</span></span>
                </div>
                <div className="send-summary-row total">
                  <span>Total</span>
                  <span>{(sendSats + fee).toLocaleString()} sats <span style={{ color: 'var(--text-tertiary)' }}>(${formatUSD(sendSats + fee)})</span></span>
                </div>
              </>
            )}
          </div>

          {/* Advanced options */}
          <details className="send-advanced">
            <summary className="send-advanced-toggle">Advanced Options</summary>
            <div className="send-advanced-content">
              {/* Transaction details */}
              {sendSats > 0 && (
                <div className="send-tx-details">
                  <div className="send-tx-row">
                    <span>Est. Size</span>
                    <span>{txSize} bytes</span>
                  </div>
                  <div className="send-tx-row">
                    <span>Inputs</span>
                    <span>{inputCount}</span>
                  </div>
                  <div className="send-tx-row">
                    <span>Outputs</span>
                    <span>{outputCount}</span>
                  </div>
                </div>
              )}

              {/* Coin Control */}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowCoinControl(true)}
                style={{ width: '100%', fontSize: 12, padding: '8px 12px', marginTop: 8 }}
              >
                {selectedUtxos
                  ? `🎯 Using ${selectedUtxos.length} selected UTXOs`
                  : '⚙️ Coin Control'}
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
          </details>

          {sendError && (
            <div className="warning compact" role="alert">
              <span className="warning-icon"><AlertTriangle size={16} strokeWidth={1.75} /></span>
              <span className="warning-text">{sendError}</span>
            </div>
          )}
          <button
            className="btn btn-primary"
            onClick={handleSubmitClick}
            disabled={sending || !sendAddress || !sendAmount || !!addressError || sendSats + fee > availableSats}
            aria-busy={sending}
          >
            {sending ? (
              <>
                <span className="spinner-small" aria-hidden="true" />
                Sending...
              </>
            ) : `Send ${sendSats > 0 ? sendSats.toLocaleString() + ' sats' : 'BSV'}`}
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
