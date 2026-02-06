/**
 * TokensTab Component
 *
 * Displays BSV20/BSV21 token balances with ability to send tokens.
 */

import { useState, memo, useCallback, useMemo } from 'react'
import type { TokenBalance } from '../../services/tokens'
import { formatTokenAmount } from '../../services/tokens'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import { Modal } from '../shared/Modal'
import { ConfirmationModal } from '../shared/ConfirmationModal'
import { NoTokensEmpty } from '../shared/EmptyState'

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
  const { tokenBalances, tokensSyncing: loading, refreshTokens, handleSendToken } = useWallet()
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
      const multiplier = Math.pow(10, selectedToken.token.decimals)
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

      if (result.success) {
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
        <style>{tokensStyles}</style>
      </div>
    )
  }

  if (tokenBalances.length === 0) {
    return (
      <div className="tokens-tab">
        <NoTokensEmpty onRefresh={handleRefresh} loading={loading} />
        <style>{tokensStyles}</style>
      </div>
    )
  }

  return (
    <div className="tokens-tab">
      {/* Header */}
      <div className="tokens-header">
        <div className="tokens-search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11L14 14" />
          </svg>
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
          <svg
            className={loading ? 'spinning' : ''}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M1 8C1 4.13 4.13 1 8 1C10.12 1 12 2 13.25 3.5L15 2V7H10L12 5C11 3.5 9.5 2.5 8 2.5C5 2.5 2.5 5 2.5 8C2.5 11 5 13.5 8 13.5C10.5 13.5 12.5 11.75 13.25 9.5H14.75C14 12.5 11.25 15 8 15C4.13 15 1 11.87 1 8Z" />
          </svg>
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

      <style>{tokensStyles}</style>
    </div>
  )
}

const tokensStyles = `
  .tokens-tab {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
  }

  .tokens-loading,
  .tokens-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 3rem 1rem;
    text-align: center;
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
  }

  .tokens-empty svg {
    opacity: 0.5;
  }

  .tokens-empty h3 {
    margin: 0;
    font-size: 1.125rem;
    color: var(--color-text, #fff);
  }

  .tokens-empty p {
    margin: 0;
    font-size: 0.875rem;
  }

  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--color-surface, rgba(255, 255, 255, 0.1));
    border-top-color: var(--color-primary, #f7931a);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .tokens-header {
    display: flex;
    gap: 0.75rem;
  }

  .tokens-search {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--color-surface, rgba(255, 255, 255, 0.05));
    border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
    border-radius: 0.5rem;
  }

  .tokens-search svg {
    flex-shrink: 0;
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.5));
  }

  .tokens-search input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--color-text, #fff);
    font-size: 0.875rem;
    outline: none;
  }

  .tokens-search input::placeholder {
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.4));
  }

  .refresh-button {
    padding: 0.5rem;
    background: var(--color-surface, rgba(255, 255, 255, 0.05));
    border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
    border-radius: 0.5rem;
    color: var(--color-text, #fff);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .refresh-button:hover:not(:disabled) {
    background: var(--color-surface-2, rgba(255, 255, 255, 0.1));
  }

  .refresh-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .refresh-button svg.spinning {
    animation: spin 1s linear infinite;
  }

  .tokens-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .token-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--color-surface, rgba(255, 255, 255, 0.05));
    border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
    border-radius: 0.75rem;
    transition: all 0.15s ease;
  }

  .token-card:hover {
    border-color: var(--color-border-hover, rgba(255, 255, 255, 0.2));
  }

  .token-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--color-primary, #f7931a), var(--color-secondary, #ff6b00));
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
  }

  .token-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .token-icon span {
    font-size: 0.875rem;
    font-weight: 600;
    color: white;
  }

  .token-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .token-ticker {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text, #fff);
  }

  .token-name {
    font-size: 0.75rem;
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.5));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .token-balance {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    min-width: 0;
  }

  .balance-amount {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text, #fff);
    font-family: monospace;
  }

  .balance-pending {
    font-size: 0.6875rem;
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.5));
  }

  .token-actions {
    flex-shrink: 0;
  }

  .send-button {
    padding: 0.375rem 0.75rem;
    background: var(--color-primary, #f7931a);
    border: none;
    border-radius: 0.375rem;
    color: white;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .send-button:hover:not(:disabled) {
    background: var(--color-secondary, #ff6b00);
  }

  .send-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Modal Styles */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 1rem;
  }

  .modal-content {
    background: var(--color-background, #1a1a2e);
    border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
    border-radius: 1rem;
    max-width: 400px;
    width: 100%;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1rem;
    color: var(--color-text, #fff);
  }

  .close-button {
    background: transparent;
    border: none;
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
    cursor: pointer;
    padding: 0.25rem;
  }

  .close-button:hover {
    color: var(--color-text, #fff);
  }

  .modal-body {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .available-balance {
    display: flex;
    justify-content: space-between;
    padding: 0.75rem;
    background: var(--color-surface, rgba(255, 255, 255, 0.05));
    border-radius: 0.5rem;
    font-size: 0.875rem;
  }

  .available-balance span:first-child {
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
  }

  .available-balance span:last-child {
    color: var(--color-text, #fff);
    font-family: monospace;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-group label {
    font-size: 0.8125rem;
    color: var(--color-text-secondary, rgba(255, 255, 255, 0.7));
  }

  .form-group input {
    padding: 0.75rem;
    background: var(--color-surface, rgba(255, 255, 255, 0.05));
    border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
    border-radius: 0.5rem;
    color: var(--color-text, #fff);
    font-size: 0.875rem;
    outline: none;
  }

  .form-group input:focus {
    border-color: var(--color-primary, #f7931a);
  }

  .amount-input-wrapper {
    display: flex;
    gap: 0.5rem;
  }

  .amount-input-wrapper input {
    flex: 1;
  }

  .max-button {
    padding: 0 0.75rem;
    background: var(--color-surface-2, rgba(255, 255, 255, 0.1));
    border: none;
    border-radius: 0.375rem;
    color: var(--color-primary, #f7931a);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .max-button:hover:not(:disabled) {
    background: var(--color-surface-3, rgba(255, 255, 255, 0.15));
  }

  .error-message {
    color: var(--color-error, #ef4444);
    font-size: 0.8125rem;
    margin: 0;
  }

  .modal-footer {
    display: flex;
    gap: 0.75rem;
    padding: 1rem;
    border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  }

  .cancel-button,
  .send-confirm-button {
    flex: 1;
    padding: 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .cancel-button {
    background: transparent;
    border: 1px solid var(--color-border, rgba(255, 255, 255, 0.2));
    color: var(--color-text, #fff);
  }

  .cancel-button:hover:not(:disabled) {
    background: var(--color-surface, rgba(255, 255, 255, 0.05));
  }

  .send-confirm-button {
    background: linear-gradient(135deg, var(--color-primary, #f7931a), var(--color-secondary, #ff6b00));
    border: none;
    color: white;
  }

  .send-confirm-button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(247, 147, 26, 0.3);
  }

  .send-confirm-button:disabled,
  .cancel-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`
