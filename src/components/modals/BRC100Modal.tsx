import { useState } from 'react'
import { feeFromBytes } from '../../adapters/walletAdapter'
import type { BRC100Request, CreateActionRequest } from '../../services/brc100'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useKeyboardNav } from '../../hooks/useKeyboardNav'

// Helper type for accessing params safely
type RequestParams = Record<string, unknown>

// Helper to get typed params
function getCreateActionParams(req: BRC100Request): CreateActionRequest | undefined {
  return req.params as unknown as CreateActionRequest | undefined
}

interface BRC100ModalProps {
  request: BRC100Request
  onApprove: () => void
  onReject: () => void
}

// Risk levels for different request types
type RiskLevel = 'low' | 'medium' | 'high'

interface RequestInfo {
  title: string
  description: string
  icon: string
  risk: RiskLevel
  warning?: string
  action: string
}

function getRequestInfo(req: BRC100Request): RequestInfo {
  switch (req.type) {
    case 'getPublicKey':
      return {
        title: 'Share Public Key',
        description: 'This app is requesting your public key. This is used for identification and does not grant access to your funds.',
        icon: '🔑',
        risk: 'low',
        action: 'Share'
      }
    case 'createSignature':
      return {
        title: 'Sign Message',
        description: 'This app wants you to cryptographically sign a message. This proves your identity without spending any BSV.',
        icon: '✍️',
        risk: 'low',
        action: 'Sign'
      }
    case 'createAction': {
      const actionParams = getCreateActionParams(req)
      const hasOutputs = actionParams?.outputs && actionParams.outputs.length > 0
      const totalAmount = hasOutputs
        ? actionParams!.outputs.reduce((sum: number, o) => sum + (o.satoshis || 0), 0)
        : 0
      const isHighValue = totalAmount > 100000 // More than 100,000 sats

      return {
        title: 'Create Transaction',
        description: hasOutputs
          ? `This will send ${totalAmount.toLocaleString()} sats from your wallet.`
          : 'This will create a transaction. Review the details carefully.',
        icon: '💸',
        risk: isHighValue ? 'high' : totalAmount > 0 ? 'medium' : 'low',
        warning: isHighValue
          ? 'This is a large transaction. Make sure you trust this app.'
          : totalAmount > 10000
          ? 'This transaction will spend from your wallet.'
          : undefined,
        action: 'Approve Transaction'
      }
    }
    case 'isAuthenticated':
      return {
        title: 'Check Connection',
        description: 'This app is checking if your wallet is connected. No action required.',
        icon: '🔌',
        risk: 'low',
        action: 'Confirm'
      }
    case 'listOutputs':
      return {
        title: 'View Balance',
        description: 'This app wants to see your UTXOs and wallet balance. No funds will be spent.',
        icon: '📊',
        risk: 'low',
        action: 'Allow'
      }
    default:
      return {
        title: 'Unknown Request',
        description: `Request type: ${req.type}. Review carefully before approving.`,
        icon: '❓',
        risk: 'medium',
        warning: 'Unknown request type. Only approve if you trust this app.',
        action: 'Approve'
      }
  }
}

function RiskBadge({ level }: { level: RiskLevel }) {
  const config = {
    low: { label: 'Low Risk', className: 'risk-low', icon: '✓' },
    medium: { label: 'Medium Risk', className: 'risk-medium', icon: '⚠' },
    high: { label: 'High Risk', className: 'risk-high', icon: '⚠' }
  }

  const { label, className, icon } = config[level]

  return (
    <span className={`risk-badge ${className}`} aria-label={`${label} operation`}>
      <span aria-hidden="true">{icon}</span> {label}
    </span>
  )
}

export function BRC100Modal({ request, onApprove, onReject }: BRC100ModalProps) {
  const [showDetails, setShowDetails] = useState(false)
  const focusTrapRef = useFocusTrap({ enabled: true })

  useKeyboardNav({
    onEscape: onReject,
    enabled: true
  })

  const info = getRequestInfo(request)

  // Calculate transaction details for createAction
  let txDetails: {
    outputCount: number
    outputAmount: number
    fee: number
    total: number
  } | null = null

  if (request.type === 'createAction') {
    const actionParams = getCreateActionParams(request)
    if (actionParams?.outputs) {
      const numOutputs = actionParams.outputs.length + 1 // +1 for change
      const outputAmount = actionParams.outputs.reduce(
        (sum: number, o) => sum + (o.satoshis || 0),
        0
      )
      const numInputs = Math.ceil((outputAmount + 200) / 10000) || 1
      const txSize = 10 + numInputs * 148 + numOutputs * 34
      const fee = feeFromBytes(txSize)

      txDetails = {
        outputCount: actionParams.outputs.length,
        outputAmount,
        fee,
        total: outputAmount + fee
      }
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="brc100-title"
    >
      <div
        ref={focusTrapRef}
        className="modal brc100-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with origin */}
        <div className="brc100-header">
          <div className="brc100-icon" aria-hidden="true">
            {info.icon}
          </div>
          {request.origin && (
            <div className="brc100-origin">
              <span className="origin-label">From</span>
              <span className="origin-value">{request.origin}</span>
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="brc100-content">
          <h2 id="brc100-title" className="brc100-title">
            {info.title}
          </h2>

          <RiskBadge level={info.risk} />

          <p className="brc100-description">{info.description}</p>

          {info.warning && (
            <div className="brc100-warning" role="alert">
              <span aria-hidden="true">⚠️</span>
              {info.warning}
            </div>
          )}

          {/* Transaction details for createAction */}
          {txDetails && (
            <div className="brc100-tx-summary">
              <div className="tx-summary-header">
                <span>Transaction Summary</span>
                <button
                  className="btn-link"
                  onClick={() => setShowDetails(!showDetails)}
                  aria-expanded={showDetails}
                >
                  {showDetails ? 'Hide details' : 'Show details'}
                </button>
              </div>

              <div className="tx-summary-main">
                <div className="tx-summary-amount">
                  <span className="amount-value">
                    {txDetails.outputAmount.toLocaleString()}
                  </span>
                  <span className="amount-unit">sats</span>
                </div>
                <span className="tx-summary-label">Amount to send</span>
              </div>

              {showDetails && (
                <div className="tx-summary-details">
                  <div className="tx-detail-row">
                    <span>Outputs</span>
                    <span>{txDetails.outputCount}</span>
                  </div>
                  <div className="tx-detail-row">
                    <span>Network fee</span>
                    <span>{txDetails.fee} sats</span>
                  </div>
                  <div className="tx-detail-row total">
                    <span>Total deducted</span>
                    <span>{txDetails.total.toLocaleString()} sats</span>
                  </div>

                  {Boolean((request.params as RequestParams)?.description) && (
                    <div className="tx-description">
                      <span className="tx-desc-label">Description:</span>
                      <span className="tx-desc-value">{String((request.params as RequestParams).description)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Signature details */}
          {request.type === 'createSignature' && request.params && (
            <div className="brc100-sig-details">
              {Boolean((request.params as RequestParams).protocolID) && (
                <div className="sig-detail">
                  <span className="sig-label">Protocol</span>
                  <span className="sig-value">
                    {((request.params as RequestParams).protocolID as [number, string])?.[1] || 'Unknown'}
                  </span>
                </div>
              )}
              {Boolean((request.params as RequestParams).keyID) && (
                <div className="sig-detail">
                  <span className="sig-label">Key ID</span>
                  <span className="sig-value">{String((request.params as RequestParams).keyID)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="brc100-actions">
          <button
            className="btn btn-secondary btn-large"
            onClick={onReject}
          >
            Reject
          </button>
          <button
            className={`btn btn-large ${info.risk === 'high' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onApprove}
          >
            {info.action}
          </button>
        </div>
      </div>
    </div>
  )
}
