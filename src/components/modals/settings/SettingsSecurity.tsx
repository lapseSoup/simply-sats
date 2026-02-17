import { useState, useCallback, useEffect } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import {
  Lock,
  FileText,
  Clock,
  ClipboardCheck,
  ChevronRight
} from 'lucide-react'
import { useWallet } from '../../../contexts/WalletContext'
import { useUI } from '../../../contexts/UIContext'
import { encrypt } from '../../../services/crypto'
import { ConfirmationModal } from '../../shared/ConfirmationModal'
import { TestRecoveryModal } from '../TestRecoveryModal'
import { handleKeyDown } from './settingsKeyDown'
import { SECURITY } from '../../../config'

interface SettingsSecurityProps {
  onClose: () => void
}

export function SettingsSecurity({ onClose }: SettingsSecurityProps) {
  const {
    wallet,
    sessionPassword,
    autoLockMinutes,
    setAutoLockMinutes,
    lockWallet
  } = useWallet()
  const { showToast } = useUI()

  const [showKeysWarning, setShowKeysWarning] = useState(false)
  const [showMnemonicWarning, setShowMnemonicWarning] = useState(false)
  const [mnemonicToShow, setMnemonicToShow] = useState<string | null>(null)
  const [showTestRecovery, setShowTestRecovery] = useState(false)

  // Auto-clear mnemonic from memory after 60 seconds (security)
  useEffect(() => {
    if (!mnemonicToShow) return
    const timer = setTimeout(() => {
      setMnemonicToShow(null)
    }, SECURITY.MNEMONIC_AUTO_CLEAR_MS)
    return () => clearTimeout(timer)
  }, [mnemonicToShow])

  const handleExportKeys = useCallback(() => {
    setShowKeysWarning(true)
  }, [])

  const executeExportKeys = useCallback(async () => {
    if (!wallet || sessionPassword === null) {
      showToast('Session password not available \u2014 try locking and unlocking first', 'warning')
      setShowKeysWarning(false)
      return
    }
    try {
      // Retrieve WIFs from key store for export
      const { getWifForOperation } = await import('../../../services/wallet')
      const identityWif = await getWifForOperation('identity', 'exportKeys', wallet)
      const walletWif = await getWifForOperation('wallet', 'exportKeys', wallet)
      const ordWif = await getWifForOperation('ordinals', 'exportKeys', wallet)

      // Fetch mnemonic from Rust key store for export (doesn't clear it)
      const mnemonic = await invoke<string | null>('get_mnemonic')

      const keyData = {
        format: 'simply-sats',
        version: 1,
        mnemonic: mnemonic || null,
        keys: {
          identity: { wif: identityWif, pubKey: wallet.identityPubKey },
          payment: { wif: walletWif, address: wallet.walletAddress },
          ordinals: { wif: ordWif, address: wallet.ordAddress }
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
      showToast(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
    setShowKeysWarning(false)
  }, [wallet, sessionPassword, showToast])

  const handleShowMnemonic = useCallback(() => {
    setShowMnemonicWarning(true)
  }, [])

  const executeShowMnemonic = useCallback(async () => {
    setShowMnemonicWarning(false)
    try {
      // Fetch mnemonic once from Rust key store (auto-clears after retrieval)
      const mnemonic = await invoke<string | null>('get_mnemonic_once')
      if (mnemonic) {
        setMnemonicToShow(mnemonic)
      } else {
        showToast('Mnemonic not available — wallet may have been imported without one', 'warning')
      }
    } catch (err) {
      console.error('Failed to retrieve mnemonic:', err)
      showToast('Failed to retrieve recovery phrase', 'error')
    }
  }, [showToast])

  const handleLockNow = useCallback(() => {
    lockWallet()
    onClose()
  }, [lockWallet, onClose])

  if (!wallet) return null

  return (
    <>
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
          <div className="settings-row" role="button" tabIndex={0} onClick={handleLockNow} onKeyDown={handleKeyDown(handleLockNow)} aria-label="Lock wallet now">
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

          {/* Show recovery phrase option — mnemonic fetched on-demand from Rust key store */}
          {wallet && (
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

      {/* Test Recovery Modal */}
      {showTestRecovery && (
        <TestRecoveryModal
          expectedAddress={wallet.walletAddress}
          onClose={() => setShowTestRecovery(false)}
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
    </>
  )
}
