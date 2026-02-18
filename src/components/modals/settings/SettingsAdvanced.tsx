import { useState, useCallback } from 'react'
import { PrivateKey } from '@bsv/sdk'
import {
  RefreshCw,
  Users,
  Search,
  Layers,
  Plus,
  ChevronRight
} from 'lucide-react'
import { useWalletState, useWalletActions } from '../../../contexts'
import { useUI } from '../../../contexts/UIContext'
import { addKnownSender, getKnownSenders, debugFindInvoiceNumber } from '../../../services/keyDerivation'
import { checkForPayments, getPaymentNotifications } from '../../../services/messageBox'
import { ConfirmationModal } from '../../shared/ConfirmationModal'
import { UTXOsTab } from '../../tabs/UTXOsTab'
import { handleKeyDown } from './settingsKeyDown'

export function SettingsAdvanced() {
  const { wallet } = useWalletState()
  const { performSync, fetchData } = useWalletActions()
  const { showToast } = useUI()

  const [showSenderInput, setShowSenderInput] = useState(false)
  const [senderInput, setSenderInput] = useState('')

  const [showDebugInput, setShowDebugInput] = useState(false)
  const [debugAddressInput, setDebugAddressInput] = useState('')
  const [debugSearching, setDebugSearching] = useState(false)
  const [debugResult, setDebugResult] = useState<string | null>(null)

  const [paymentNotifications, setPaymentNotifications] = useState(getPaymentNotifications())

  const [showResyncConfirm, setShowResyncConfirm] = useState(false)
  const [showUtxoExplorer, setShowUtxoExplorer] = useState(false)

  const handleAddKnownSender = useCallback(() => {
    if (senderInput.length === 66) {
      addKnownSender(senderInput)
      setSenderInput('')
      setShowSenderInput(false)
      fetchData()
      showToast('Sender added!')
    } else {
      showToast('Invalid: must be 66 hex chars', 'warning')
    }
  }, [senderInput, fetchData, showToast])

  const handleCheckMessageBox = useCallback(async () => {
    if (!wallet) return
    try {
      const { getWifForOperation } = await import('../../../services/wallet')
      const identityWif = await getWifForOperation('identity', 'checkMessageBox', wallet)
      const identityPrivKey = PrivateKey.fromWif(identityWif)
      const newPayments = await checkForPayments(identityPrivKey)
      setPaymentNotifications(getPaymentNotifications())
      if (newPayments.length > 0) {
        showToast(`Found ${newPayments.length} new payment(s)!`)
        fetchData()
      } else {
        showToast('No new payments')
      }
    } catch (_e) {
      showToast('MessageBox check failed', 'error')
    }
  }, [wallet, fetchData, showToast])

  const handleDebugSearch = useCallback(() => {
    if (!debugAddressInput || !wallet) return
    const senders = getKnownSenders()
    if (senders.length === 0) {
      setDebugResult('No known senders')
      return
    }
    setDebugSearching(true)
    setDebugResult('Searching...')
    setTimeout(async () => {
      try {
        const { getWifForOperation } = await import('../../../services/wallet')
        const identityWif = await getWifForOperation('identity', 'debugInvoiceFinder', wallet)
        const identityPrivKey = PrivateKey.fromWif(identityWif)
        for (const sender of senders) {
          const result = debugFindInvoiceNumber(identityPrivKey, sender, debugAddressInput)
          if (result.found) {
            setDebugResult(`Found: "${result.invoiceNumber}"`)
            setDebugSearching(false)
            return
          }
        }
        setDebugResult('Not found')
      } catch (_e) {
        setDebugResult('Error')
      }
      setDebugSearching(false)
    }, 100)
  }, [debugAddressInput, wallet])

  const handleResetAndResync = useCallback(() => {
    setShowResyncConfirm(true)
  }, [])

  const executeResetAndResync = useCallback(async () => {
    setShowResyncConfirm(false)
    showToast('Resetting...')
    await performSync(false, true)
    showToast('Reset complete!')
  }, [performSync, showToast])

  if (!wallet) return null

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">Advanced</div>
        <div className="settings-card">
          <div className="settings-row" role="button" tabIndex={0} onClick={handleResetAndResync} onKeyDown={handleKeyDown(handleResetAndResync)} aria-label="Reset and resync wallet">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true"><RefreshCw size={16} strokeWidth={1.75} /></div>
              <div className="settings-row-content">
                <div className="settings-row-label">Reset & Resync</div>
                <div className="settings-row-value">Clear UTXOs and sync fresh</div>
              </div>
            </div>
            <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
          </div>
          <div className="settings-row" role="button" tabIndex={0} onClick={() => setShowUtxoExplorer(!showUtxoExplorer)} onKeyDown={handleKeyDown(() => setShowUtxoExplorer(!showUtxoExplorer))} aria-label="UTXO Explorer">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true"><Layers size={16} strokeWidth={1.75} /></div>
              <div className="settings-row-content">
                <div className="settings-row-label">UTXO Explorer</div>
                <div className="settings-row-value">View, freeze, and consolidate UTXOs</div>
              </div>
            </div>
            <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
          </div>
          {showUtxoExplorer && (
            <div style={{ borderBottom: '1px solid var(--border)' }}>
              <UTXOsTab />
            </div>
          )}
          <div className="settings-row" role="button" tabIndex={0} onClick={handleCheckMessageBox} onKeyDown={handleKeyDown(handleCheckMessageBox)} aria-label="Check message box">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true">
                <RefreshCw size={16} strokeWidth={1.75} />
              </div>
              <div className="settings-row-content">
                <div className="settings-row-label">MessageBox (BRC-29)</div>
                <div className="settings-row-value">
                  {paymentNotifications.length} payment{paymentNotifications.length !== 1 ? 's' : ''} received
                </div>
              </div>
            </div>
            <span className="settings-row-arrow" aria-hidden="true"><RefreshCw size={16} strokeWidth={1.75} /></span>
          </div>

          {/* Known Senders */}
          {!showSenderInput ? (
            <div className="settings-row" role="button" tabIndex={0} onClick={() => setShowSenderInput(true)} onKeyDown={handleKeyDown(() => setShowSenderInput(true))} aria-label="Add known sender">
              <div className="settings-row-left">
                <div className="settings-row-icon" aria-hidden="true"><Users size={16} strokeWidth={1.75} /></div>
                <div className="settings-row-content">
                  <div className="settings-row-label">Known Senders (BRC-42/43)</div>
                  <div className="settings-row-value">{getKnownSenders().length} configured</div>
                </div>
              </div>
              <span className="settings-row-arrow" aria-hidden="true"><Plus size={16} strokeWidth={1.75} /></span>
            </div>
          ) : (
            <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
              <label htmlFor="sender-pubkey-input" className="sr-only">Sender public key</label>
              <input
                id="sender-pubkey-input"
                type="text"
                className="form-input"
                placeholder="66 character hex public key"
                value={senderInput}
                onChange={e => setSenderInput(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                style={{ fontFamily: 'monospace', fontSize: 11, marginBottom: 8 }}
              />
              <div className="btn-group">
                <button className="btn btn-secondary" onClick={() => { setShowSenderInput(false); setSenderInput('') }}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleAddKnownSender}>
                  Add
                </button>
              </div>
            </div>
          )}

          {/* Debug Invoice Finder — dev builds only (S-4 security hardening) */}
          {import.meta.env.DEV && getKnownSenders().length > 0 && !showDebugInput && (
            <div className="settings-row" role="button" tabIndex={0} onClick={() => setShowDebugInput(true)} onKeyDown={handleKeyDown(() => setShowDebugInput(true))} aria-label="Debug invoice finder">
              <div className="settings-row-left">
                <div className="settings-row-icon" aria-hidden="true"><Search size={16} strokeWidth={1.75} /></div>
                <div className="settings-row-content">
                  <div className="settings-row-label">Debug Invoice Finder</div>
                  <div className="settings-row-value">Search derived addresses</div>
                </div>
              </div>
              <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
            </div>
          )}
          {import.meta.env.DEV && showDebugInput && (
            <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
              <label htmlFor="debug-address-input" className="sr-only">Target address</label>
              <input
                id="debug-address-input"
                type="text"
                className="form-input"
                placeholder="Target address (e.g. 172Hcm...)"
                value={debugAddressInput}
                onChange={e => setDebugAddressInput(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                style={{ fontFamily: 'monospace', fontSize: 11, marginBottom: 8 }}
              />
              <div className="btn-group">
                <button className="btn btn-secondary" onClick={() => { setShowDebugInput(false); setDebugAddressInput(''); setDebugResult(null) }}>
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={debugSearching || !debugAddressInput} onClick={handleDebugSearch}>
                  {debugSearching ? 'Searching...' : 'Search'}
                </button>
              </div>
              {debugResult && (
                <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 12, fontFamily: 'monospace' }}>
                  {debugResult}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Resync Confirmation */}
      {showResyncConfirm && (
        <ConfirmationModal
          title="Reset & Resync"
          message="Reset UTXO database and resync from blockchain? This fixes balance issues but may take a moment."
          type="warning"
          confirmText="Reset & Resync"
          cancelText="Cancel"
          onConfirm={executeResetAndResync}
          onCancel={() => setShowResyncConfirm(false)}
        />
      )}
    </>
  )
}
