import { useState, type KeyboardEvent } from 'react'
import { PrivateKey } from '@bsv/sdk'
import { save, open } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import {
  Wallet,
  Palette,
  KeyRound,
  Fuel,
  FileText,
  Lock,
  Save,
  Download,
  RefreshCw,
  Users,
  Search,
  Bot,
  Plus,
  Link2,
  Copy,
  ChevronRight,
  Clock,
  ClipboardCheck
} from 'lucide-react'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'

// Helper for keyboard accessibility on clickable divs
const handleKeyDown = (handler: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    handler()
  }
}
import { addKnownSender, getKnownSenders, debugFindInvoiceNumber } from '../../services/keyDerivation'
import { checkForPayments, getPaymentNotifications } from '../../services/messageBox'
import { exportDatabase, importDatabase, type DatabaseBackup } from '../../services/database'
import { encrypt, decrypt, type EncryptedData } from '../../services/crypto'
import { Modal } from '../shared/Modal'
import { ConfirmationModal } from '../shared/ConfirmationModal'
import { TestRecoveryModal } from './TestRecoveryModal'
import { BackupRecoveryModal } from './BackupRecoveryModal'
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
    sessionPassword,
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
  const [showBackupRecovery, setShowBackupRecovery] = useState(false)
  const [showImportConfirm, setShowImportConfirm] = useState<{ utxos: number; transactions: number } | null>(null)
  const [showKeysWarning, setShowKeysWarning] = useState(false)
  const [showMnemonicWarning, setShowMnemonicWarning] = useState(false)
  const [showResyncConfirm, setShowResyncConfirm] = useState(false)
  const [mnemonicToShow, setMnemonicToShow] = useState<string | null>(null)
  const [pendingImportBackup, setPendingImportBackup] = useState<DatabaseBackup | null>(null)

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
    if (!sessionPassword) {
      showToast('Session password not available — try locking and unlocking first')
      return
    }
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
      const encrypted = await encrypt(JSON.stringify(fullBackup), sessionPassword)
      const encryptedBackup = {
        format: 'simply-sats-backup-encrypted',
        version: 1,
        encrypted
      }
      const backupJson = JSON.stringify(encryptedBackup, null, 2)
      const filePath = await save({
        defaultPath: `simply-sats-backup-${new Date().toISOString().split('T')[0]}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (filePath) {
        await writeTextFile(filePath, backupJson)
        showToast('Encrypted backup saved!')
      }
    } catch (err) {
      console.error('Backup failed:', err)
      showToast(`Backup failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
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
      const raw = JSON.parse(json)

      let backup
      if (raw.format === 'simply-sats-backup-encrypted' && raw.encrypted) {
        // Encrypted backup — decrypt with session password
        if (!sessionPassword) {
          showToast('Session password not available — try locking and unlocking first')
          return
        }
        try {
          const decrypted = await decrypt(raw.encrypted as EncryptedData, sessionPassword)
          backup = JSON.parse(decrypted)
        } catch {
          showToast('Failed to decrypt backup — wrong password?')
          return
        }
      } else {
        backup = raw
      }

      if (backup.format !== 'simply-sats-full' || !backup.database) {
        showToast('Invalid backup format')
        return
      }
      setPendingImportBackup(backup.database as DatabaseBackup)
      setShowImportConfirm({ utxos: backup.database.utxos.length, transactions: backup.database.transactions.length })
    } catch (err) {
      console.error('Import failed:', err)
      showToast(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const executeImportBackup = async () => {
    if (pendingImportBackup) {
      await importDatabase(pendingImportBackup)
      showToast('Backup imported!')
      performSync(false)
      setPendingImportBackup(null)
    }
    setShowImportConfirm(null)
  }

  const handleExportKeys = () => {
    setShowKeysWarning(true)
  }

  const executeExportKeys = async () => {
    if (!sessionPassword) {
      showToast('Session password not available — try locking and unlocking first')
      setShowKeysWarning(false)
      return
    }
    try {
      const keyData = {
        format: 'simply-sats',
        version: 1,
        mnemonic: wallet.mnemonic || null,
        keys: {
          identity: { wif: wallet.identityWif, pubKey: wallet.identityPubKey },
          payment: { wif: wallet.walletWif, address: wallet.walletAddress },
          ordinals: { wif: wallet.ordWif, address: wallet.ordAddress }
        }
      }
      const encrypted = await encrypt(JSON.stringify(keyData), sessionPassword)
      const encryptedExport = {
        format: 'simply-sats-keys-encrypted',
        version: 1,
        encrypted
      }
      const filePath = await save({
        defaultPath: `simply-sats-keys-${new Date().toISOString().split('T')[0]}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (filePath) {
        await writeTextFile(filePath, JSON.stringify(encryptedExport, null, 2))
        showToast('Encrypted keys saved to file!')
      }
    } catch (err) {
      console.error('Key export failed:', err)
      showToast(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
    setShowKeysWarning(false)
  }

  const handleShowMnemonic = () => {
    if (wallet.mnemonic) {
      setShowMnemonicWarning(true)
    }
  }

  const executeShowMnemonic = () => {
    setShowMnemonicWarning(false)
    if (wallet.mnemonic) {
      setMnemonicToShow(wallet.mnemonic)
    }
  }

  const handleResetAndResync = () => {
    setShowResyncConfirm(true)
  }

  const executeResetAndResync = async () => {
    setShowResyncConfirm(false)
    showToast('Resetting...')
    await performSync(false, true)
    showToast('Reset complete!')
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
    <>
    <Modal onClose={onClose} title="Settings">
      <div className="modal-content">
          {/* WALLET SECTION */}
          <div className="settings-section">
            <div className="settings-section-title">Wallet</div>
            <div className="settings-card">
              <div className="settings-row" role="button" tabIndex={0} onClick={() => wallet?.walletAddress && copyToClipboard(wallet.walletAddress, 'Payment address copied!')} onKeyDown={handleKeyDown(() => wallet?.walletAddress && copyToClipboard(wallet.walletAddress, 'Payment address copied!'))} aria-label="Copy payment address">
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><Wallet size={16} strokeWidth={1.75} /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Payment Address</div>
                    <div className="settings-row-value">{wallet?.walletAddress ? `${wallet.walletAddress.slice(0, 12)}...${wallet.walletAddress.slice(-6)}` : '—'}</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><Copy size={16} strokeWidth={1.75} /></span>
              </div>
              <div className="settings-row" role="button" tabIndex={0} onClick={() => wallet?.ordAddress && copyToClipboard(wallet.ordAddress, 'Ordinals address copied!')} onKeyDown={handleKeyDown(() => wallet?.ordAddress && copyToClipboard(wallet.ordAddress, 'Ordinals address copied!'))} aria-label="Copy ordinals address">
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><Palette size={16} strokeWidth={1.75} /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Ordinals Address</div>
                    <div className="settings-row-value">{wallet?.ordAddress ? `${wallet.ordAddress.slice(0, 12)}...${wallet.ordAddress.slice(-6)}` : '—'}</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><Copy size={16} strokeWidth={1.75} /></span>
              </div>
              <div className="settings-row" role="button" tabIndex={0} onClick={() => wallet?.identityPubKey && copyToClipboard(wallet.identityPubKey, 'Identity key copied!')} onKeyDown={handleKeyDown(() => wallet?.identityPubKey && copyToClipboard(wallet.identityPubKey, 'Identity key copied!'))} aria-label="Copy identity key">
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><KeyRound size={16} strokeWidth={1.75} /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Identity Key</div>
                    <div className="settings-row-value">{wallet?.identityPubKey ? `${wallet.identityPubKey.slice(0, 12)}...${wallet.identityPubKey.slice(-6)}` : '—'}</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><Copy size={16} strokeWidth={1.75} /></span>
              </div>
            </div>
          </div>

          {/* TRANSACTION SECTION */}
          <div className="settings-section">
            <div className="settings-section-title">Transactions</div>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><Fuel size={16} strokeWidth={1.75} /></div>
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
                    <Clock size={16} strokeWidth={1.75} />
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
              <div className="settings-row" role="button" tabIndex={0} onClick={() => { lockWallet(); onClose(); }} onKeyDown={handleKeyDown(() => { lockWallet(); onClose(); })} aria-label="Lock wallet now">
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true">
                    <Lock size={16} strokeWidth={1.75} />
                  </div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Lock Wallet Now</div>
                    <div className="settings-row-value">Require password to unlock</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
              </div>

              {wallet.mnemonic && (
                <>
                  <div className="settings-row" role="button" tabIndex={0} onClick={handleShowMnemonic} onKeyDown={handleKeyDown(handleShowMnemonic)} aria-label="View recovery phrase">
                    <div className="settings-row-left">
                      <div className="settings-row-icon" aria-hidden="true"><FileText size={16} strokeWidth={1.75} /></div>
                      <div className="settings-row-content">
                        <div className="settings-row-label">Recovery Phrase</div>
                        <div className="settings-row-value">12 words</div>
                      </div>
                    </div>
                    <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
                  </div>
                  <div className="settings-row" role="button" tabIndex={0} onClick={() => setShowTestRecovery(true)} onKeyDown={handleKeyDown(() => setShowTestRecovery(true))} aria-label="Test recovery phrase">
                    <div className="settings-row-left">
                      <div className="settings-row-icon" aria-hidden="true">
                        <ClipboardCheck size={16} strokeWidth={1.75} />
                      </div>
                      <div className="settings-row-content">
                        <div className="settings-row-label">Test Recovery</div>
                        <div className="settings-row-value">Verify backup works</div>
                      </div>
                    </div>
                    <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
                  </div>
                </>
              )}
              <div className="settings-row" role="button" tabIndex={0} onClick={handleExportKeys} onKeyDown={handleKeyDown(handleExportKeys)} aria-label="Export private keys">
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><Lock size={16} strokeWidth={1.75} /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Export Private Keys</div>
                    <div className="settings-row-value">Save encrypted file</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
              </div>
            </div>
          </div>

          {/* BACKUP SECTION */}
          <div className="settings-section">
            <div className="settings-section-title">Backup</div>
            <div className="settings-card">
              <div className="settings-row" role="button" tabIndex={0} onClick={handleExportFullBackup} onKeyDown={handleKeyDown(handleExportFullBackup)} aria-label="Export full backup">
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><Save size={16} strokeWidth={1.75} /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Export Full Backup</div>
                    <div className="settings-row-value">Wallet + transactions</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
              </div>
              <div className="settings-row" role="button" tabIndex={0} onClick={handleImportBackup} onKeyDown={handleKeyDown(handleImportBackup)} aria-label="Import backup">
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><Download size={16} strokeWidth={1.75} /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Import Backup</div>
                    <div className="settings-row-value">Restore from file</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
              </div>
              <div className="settings-row" role="button" tabIndex={0} onClick={() => setShowBackupRecovery(true)} onKeyDown={handleKeyDown(() => setShowBackupRecovery(true))} aria-label="Recover from backup">
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><Download size={16} strokeWidth={1.75} /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Recover from Backup</div>
                    <div className="settings-row-value">Import old wallet accounts</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
              </div>
            </div>
          </div>

          {/* ADVANCED SECTION */}
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
                    <div className="settings-row-icon" aria-hidden="true"><Bot size={16} strokeWidth={1.75} /></div>
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
                <div className="settings-row" role="button" tabIndex={0} onClick={() => setShowTrustedOriginInput(true)} onKeyDown={handleKeyDown(() => setShowTrustedOriginInput(true))} aria-label="Add trusted origin">
                  <div className="settings-row-left">
                    <div className="settings-row-icon" aria-hidden="true"><Plus size={16} strokeWidth={1.75} /></div>
                    <div className="settings-row-content">
                      <div className="settings-row-label">Add Trusted Origin</div>
                      <div className="settings-row-value">e.g., "ai-agent", "wrootz"</div>
                    </div>
                  </div>
                  <span className="settings-row-arrow" aria-hidden="true"><Plus size={16} strokeWidth={1.75} /></span>
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
                      <div className="settings-row-icon" aria-hidden="true"><Link2 size={16} strokeWidth={1.75} /></div>
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
      </Modal>

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

      {/* Backup Recovery Modal */}
      {showBackupRecovery && (
        <BackupRecoveryModal
          onClose={() => setShowBackupRecovery(false)}
        />
      )}

      {/* Import Backup Confirmation */}
      {showImportConfirm && (
        <ConfirmationModal
          title="Import Backup"
          message={`Import ${showImportConfirm.utxos} UTXOs and ${showImportConfirm.transactions} transactions?`}
          type="info"
          confirmText="Import"
          cancelText="Cancel"
          onConfirm={executeImportBackup}
          onCancel={() => { setShowImportConfirm(null); setPendingImportBackup(null) }}
        />
      )}

      {/* Export Keys Warning */}
      {showKeysWarning && (
        <ConfirmationModal
          title="Export Private Keys"
          message="Your private keys will be saved to an encrypted file. The file is encrypted with your wallet password."
          type="danger"
          confirmText="Export Keys"
          cancelText="Cancel"
          onConfirm={executeExportKeys}
          onCancel={() => setShowKeysWarning(false)}
        />
      )}

      {/* Show Mnemonic Warning */}
      {showMnemonicWarning && (
        <ConfirmationModal
          title="View Recovery Phrase"
          message="Make sure no one can see your screen! Your recovery phrase gives full access to your wallet."
          type="warning"
          confirmText="Show Phrase"
          cancelText="Cancel"
          onConfirm={executeShowMnemonic}
          onCancel={() => setShowMnemonicWarning(false)}
        />
      )}

      {/* Mnemonic Display Modal */}
      {mnemonicToShow && (
        <ConfirmationModal
          title="Recovery Phrase"
          message="Write these 12 words down and store them safely. Never share them!"
          details={mnemonicToShow}
          type="warning"
          confirmText="Done"
          cancelText=""
          onConfirm={() => setMnemonicToShow(null)}
          onCancel={() => setMnemonicToShow(null)}
        />
      )}

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
