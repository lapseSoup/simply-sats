import { useState, useMemo, useRef, useCallback } from 'react'
import { AlertTriangle, Crosshair, Settings, ScanLine } from 'lucide-react'
import { useWalletState, useWalletActions, useAccounts } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { calculateExactFee, calculateTxFee, calculateMaxSend, P2PKH_INPUT_SIZE, P2PKH_OUTPUT_SIZE, TX_OVERHEAD } from '../../domain/transaction/fees'
import { useAddressValidation } from '../../hooks/useAddressValidation'
import { isValidBSVAddress } from '../../domain/wallet/validation'
import { Modal } from '../shared/Modal'
import { ConfirmationModal, SEND_CONFIRMATION_THRESHOLD, HIGH_VALUE_THRESHOLD } from '../shared/ConfirmationModal'
import { FeeEstimation } from '../shared/FeeEstimation'
import { AddressPicker } from '../shared/AddressPicker'
import { CoinControlModal } from './CoinControlModal'
import { QRScannerModal } from './QRScannerModal'
import { saveAddress } from '../../infrastructure/database'
import type { UTXO as DatabaseUTXO } from '../../infrastructure/database'
import { toWalletUtxo } from '../../domain/types'
import { btcToSatoshis, satoshisToBtc } from '../../utils/satoshiConversion'
import type { RecipientOutput } from '../../domain/transaction/builder'

/**
 * Parse a user-entered amount string to satoshis based on display mode.
 * Returns 0 for NaN or negative values.
 */
function parseAmountToSatoshis(value: string, inSats: boolean): number {
  const parsed = inSats
    ? Math.round(parseFloat(value || '0'))
    : btcToSatoshis(parseFloat(value || '0'))
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed
}

interface SendModalProps {
  onClose: () => void
}

export function SendModal({ onClose }: SendModalProps) {
  const { wallet, balance, utxos, feeRateKB } = useWalletState()
  const { handleSend, handleSendMulti, performSync } = useWalletActions()
  const { activeAccountId } = useAccounts()
  const { displayInSats, showToast, formatUSD } = useUI()

  const [sendAddress, setSendAddress] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const sendingRef = useRef(false)
  const { addressError, validateAddress } = useAddressValidation()
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [showCoinControl, setShowCoinControl] = useState(false)
  const [showQRScanner, setShowQRScanner] = useState(false)
  const [selectedUtxos, setSelectedUtxos] = useState<DatabaseUTXO[] | null>(null)

  // Fee rate override (per-transaction, does not persist to settings)
  const [feeRateOverride, setFeeRateOverride] = useState<number | null>(null)

  // Multi-recipient mode
  const [multiRecipient, setMultiRecipient] = useState(false)
  const [recipients, setRecipients] = useState<Array<{ id: number; address: string; amount: string }>>(
    [{ id: 0, address: '', amount: '' }]
  )
  const [nextRecipientId, setNextRecipientId] = useState(1)
  const [recipientErrors, setRecipientErrors] = useState<Record<number, string>>({})

  // Validate a single recipient address and update per-row error state
  const validateRecipientAddress = useCallback((id: number, address: string) => {
    setRecipientErrors(prev => {
      if (!address) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      if (!isValidBSVAddress(address)) {
        return { ...prev, [id]: 'Invalid BSV address' }
      }
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  // Multi-recipient total sats (for confirmation threshold checks)
  const multiTotalSats = useMemo(() => {
    if (!multiRecipient) return 0
    return recipients.reduce((sum, r) => sum + parseAmountToSatoshis(r.amount, displayInSats), 0)
  }, [multiRecipient, recipients, displayInSats])

  // Use fee rate override if set, otherwise from settings (convert from sats/KB to sats/byte), fallback to 0.05 sat/byte
  const feeRate = feeRateOverride ?? (feeRateKB > 0 ? feeRateKB / 1000 : 0.05)
  const effectiveFeeRateKB = feeRate * 1000

  // Parse amount based on display mode (sats or BSV)
  const sendSats = parseAmountToSatoshis(sendAmount, displayInSats)
  const amountError = sendAmount !== '' && sendSats <= 0 && sendAmount !== '0' ? 'Enter a valid amount' : ''
  const availableSats = balance

  // Use coin-controlled UTXOs when selected, otherwise full UTXO set
  // Map DatabaseUTXO (lockingScript) to wallet UTXO (script) for fee calculation
  const effectiveUtxos = selectedUtxos
    ? selectedUtxos.map(toWalletUtxo)
    : utxos

  // Calculate number of inputs (fallback if no UTXOs available yet)
  const numInputs = effectiveUtxos.length > 0 ? effectiveUtxos.length : Math.max(1, Math.ceil(balance / 10000))
  const totalUtxoValue = effectiveUtxos.length > 0 ? effectiveUtxos.reduce((sum, u) => sum + u.satoshis, 0) : balance

  // Calculate fee using domain layer functions with fee rate from settings
  const feeCalc = useMemo(() => {
    if (sendSats <= 0) {
      return { fee: 0, inputCount: 0, outputCount: 0, txSize: 0 }
    }

    let calcFee = 0
    let calcInputCount = 0
    let calcOutputCount = 0

    if (effectiveUtxos.length > 0) {
      const feeInfo = calculateExactFee(sendSats, effectiveUtxos, feeRate)
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
  }, [sendSats, effectiveUtxos, feeRate, totalUtxoValue, numInputs])

  const { fee, inputCount, outputCount, txSize } = feeCalc

  // Calculate max sendable using domain layer function with current fee rate
  const maxSendResult = useMemo(() => {
    if (effectiveUtxos.length > 0) {
      return calculateMaxSend(effectiveUtxos, feeRate)
    }
    return { maxSats: Math.max(0, totalUtxoValue - calculateTxFee(numInputs, 1, feeRate)), fee: 0, numInputs }
  }, [effectiveUtxos, feeRate, totalUtxoValue, numInputs])

  const maxSendSats = maxSendResult.maxSats

  // Hooks must be called before any conditional returns
  const recordSentAddress = useCallback(async (address: string) => {
    if (!activeAccountId) return
    const result = await saveAddress(address, '', activeAccountId)
    if (!result.ok) {
      console.warn('Failed to save address to book:', result.error.message)
    }
  }, [activeAccountId])

  const handleQRScan = useCallback((address: string) => {
    setSendAddress(address)
    validateAddress(address)
    setShowQRScanner(false)
  }, [validateAddress])

  const handleAddressSelect = useCallback((address: string) => {
    setSendAddress(address)
    validateAddress(address)
  }, [validateAddress])

  // Q-66: Wrap in useCallback to prevent unnecessary re-renders of FeeEstimation
  const handleFeeRateChange = useCallback((rate: number) => {
    setFeeRateOverride(rate)
  }, [])

  if (!wallet) return null

  // Check if confirmation is required based on amount
  const requiresConfirmation = sendSats >= SEND_CONFIRMATION_THRESHOLD
  const isHighValue = sendSats >= HIGH_VALUE_THRESHOLD

  // Multi-recipient confirmation thresholds
  const multiRequiresConfirmation = multiTotalSats >= SEND_CONFIRMATION_THRESHOLD
  const multiIsHighValue = multiTotalSats >= HIGH_VALUE_THRESHOLD
  const hasRecipientErrors = Object.keys(recipientErrors).length > 0

  const handleSubmitClick = () => {
    if (sendingRef.current) return
    if (!sendAddress || !sendAmount) return

    // Show confirmation for large amounts
    if (requiresConfirmation) {
      setShowConfirmation(true)
    } else {
      executeSend()
    }
  }

  const handleMultiSubmitClick = () => {
    if (sendingRef.current) return

    // Validate all recipient addresses and amounts before proceeding
    const errors: Record<number, string> = {}
    for (const r of recipients) {
      if (!r.address && !r.amount) continue
      if (r.address && !isValidBSVAddress(r.address)) {
        errors[r.id] = 'Invalid BSV address'
      }
      if (r.address && !r.amount) {
        errors[r.id] = errors[r.id] || 'Amount is required'
      } else if (r.amount) {
        const parsed = parseAmountToSatoshis(r.amount, displayInSats)
        if (parsed <= 0) {
          errors[r.id] = errors[r.id] || 'Enter a valid amount'
        }
      }
      if (!r.address && r.amount) {
        errors[r.id] = errors[r.id] || 'Address is required'
      }
    }
    if (Object.keys(errors).length > 0) {
      setRecipientErrors(errors)
      return
    }

    // Show confirmation for large amounts
    if (multiRequiresConfirmation) {
      setShowConfirmation(true)
    } else {
      executeSendMulti()
    }
  }

  const executeWithSendGuard = async (
    handler: () => Promise<{ ok: true; value?: unknown } | { ok: false; error: string }>,
    successToast: string,
    sentAddress?: string
  ) => {
    sendingRef.current = true
    setShowConfirmation(false)
    setSending(true)
    setSendError('')

    try {
      const result = await handler()

      if (result.ok) {
        // Q-65: Broadcast-succeeded-but-DB-failed now returns ok({ txid, warning })
        // from useWalletSend.ts — no more fragile string matching needed here
        showToast(successToast)
        if (sentAddress) void recordSentAddress(sentAddress)
        onClose()
        void performSync()
      } else {
        setSendError(result.error || 'Send failed')
      }
    } finally {
      setSending(false)
      sendingRef.current = false
    }
  }

  const executeSend = () =>
    executeWithSendGuard(
      () => handleSend(sendAddress, sendSats, selectedUtxos ?? undefined),
      `Sent ${sendSats.toLocaleString()} sats!`,
      sendAddress
    )

  const executeSendMulti = async () => {
    if (sendingRef.current) return

    const parsedRecipients: RecipientOutput[] = recipients.map(r => ({
      address: r.address,
      satoshis: parseAmountToSatoshis(r.amount, displayInSats)
    }))
    const totalSat = parsedRecipients.reduce((sum, r) => sum + r.satoshis, 0)

    await executeWithSendGuard(
      () => handleSendMulti(parsedRecipients, selectedUtxos ?? undefined),
      `Sent ${totalSat.toLocaleString()} sats to ${parsedRecipients.length} recipients!`
    )
  }

  // Format amount for display in confirmation
  const formatAmount = (sats: number) => {
    if (sats >= 100000000) {
      return `${satoshisToBtc(sats).toFixed(8)} BSV`
    }
    return `${sats.toLocaleString()} sats`
  }

  return (
    <>
      {showConfirmation && !multiRecipient && (
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
      {showConfirmation && multiRecipient && (
        <ConfirmationModal
          title={multiIsHighValue ? 'Large Transaction' : 'Confirm Multi-Send'}
          message={
            multiIsHighValue
              ? `You are about to send a large amount to ${recipients.length} recipients. Please verify carefully.`
              : `Are you sure you want to send to ${recipients.length} recipients?`
          }
          details={`Total: ${formatAmount(multiTotalSats)}\nRecipients: ${recipients.length}\n${recipients.map(r => `  ${r.address.slice(0, 12)}... → ${r.amount} ${displayInSats ? 'sats' : 'BSV'}`).join('\n')}`}
          type={multiIsHighValue ? 'warning' : 'info'}
          confirmText="Send"
          cancelText="Cancel"
          onConfirm={executeSendMulti}
          onCancel={() => setShowConfirmation(false)}
          confirmDelaySeconds={multiIsHighValue ? 3 : 0}
        />
      )}
    <Modal onClose={onClose} title="Send BSV" className="send-modal">
      <div className="modal-content compact">
          {/* Address field with QR + address book buttons */}
          <div className="form-group">
            <label className="form-label" htmlFor="send-address">To</label>
            <div className="send-modal-address-row">
              <div className="send-modal-address-wrap">
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
              </div>
              <div className="send-modal-address-actions">
                <AddressPicker
                  onSelect={handleAddressSelect}
                  accountId={activeAccountId ?? 1}
                />
                <button
                  type="button"
                  onClick={() => setShowQRScanner(true)}
                  aria-label="Scan QR code"
                  className="send-modal-icon-btn"
                >
                  <ScanLine size={16} />
                </button>
              </div>
            </div>
            {addressError && (
              <div id="address-error" className="form-error" role="alert">{addressError}</div>
            )}
          </div>

          {/* Amount field */}
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
                min="0"
                value={sendAmount}
                onChange={e => setSendAmount(e.target.value)}
                autoComplete="off"
              />
              <button
                className="input-action"
                onClick={() => setSendAmount(displayInSats ? String(maxSendSats) : satoshisToBtc(maxSendSats).toFixed(8))}
                type="button"
              >
                MAX
              </button>
            </div>
            {sendSats > 0 && (
              <div className="form-hint send-modal-amount-hint">
                {displayInSats
                  ? <>{sendSats.toLocaleString()} sats &middot; </>
                  : <>{satoshisToBtc(sendSats).toFixed(8)} BSV &middot; </>
                }
                ≈ ${formatUSD(sendSats)} USD
              </div>
            )}
            {amountError && (
              <div className="form-error" role="alert">{amountError}</div>
            )}
          </div>

          {/* Send summary — always visible */}
          <div className="send-summary compact">
            <div className="send-summary-row">
              <span>Balance</span>
              <span>{availableSats.toLocaleString()} sats <span className="send-modal-tertiary">(${formatUSD(availableSats)})</span></span>
            </div>
            {sendSats > 0 && (
              <>
                <div className="send-summary-row">
                  <span>Send</span>
                  <span>{sendSats.toLocaleString()} sats <span className="send-modal-tertiary">(${formatUSD(sendSats)})</span></span>
                </div>
                <div className="send-summary-row">
                  <span>Fee <span className="send-modal-fee-hint">({effectiveFeeRateKB} sats/KB{feeRateOverride !== null ? ' · custom' : ''})</span></span>
                  <span>{fee} sats <span className="send-modal-tertiary">(${formatUSD(fee)})</span></span>
                </div>
                <div className="send-summary-row total">
                  <span>Total</span>
                  <span>{(sendSats + fee).toLocaleString()} sats <span className="send-modal-tertiary">(${formatUSD(sendSats + fee)})</span></span>
                </div>
              </>
            )}
          </div>

          {/* Advanced options */}
          <details className="send-advanced">
            <summary className="send-advanced-toggle">Advanced Options</summary>
            <div className="send-advanced-content">
              {/* Multiple recipients toggle */}
              {!multiRecipient ? (
                <button
                  type="button"
                  className="btn btn-ghost send-modal-advanced-btn"
                  onClick={() => setMultiRecipient(true)}
                >
                  + Multiple recipients
                </button>
              ) : (
                <div className="form-group send-modal-no-mt">
                  <div className="send-modal-recipients-header">
                    <label className="form-label send-modal-recipients-label">Recipients</label>
                    <button
                      type="button"
                      className="send-modal-link-btn"
                      onClick={() => { setMultiRecipient(false); setRecipients([{ id: 0, address: '', amount: '' }]); setNextRecipientId(1) }}
                    >
                      - Single recipient
                    </button>
                  </div>
                  {recipients.map((r) => (
                    <div key={r.id} className="send-modal-recipient-row">
                      <div className="send-modal-recipient-inputs">
                        <input
                          type="text"
                          className={`form-input mono send-modal-recipient-address ${recipientErrors[r.id] ? 'input-error' : ''}`}
                          placeholder="BSV address"
                          value={r.address}
                          onChange={e => {
                            setRecipients(prev => prev.map(x => x.id === r.id ? { ...x, address: e.target.value } : x))
                            validateRecipientAddress(r.id, e.target.value)
                          }}
                          autoComplete="off"
                          aria-invalid={!!recipientErrors[r.id]}
                          aria-describedby={recipientErrors[r.id] ? `recipient-${r.id}-error` : undefined}
                        />
                        <input
                          type="number"
                          className={`form-input send-modal-recipient-amount ${recipientErrors[r.id] ? 'input-error' : ''}`}
                          placeholder={displayInSats ? '0' : '0.00000000'}
                          step={displayInSats ? '1' : '0.00000001'}
                          min="0"
                          value={r.amount}
                          onChange={e => {
                            setRecipients(prev => prev.map(x => x.id === r.id ? { ...x, amount: e.target.value } : x))
                          }}
                          autoComplete="off"
                          aria-invalid={!!recipientErrors[r.id]}
                          aria-describedby={recipientErrors[r.id] ? `recipient-${r.id}-error` : undefined}
                        />
                        {recipients.length > 1 && (
                          <button
                            type="button"
                            className="send-modal-remove-btn"
                            onClick={() => {
                              setRecipients(prev => prev.filter(x => x.id !== r.id))
                              setRecipientErrors(prev => { const next = { ...prev }; delete next[r.id]; return next })
                            }}
                            aria-label="Remove recipient"
                          >
                            -
                          </button>
                        )}
                      </div>
                      {recipientErrors[r.id] && (
                        <div id={`recipient-${r.id}-error`} className="form-error send-modal-recipient-error" role="alert">{recipientErrors[r.id]}</div>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn btn-ghost send-modal-advanced-btn-sm"
                    onClick={() => {
                      setRecipients(r => [...r, { id: nextRecipientId, address: '', amount: '' }])
                      setNextRecipientId(n => n + 1)
                    }}
                  >
                    + Add recipient
                  </button>
                </div>
              )}

              {/* Fee Rate selector */}
              <FeeEstimation
                inputCount={sendSats > 0 ? inputCount : 1}
                outputCount={sendSats > 0 ? outputCount : 2}
                currentFee={fee}
                onFeeRateChange={handleFeeRateChange}
                compact={true}
              />

              {/* Coin Control */}
              <button
                type="button"
                className="btn btn-ghost send-modal-advanced-btn-mt"
                onClick={() => setShowCoinControl(true)}
              >
                {selectedUtxos
                  ? <><Crosshair size={14} strokeWidth={1.75} /> Using {selectedUtxos.length} selected UTXOs</>
                  : <><Settings size={14} strokeWidth={1.75} /> Coin Control</>}
              </button>
              {selectedUtxos && (
                <button
                  type="button"
                  onClick={() => setSelectedUtxos(null)}
                  className="send-modal-clear-btn"
                >
                  Clear selection (use automatic)
                </button>
              )}

              {/* Transaction details */}
              {sendSats > 0 && (
                <div className="send-tx-details send-modal-tx-details">
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
            </div>
          </details>

          {sendError && (
            <div className="warning error compact" role="alert">
              <span className="warning-icon"><AlertTriangle size={16} strokeWidth={1.75} /></span>
              <span className="warning-text">{sendError}</span>
            </div>
          )}
          {multiRecipient ? (
            <button
              className="btn btn-primary"
              onClick={handleMultiSubmitClick}
              disabled={sending || recipients.some(r => !r.address || !r.amount) || recipients.length === 0 || hasRecipientErrors}
              aria-busy={sending}
              type="button"
            >
              {sending ? (
                <>
                  <span className="spinner-small" aria-hidden="true" />
                  Sending...
                </>
              ) : `Send to ${recipients.length} recipient${recipients.length !== 1 ? 's' : ''}`}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleSubmitClick}
              disabled={sending || !sendAddress || !sendAmount || !!addressError || sendSats <= 0 || sendSats + fee > availableSats}
              aria-busy={sending}
            >
              {sending ? (
                <>
                  <span className="spinner-small" aria-hidden="true" />
                  Sending...
                </>
              ) : `Send ${sendSats > 0 ? sendSats.toLocaleString() + ' sats' : 'BSV'}`}
            </button>
          )}
        </div>
      </Modal>

    {/* QR Scanner Modal */}
    {showQRScanner && (
      <QRScannerModal
        onScan={handleQRScan}
        onClose={() => setShowQRScanner(false)}
      />
    )}

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
