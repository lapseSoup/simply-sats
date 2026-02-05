import { useState } from 'react'
import { PrivateKey } from '@bsv/sdk'
import { save, open } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import { addKnownSender, getKnownSenders, debugFindInvoiceNumber } from '../../services/keyDerivation'
import { checkForPayments, getPaymentNotifications } from '../../services/messageBox'
import { exportDatabase, importDatabase, type DatabaseBackup } from '../../services/database'
import { ConfirmationModal } from '../shared/ConfirmationModal'
import { TestRecoveryModal } from './TestRecoveryModal'

// SVG Icons for Settings
const iconProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const WalletIcon = () => <svg {...iconProps}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M16 10h.01"/></svg>
const PaletteIcon = () => <svg {...iconProps}><circle cx="13.5" cy="6.5" r="0.5" fill="currentColor"/><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor"/><circle cx="6.5" cy="12.5" r="0.5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z"/></svg>
const KeyIcon = () => <svg {...iconProps}><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3L22 7l-3-3"/></svg>
const FuelIcon = () => <svg {...iconProps}><path d="M3 22V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v17"/><path d="M13 10h4a2 2 0 0 1 2 2v8a2 2 0 0 0 2 2"/><path d="M17 22V7"/><path d="M7 10v4"/></svg>
const LogsIcon = () => <svg {...iconProps}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>
const LockIcon = () => <svg {...iconProps}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
const SaveIcon = () => <svg {...iconProps}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/></svg>
const DownloadIcon = () => <svg {...iconProps}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
const RefreshIcon = () => <svg {...iconProps}><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
const UsersIcon = () => <svg {...iconProps}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
const SearchIcon = () => <svg {...iconProps}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
const BotIcon = () => <svg {...iconProps}><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>
const PlusIcon = () => <svg {...iconProps}><path d="M12 5v14M5 12h14"/></svg>
const LinkIcon = () => <svg {...iconProps}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
const CopyIcon = () => <svg {...iconProps}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
const ChevronRightIcon = () => <svg {...iconProps}><path d="m9 18 6-6-6-6"/></svg>
interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const {
    wallet,
    feeRateKB,
    setFeeRate,
    connectedApps,
    trustedOrigins,
    addTrustedOrigin,
    removeTrustedOrigin,
    disconnectApp,
    handleDeleteWallet,
    performSync,
    fetchData,
    // Auto-lock settings
    autoLockMinutes,
    setAutoLockMinutes,
    lockWallet
  } = useWallet()
  const { copyToClipboard, showToast } = useUI()

  // Local state for various input forms
  const [showSenderInput, setShowSenderInput] = useState(false)
  const [senderInput, setSenderInput] = useState('')

  const [showTrustedOriginInput, setShowTrustedOriginInput] = useState(false)
  const [trustedOriginInput, setTrustedOriginInput] = useState('')

  const [showDebugInput, setShowDebugInput] = useState(false)
  const [debugAddressInput, setDebugAddressInput] = useState('')
  const [debugSearching, setDebugSearching] = useState(false)
  const [debugResult, setDebugResult] = useState<string | null>(null)

  const [_messageBoxStatus, setMessageBoxStatus] = useState<'idle' | 'checking' | 'error'>('idle')
  const [paymentNotifications, setPaymentNotifications] = useState(getPaymentNotifications())

  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false)
  const [showTestRecovery, setShowTestRecovery] = useState(false)

  if (!wallet) return null

  const handleAddKnownSender = () => {
    if (senderInput.length === 66) {
      addKnownSender(senderInput)
      setSenderInput('')
      setShowSenderInput(false)
      fetchData()
      showToast('Sender added!')
    } else {
      showToast('Invalid: must be 66 hex chars')
    }
  }

  const handleAddTrustedOrigin = () => {
    if (trustedOriginInput.trim()) {
      addTrustedOrigin(trustedOriginInput.trim())
      setTrustedOriginInput('')
      setShowTrustedOriginInput(false)
      showToast(`Trusted origin "${trustedOriginInput.trim()}" added!`)
    }
  }

  const handleCheckMessageBox = async () => {
    if (!wallet?.identityWif) return
    setMessageBoxStatus('checking')
    try {
      const identityPrivKey = PrivateKey.fromWif(wallet.identityWif)
      const newPayments = await checkForPayments(identityPrivKey)
      setPaymentNotifications(getPaymentNotifications())
      if (newPayments.length > 0) {
        showToast(`Found ${newPayments.length} new payment(s)!`)
        fetchData()
      } else {
        showToast('No new payments')
      }
      setMessageBoxStatus('idle')
    } catch (_e) {
      setMessageBoxStatus('error')
      showToast('MessageBox check failed')
    }
  }

  const handleDebugSearch = () => {
    if (!debugAddressInput || !wallet.identityWif) return
    const senders = getKnownSenders()
    if (senders.length === 0) {
      setDebugResult('❌ No known senders')
      return
    }
    setDebugSearching(true)
    setDebugResult('🔍 Searching...')
    setTimeout(() => {
      try {
        const identityPrivKey = PrivateKey.fromWif(wallet.identityWif)
        for (const sender of senders) {
          const result = debugFindInvoiceNumber(identityPrivKey, sender, debugAddressInput)
          if (result.found) {
            setDebugResult(`✅ Found: "${result.invoiceNumber}"`)
            setDebugSearching(false)
            return
          }
        }
        setDebugResult('❌ Not found')
      } catch (_e) {
        setDebugResult('❌ Error')
      }
      setDebugSearching(false)
    }, 100)
  }

  const handleExportFullBackup = async () => {
    try {
      const dbBackup = await exportDatabase()
      const fullBackup = {
        format: 'simply-sats-full',
        wallet: {
          mnemonic: wallet.mnemonic || null,
          keys: {
            identity: { wif: wallet.identityWif, pubKey: wallet.identityPubKey },
            payment: { wif: wallet.walletWif, address: wallet.walletAddress },
            ordinals: { wif: wallet.ordWif, address: wallet.ordAddress }
          }
        },
        database: dbBackup
      }
      const backupJson = JSON.stringify(fullBackup, null, 2)
      const filePath = await save({
        defaultPath: `simply-sats-backup-${new Date().toISOString().split('T')[0]}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (filePath) {
        await writeTextFile(filePath, backupJson)
        showToast('Backup saved!')
      }
    } catch (_err) {
      showToast('Backup failed')
    }
  }

  const handleImportBackup = async () => {
    try {
      const filePath = await open({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false
      })
      if (!filePath || Array.isArray(filePath)) return
      const json = await readTextFile(filePath)
      const backup = JSON.parse(json)
      if (backup.format !== 'simply-sats-full' || !backup.database) {
        showToast('Invalid backup format')
        return
      }
      if (confirm(`Import ${backup.database.utxos.length} UTXOs and ${backup.database.transactions.length} transactions?`)) {
        await importDatabase(backup.database as DatabaseBackup)
        showToast('Backup imported!')
        performSync(false)
      }
    } catch (_err) {
      showToast('Import failed')
    }
  }

  const handleExportKeys = () => {
    if (confirm('WARNING: Never share your private keys!')) {
      const backup = JSON.stringify({
        format: 'simply-sats',
        version: 1,
        mnemonic: wallet.mnemonic || null,
        keys: {
          identity: { wif: wallet.identityWif, pubKey: wallet.identityPubKey },
          payment: { wif: wallet.walletWif, address: wallet.walletAddress },
          ordinals: { wif: wallet.ordWif, address: wallet.ordAddress }
        }
      }, null, 2)
      navigator.clipboard.writeText(backup)
      showToast('Keys copied to clipboard!')
    }
  }

  const handleShowMnemonic = () => {
    if (wallet.mnemonic && confirm('Make sure no one can see your screen!')) {
      alert(wallet.mnemonic)
    }
  }

  const handleResetAndResync = async () => {
    if (confirm('Reset UTXO database and resync from blockchain? This fixes balance issues but may take a moment.')) {
      showToast('Resetting...')
      await performSync(false, true)
      showToast('Reset complete!')
    }
  }

  const handleDeleteClick = () => {
    setShowDeleteConfirmation(true)
  }

  const executeDelete = async () => {
    setShowDeleteConfirmation(false)
    await handleDeleteWallet()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Settings</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          {/* WALLET SECTION */}
          <div className="settings-section">
            <div className="settings-section-title">Wallet</div>
            <div className="settings-card">
              <div className="settings-row" onClick={() => wallet?.walletAddress && copyToClipboard(wallet.walletAddress, 'Payment address copied!')}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><WalletIcon /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Payment Address</div>
                    <div className="settings-row-value">{wallet?.walletAddress ? `${wallet.walletAddress.slice(0, 12)}...${wallet.walletAddress.slice(-6)}` : '—'}</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><CopyIcon /></span>
              </div>
              <div className="settings-row" onClick={() => wallet?.ordAddress && copyToClipboard(wallet.ordAddress, 'Ordinals address copied!')}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><PaletteIcon /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Ordinals Address</div>
                    <div className="settings-row-value">{wallet?.ordAddress ? `${wallet.ordAddress.slice(0, 12)}...${wallet.ordAddress.slice(-6)}` : '—'}</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><CopyIcon /></span>
              </div>
              <div className="settings-row" onClick={() => wallet?.identityPubKey && copyToClipboard(wallet.identityPubKey, 'Identity key copied!')}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><KeyIcon /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Identity Key</div>
                    <div className="settings-row-value">{wallet?.identityPubKey ? `${wallet.identityPubKey.slice(0, 12)}...${wallet.identityPubKey.slice(-6)}` : '—'}</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><CopyIcon /></span>
              </div>
            </div>
          </div>

          {/* TRANSACTION SECTION */}
          <div className="settings-section">
            <div className="settings-section-title">Transactions</div>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><FuelIcon /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Fee Rate</div>
                    <div className="settings-row-value">
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        value={feeRateKB}
                        onChange={(e) => setFeeRate(parseInt(e.target.value) || 100)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Fee rate in sats per KB"
                        style={{
                          width: '60px',
                          padding: '4px 8px',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                          textAlign: 'right'
                        }}
                      /> sats/KB
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                Default: 100 sats/KB. Most miners accept 50-100. Lower = cheaper, higher = faster confirmation.
              </div>
            </div>
          </div>

          {/* SECURITY SECTION */}
          <div className="settings-section">
            <div className="settings-section-title">Security</div>
            <div className="settings-card">
              {/* Auto-Lock Timer */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M8 4V8L10.5 10.5" />
                    </svg>
                  </div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Auto-Lock Timer</div>
                    <div className="settings-row-value">
                      <select
                        value={autoLockMinutes}
                        onChange={(e) => setAutoLockMinutes(parseInt(e.target.value))}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Auto-lock timeout"
                        style={{
                          padding: '4px 8px',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="0">Never</option>
                        <option value="5">5 minutes</option>
                        <option value="10">10 minutes</option>
                        <option value="30">30 minutes</option>
                        <option value="60">1 hour</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Lock Now Button */}
              <div className="settings-row" onClick={() => { lockWallet(); onClose(); }}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="7" width="10" height="7" rx="1" />
                      <path d="M5 7V5C5 3.34 6.34 2 8 2C9.66 2 11 3.34 11 5V7" />
                    </svg>
                  </div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Lock Wallet Now</div>
                    <div className="settings-row-value">Require password to unlock</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><ChevronRightIcon /></span>
              </div>

              {wallet.mnemonic && (
                <>
                  <div className="settings-row" onClick={handleShowMnemonic}>
                    <div className="settings-row-left">
                      <div className="settings-row-icon" aria-hidden="true"><LogsIcon /></div>
                      <div className="settings-row-content">
                        <div className="settings-row-label">Recovery Phrase</div>
                        <div className="settings-row-value">12 words</div>
                      </div>
                    </div>
                    <span className="settings-row-arrow" aria-hidden="true"><ChevronRightIcon /></span>
                  </div>
                  <div className="settings-row" onClick={() => setShowTestRecovery(true)}>
                    <div className="settings-row-left">
                      <div className="settings-row-icon" aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 11l3 3L22 4" />
                          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                        </svg>
                      </div>
                      <div className="settings-row-content">
                        <div className="settings-row-label">Test Recovery</div>
                        <div className="settings-row-value">Verify backup works</div>
                      </div>
                    </div>
                    <span className="settings-row-arrow" aria-hidden="true"><ChevronRightIcon /></span>
                  </div>
                </>
              )}
              <div className="settings-row" onClick={handleExportKeys}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><LockIcon /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Export Private Keys</div>
                    <div className="settings-row-value">Copy JSON to clipboard</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><ChevronRightIcon /></span>
              </div>
            </div>
          </div>

          {/* BACKUP SECTION */}
          <div className="settings-section">
            <div className="settings-section-title">Backup</div>
            <div className="settings-card">
              <div className="settings-row" onClick={handleExportFullBackup}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><SaveIcon /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Export Full Backup</div>
                    <div className="settings-row-value">Wallet + transactions</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><ChevronRightIcon /></span>
              </div>
              <div className="settings-row" onClick={handleImportBackup}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><DownloadIcon /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Import Backup</div>
                    <div className="settings-row-value">Restore from file</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><ChevronRightIcon /></span>
              </div>
            </div>
          </div>

          {/* ADVANCED SECTION */}
          <div className="settings-section">
            <div className="settings-section-title">Advanced</div>
            <div className="settings-card">
              <div className="settings-row" onClick={handleResetAndResync}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><RefreshIcon /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Reset & Resync</div>
                    <div className="settings-row-value">Clear UTXOs and sync fresh</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><ChevronRightIcon /></span>
              </div>
              <div className="settings-row" onClick={handleCheckMessageBox}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true">
                    <RefreshIcon />
                  </div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">MessageBox (BRC-29)</div>
                    <div className="settings-row-value">
                      {paymentNotifications.length} payment{paymentNotifications.length !== 1 ? 's' : ''} received
                    </div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><RefreshIcon /></span>
              </div>

              {/* Known Senders */}
              {!showSenderInput ? (
                <div className="settings-row" onClick={() => setShowSenderInput(true)}>
                  <div className="settings-row-left">
                    <div className="settings-row-icon" aria-hidden="true"><UsersIcon /></div>
                    <div className="settings-row-content">
                      <div className="settings-row-label">Known Senders (BRC-42/43)</div>
                      <div className="settings-row-value">{getKnownSenders().length} configured</div>
                    </div>
                  </div>
                  <span className="settings-row-arrow" aria-hidden="true"><PlusIcon /></span>
                </div>
              ) : (
                <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="66 character hex public key"
                    value={senderInput}
                    onChange={e => setSenderInput(e.target.value)}
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

              {/* Debug Invoice Finder */}
              {getKnownSenders().length > 0 && !showDebugInput && (
                <div className="settings-row" onClick={() => setShowDebugInput(true)}>
                  <div className="settings-row-left">
                    <div className="settings-row-icon" aria-hidden="true"><SearchIcon /></div>
                    <div className="settings-row-content">
                      <div className="settings-row-label">Debug Invoice Finder</div>
                      <div className="settings-row-value">Search derived addresses</div>
                    </div>
                  </div>
                  <span className="settings-row-arrow" aria-hidden="true"><ChevronRightIcon /></span>
                </div>
              )}
              {showDebugInput && (
                <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Target address (e.g. 172Hcm...)"
                    value={debugAddressInput}
                    onChange={e => setDebugAddressInput(e.target.value)}
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

          {/* TRUSTED ORIGINS */}
          <div className="settings-section">
            <div className="settings-section-title">Trusted Origins (Auto-Approve)</div>
            <div className="settings-card">
              <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                Requests from these origins will be auto-approved without prompting.
              </div>
              {trustedOrigins.map(origin => (
                <div key={origin} className="settings-row">
                  <div className="settings-row-left">
                    <div className="settings-row-icon" aria-hidden="true"><BotIcon /></div>
                    <div className="settings-row-content">
                      <div className="settings-row-label">{origin}</div>
                      <div className="settings-row-value">Auto-approve enabled</div>
                    </div>
                  </div>
                  <button className="app-disconnect" onClick={() => removeTrustedOrigin(origin)}>
                    Remove
                  </button>
                </div>
              ))}
              {!showTrustedOriginInput ? (
                <div className="settings-row" onClick={() => setShowTrustedOriginInput(true)}>
                  <div className="settings-row-left">
                    <div className="settings-row-icon" aria-hidden="true"><PlusIcon /></div>
                    <div className="settings-row-content">
                      <div className="settings-row-label">Add Trusted Origin</div>
                      <div className="settings-row-value">e.g., "ai-agent", "wrootz"</div>
                    </div>
                  </div>
                  <span className="settings-row-arrow" aria-hidden="true"><PlusIcon /></span>
                </div>
              ) : (
                <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Origin name (e.g., ai-agent, wrootz)"
                    value={trustedOriginInput}
                    onChange={e => setTrustedOriginInput(e.target.value)}
                    style={{ marginBottom: 8 }}
                  />
                  <div className="btn-group">
                    <button className="btn btn-secondary" onClick={() => { setShowTrustedOriginInput(false); setTrustedOriginInput('') }}>
                      Cancel
                    </button>
                    <button className="btn btn-primary" onClick={handleAddTrustedOrigin}>
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* CONNECTED APPS */}
          {connectedApps.length > 0 && (
            <div className="settings-section">
              <div className="settings-section-title">Connected Apps</div>
              <div className="settings-card">
                {connectedApps.map(app => (
                  <div key={app} className="settings-row">
                    <div className="settings-row-left">
                      <div className="settings-row-icon" aria-hidden="true"><LinkIcon /></div>
                      <div className="settings-row-content">
                        <div className="settings-row-label">{app}</div>
                      </div>
                    </div>
                    <button className="app-disconnect" onClick={() => disconnectApp(app)}>
                      Disconnect
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DANGER ZONE */}
          <div className="settings-section">
            <div className="settings-section-title">Danger Zone</div>
            <button className="btn btn-danger" onClick={handleDeleteClick}>
              Delete Wallet
            </button>
          </div>
        </div>
      </div>

      {/* Delete Wallet Confirmation Modal */}
      {showDeleteConfirmation && (
        <ConfirmationModal
          title="Delete Wallet"
          message="This will permanently delete your wallet and all associated data. This action cannot be undone."
          details="Make sure you have saved your recovery phrase before proceeding!"
          type="danger"
          confirmText="Delete Wallet"
          cancelText="Cancel"
          onConfirm={executeDelete}
          onCancel={() => setShowDeleteConfirmation(false)}
          requireTypedConfirmation="DELETE"
          confirmDelaySeconds={3}
        />
      )}

      {/* Test Recovery Modal */}
      {showTestRecovery && (
        <TestRecoveryModal
          expectedAddress={wallet.walletAddress}
          onClose={() => setShowTestRecovery(false)}
        />
      )}
    </div>
  )
}
