import { useState } from 'react'
import { PrivateKey } from '@bsv/sdk'
import { save, open } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import { useWallet } from '../../contexts/WalletContext'
import { addKnownSender, getKnownSenders, debugFindInvoiceNumber } from '../../services/keyDerivation'
import { checkForPayments, getPaymentNotifications } from '../../services/messageBox'
import { exportDatabase, importDatabase, type DatabaseBackup } from '../../services/database'

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
    copyToClipboard,
    showToast
  } = useWallet()

  // Local state for various input forms
  const [showSenderInput, setShowSenderInput] = useState(false)
  const [senderInput, setSenderInput] = useState('')

  const [showTrustedOriginInput, setShowTrustedOriginInput] = useState(false)
  const [trustedOriginInput, setTrustedOriginInput] = useState('')

  const [showDebugInput, setShowDebugInput] = useState(false)
  const [debugAddressInput, setDebugAddressInput] = useState('')
  const [debugSearching, setDebugSearching] = useState(false)
  const [debugResult, setDebugResult] = useState<string | null>(null)

  const [messageBoxStatus, setMessageBoxStatus] = useState<'idle' | 'checking' | 'error'>('idle')
  const [paymentNotifications, setPaymentNotifications] = useState(getPaymentNotifications())

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

  const handleDelete = async () => {
    if (confirm('⚠️ Delete wallet? This cannot be undone!\n\nMake sure you have your recovery phrase saved.')) {
      if (confirm('Are you really sure? All data will be lost.')) {
        await handleDeleteWallet()
        onClose()
      }
    }
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
              <div className="settings-row" onClick={() => copyToClipboard(wallet.walletAddress, 'Payment address copied!')}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true">💳</div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Payment Address</div>
                    <div className="settings-row-value">{wallet.walletAddress.slice(0, 12)}...{wallet.walletAddress.slice(-6)}</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true">📋</span>
              </div>
              <div className="settings-row" onClick={() => copyToClipboard(wallet.ordAddress, 'Ordinals address copied!')}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true">🎨</div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Ordinals Address</div>
                    <div className="settings-row-value">{wallet.ordAddress.slice(0, 12)}...{wallet.ordAddress.slice(-6)}</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true">📋</span>
              </div>
              <div className="settings-row" onClick={() => copyToClipboard(wallet.identityPubKey, 'Identity key copied!')}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true">🔑</div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Identity Key</div>
                    <div className="settings-row-value">{wallet.identityPubKey.slice(0, 12)}...{wallet.identityPubKey.slice(-6)}</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true">📋</span>
              </div>
            </div>
          </div>

          {/* TRANSACTION SECTION */}
          <div className="settings-section">
            <div className="settings-section-title">Transactions</div>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true">⛽</div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Fee Rate</div>
                    <div className="settings-row-value">
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        value={feeRateKB}
                        onChange={(e) => setFeeRate(parseInt(e.target.value) || 71)}
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
                Default: 71 sats/KB. Most miners accept 50-100. Lower = cheaper, higher = faster confirmation.
              </div>
            </div>
          </div>

          {/* SECURITY SECTION */}
          <div className="settings-section">
            <div className="settings-section-title">Security</div>
            <div className="settings-card">
              {wallet.mnemonic && (
                <div className="settings-row" onClick={handleShowMnemonic}>
                  <div className="settings-row-left">
                    <div className="settings-row-icon" aria-hidden="true">📝</div>
                    <div className="settings-row-content">
                      <div className="settings-row-label">Recovery Phrase</div>
                      <div className="settings-row-value">12 words</div>
                    </div>
                  </div>
                  <span className="settings-row-arrow" aria-hidden="true">→</span>
                </div>
              )}
              <div className="settings-row" onClick={handleExportKeys}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true">🔐</div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Export Private Keys</div>
                    <div className="settings-row-value">Copy JSON to clipboard</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true">→</span>
              </div>
            </div>
          </div>

          {/* BACKUP SECTION */}
          <div className="settings-section">
            <div className="settings-section-title">Backup</div>
            <div className="settings-card">
              <div className="settings-row" onClick={handleExportFullBackup}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true">💾</div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Export Full Backup</div>
                    <div className="settings-row-value">Wallet + transactions</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true">→</span>
              </div>
              <div className="settings-row" onClick={handleImportBackup}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true">📥</div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Import Backup</div>
                    <div className="settings-row-value">Restore from file</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true">→</span>
              </div>
            </div>
          </div>

          {/* ADVANCED SECTION */}
          <div className="settings-section">
            <div className="settings-section-title">Advanced</div>
            <div className="settings-card">
              <div className="settings-row" onClick={handleResetAndResync}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true">🔄</div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Reset & Resync</div>
                    <div className="settings-row-value">Clear UTXOs and sync fresh</div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true">→</span>
              </div>
              <div className="settings-row" onClick={handleCheckMessageBox}>
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true">
                    {messageBoxStatus === 'checking' ? '🔄' : '📬'}
                  </div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">MessageBox (BRC-29)</div>
                    <div className="settings-row-value">
                      {paymentNotifications.length} payment{paymentNotifications.length !== 1 ? 's' : ''} received
                    </div>
                  </div>
                </div>
                <span className="settings-row-arrow" aria-hidden="true">↻</span>
              </div>

              {/* Known Senders */}
              {!showSenderInput ? (
                <div className="settings-row" onClick={() => setShowSenderInput(true)}>
                  <div className="settings-row-left">
                    <div className="settings-row-icon" aria-hidden="true">👥</div>
                    <div className="settings-row-content">
                      <div className="settings-row-label">Known Senders (BRC-42/43)</div>
                      <div className="settings-row-value">{getKnownSenders().length} configured</div>
                    </div>
                  </div>
                  <span className="settings-row-arrow" aria-hidden="true">+</span>
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
                    <div className="settings-row-icon" aria-hidden="true">🔍</div>
                    <div className="settings-row-content">
                      <div className="settings-row-label">Debug Invoice Finder</div>
                      <div className="settings-row-value">Search derived addresses</div>
                    </div>
                  </div>
                  <span className="settings-row-arrow" aria-hidden="true">→</span>
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
                    <div className="settings-row-icon" aria-hidden="true">🤖</div>
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
                    <div className="settings-row-icon" aria-hidden="true">➕</div>
                    <div className="settings-row-content">
                      <div className="settings-row-label">Add Trusted Origin</div>
                      <div className="settings-row-value">e.g., "ai-agent", "wrootz"</div>
                    </div>
                  </div>
                  <span className="settings-row-arrow" aria-hidden="true">+</span>
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
                      <div className="settings-row-icon" aria-hidden="true">🔗</div>
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
            <button className="btn btn-danger" onClick={handleDelete}>
              Delete Wallet
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
