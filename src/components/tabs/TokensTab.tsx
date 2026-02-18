/**
 * TokensTab Component
 *
 * Displays BSV20/BSV21 token balances with ability to send tokens.
 */

import { useState, memo, useCallback, useMemo } from 'react'
import { Search, RefreshCw } from 'lucide-react'
import type { TokenBalance } from '../../services/tokens'
import { formatTokenAmount } from '../../services/tokens'
import { useWalletState, useWalletActions } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { Modal } from '../shared/Modal'
import { ConfirmationModal } from '../shared/ConfirmationModal'
import { NoTokensEmpty } from '../shared/EmptyState'
import { isOk } from '../../domain/types'

// Memoized token card to prevent unnecessary re-renders
const TokenCard = memo(function TokenCard({
  balance,
  onSend
}: {
  balance: TokenBalance
  onSend: (balance: TokenBalance) => void
}) {
  return (
    <div className="token-card">
      <div className="token-icon">
        {balance.token.iconUrl ? (
          <img src={balance.token.iconUrl} alt={balance.token.ticker} />
        ) : (
          <span>{balance.token.ticker.slice(0, 2).toUpperCase()}</span>
        )}
      </div>
      <div className="token-info">
        <span className="token-ticker">{balance.token.ticker}</span>
        <span className="token-name">{balance.token.name || balance.token.ticker}</span>
      </div>
      <div className="token-balance">
        <span className="balance-amount">
          {formatTokenAmount(balance.total, balance.token.decimals)}
        </span>
        {balance.pending > 0n && (
          <span className="balance-pending">
            +{formatTokenAmount(balance.pending, balance.token.decimals)} pending
          </span>
        )}
      </div>
      <div className="token-actions">
        <button
          className="send-button"
          onClick={() => onSend(balance)}
          disabled={balance.confirmed <= 0n}
        >
          Send
        </button>
      </div>
    </div>
  )
})

interface TokensTabProps {
  onRefresh?: () => Promise<void>
}

export function TokensTab({ onRefresh }: TokensTabProps) {
  const { tokenBalances, tokensSyncing: loading } = useWalletState()
  const { refreshTokens, handleSendToken } = useWalletActions()
  const { showToast } = useUI()

  const handleRefresh = async () => {
    if (onRefresh) {
      await onRefresh()
    } else {
      await refreshTokens()
    }
  }
  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null)
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [sendAmount, setSendAmount] = useState('')
  const [sendAddress, setSendAddress] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [showConfirmation, setShowConfirmation] = useState(false)

  // Filter tokens - memoized to prevent recalculation
  const filteredBalances = useMemo(() =>
    tokenBalances.filter(balance =>
      balance.token.ticker.toLowerCase().includes(filter.toLowerCase()) ||
      balance.token.name?.toLowerCase().includes(filter.toLowerCase())
    ),
    [tokenBalances, filter]
  )

  const handleSendClick = () => {
    if (!selectedToken || !sendAmount || !sendAddress) return

    // Validate before showing confirmation
    if (!/^[13][a-km-zA-HJ-NP-Z1-9]{24,33}$/.test(sendAddress.trim())) {
      setError('Invalid BSV address format')
      return
    }

    const amountParsed = parseFloat(sendAmount)
    if (isNaN(amountParsed) || amountParsed <= 0) {
      setError('Invalid amount')
      return
    }

    setError('')
    setShowConfirmation(true)
  }

  const executeSend = async () => {
    if (!selectedToken || !sendAmount || !sendAddress) return

    setShowConfirmation(false)
    setSending(true)
    setError('')

    try {
      // Convert to smallest unit based on decimals
      const amountParsed = parseFloat(sendAmount)
      const decimals = Number.isFinite(selectedToken.token.decimals) && selectedToken.token.decimals >= 0
        ? selectedToken.token.decimals
        : 0
      const multiplier = Math.pow(10, decimals)
      const amountInSmallestUnit = Math.floor(amountParsed * multiplier).toString()

      // Determine ticker - for BSV21, use contract ID
      const ticker = selectedToken.token.protocol === 'bsv21'
        ? selectedToken.token.contractTxid || selectedToken.token.ticker
        : selectedToken.token.ticker

      const result = await handleSendToken(
        ticker,
        selectedToken.token.protocol,
        amountInSmallestUnit,
        sendAddress.trim()
      )

      if (isOk(result)) {
        showToast(`Sent ${sendAmount} ${selectedToken.token.ticker}!`)
        setSendModalOpen(false)
        setSendAmount('')
        setSendAddress('')
        setSelectedToken(null)
      } else {
        setError(result.error || 'Token transfer failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Token transfer failed')
    }

    setSending(false)
  }

  const openSendModal = useCallback((balance: TokenBalance) => {
    setSelectedToken(balance)
    setSendModalOpen(true)
    setError('')
  }, [])

  const closeSendModal = useCallback(() => {
    setSendModalOpen(false)
    setSendAmount('')
    setSendAddress('')
    setError('')
  }, [])

  if (loading && tokenBalances.length === 0) {
    return (
      <div className="tokens-tab">
        <div className="tokens-loading">
          <div className="loading-spinner" />
          <p>Loading tokens...</p>
        </div>
      </div>
    )
  }

  if (tokenBalances.length === 0) {
    return (
      <div className="tokens-tab">
        <NoTokensEmpty onRefresh={handleRefresh} loading={loading} />
      </div>
    )
  }

  return (
    <div className="tokens-tab">
      {/* Header */}
      <div className="tokens-header">
        <div className="tokens-search">
          <Search size={16} strokeWidth={1.75} />
          <input
            type="text"
            placeholder="Search tokens..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        <button
          className="refresh-button"
          onClick={handleRefresh}
          disabled={loading}
          title="Refresh balances"
        >
          <RefreshCw size={16} strokeWidth={1.75} className={loading ? 'spinning' : ''} />
        </button>
      </div>

      {/* Token Grid */}
      <div className="tokens-grid">
        {filteredBalances.map(balance => (
          <TokenCard
            key={`${balance.token.ticker}-${balance.token.protocol}`}
            balance={balance}
            onSend={openSendModal}
          />
        ))}
      </div>

      {/* Send Modal */}
      {sendModalOpen && selectedToken && (
        <Modal onClose={closeSendModal} title={`Send ${selectedToken.token.ticker}`}>
          <div className="modal-body">
            <div className="available-balance">
              <span>Available:</span>
              <span>{formatTokenAmount(selectedToken.confirmed, selectedToken.token.decimals)} {selectedToken.token.ticker}</span>
            </div>

            <div className="form-group">
              <label htmlFor="token-send-amount">Amount</label>
              <div className="amount-input-wrapper">
                <input
                  id="token-send-amount"
                  type="text"
                  value={sendAmount}
                  onChange={e => setSendAmount(e.target.value)}
                  placeholder="0"
                  disabled={sending}
                />
                <button
                  className="max-button"
                  onClick={() => setSendAmount(formatTokenAmount(selectedToken.confirmed, selectedToken.token.decimals))}
                  disabled={sending}
                  type="button"
                >
                  MAX
                </button>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="token-send-address">Recipient Address</label>
              <input
                id="token-send-address"
                type="text"
                value={sendAddress}
                onChange={e => setSendAddress(e.target.value)}
                placeholder="Enter BSV address"
                disabled={sending}
              />
            </div>

            {error && <p className="error-message" role="alert">{error}</p>}
          </div>

          <div className="modal-footer">
            <button className="cancel-button" onClick={closeSendModal} disabled={sending} type="button">
              Cancel
            </button>
            <button
              className="send-confirm-button"
              onClick={handleSendClick}
              disabled={sending || !sendAmount || !sendAddress}
              type="button"
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </Modal>
      )}

      {/* Confirmation modal for token sends */}
      {showConfirmation && selectedToken && (
        <ConfirmationModal
          title="Confirm Token Send"
          message={`You are about to send ${sendAmount} ${selectedToken.token.ticker}. Please verify the details.`}
          details={`Amount: ${sendAmount} ${selectedToken.token.ticker}\nTo: ${sendAddress}`}
          type="warning"
          confirmText="Send"
          cancelText="Cancel"
          onConfirm={executeSend}
          onCancel={() => setShowConfirmation(false)}
          confirmDelaySeconds={0}
        />
      )}

    </div>
  )
}
