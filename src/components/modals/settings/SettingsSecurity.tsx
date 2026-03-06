import { useState, useCallback } from 'react'
import {
  Lock,
  FileText,
  Clock,
  ClipboardCheck,
  ChevronRight
} from 'lucide-react'
import { useWalletState, useWalletActions } from '../../../contexts'
import { useUI } from '../../../contexts/UIContext'
import { logger } from '../../../services/logger'
import { useSecurityActions } from '../../../hooks/useSecurityActions'
import { ConfirmationModal } from '../../shared/ConfirmationModal'
import { PasswordInput } from '../../shared/PasswordInput'
import { TestRecoveryModal } from '../TestRecoveryModal'
import { handleKeyDown } from './settingsKeyDown'
import { SECURITY } from '../../../config'

interface SettingsSecurityProps {
  onClose: () => void
}

export function SettingsSecurity({ onClose }: SettingsSecurityProps) {
  const { wallet, sessionPassword, autoLockMinutes } = useWalletState()
  const { setAutoLockMinutes, lockWallet, setSessionPassword } = useWalletActions()
  const { showToast } = useUI()
  const {
    isPasswordlessWallet,
    sessionNeedsExportPassword,
    exportPrivateKeys,
    enableWalletPassword,
  } = useSecurityActions()

  const [showKeysWarning, setShowKeysWarning] = useState(false)
  const [showTestRecovery, setShowTestRecovery] = useState(false)
  const [showSetPassword, setShowSetPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [setPasswordError, setSetPasswordErrorState] = useState('')
  const [settingPassword, setSettingPassword] = useState(false)
  const [showExportPasswordPrompt, setShowExportPasswordPrompt] = useState(false)
  const [exportPassword, setExportPassword] = useState('')
  const [confirmExportPassword, setConfirmExportPassword] = useState('')
  const [exportPasswordError, setExportPasswordError] = useState('')
  const isPasswordless = isPasswordlessWallet()

  const handleExportKeys = useCallback(() => {
    setShowKeysWarning(true)
  }, [])

  const executeExportKeys = useCallback(async () => {
    if (!wallet) {
      setShowKeysWarning(false)
      return
    }

    // Passwordless -- need one-time export password
    if (sessionNeedsExportPassword(sessionPassword)) {
      setShowKeysWarning(false)
      setShowExportPasswordPrompt(true)
      return
    }

    // Has password -- use sessionPassword for encryption
    try {
      await exportPrivateKeys(wallet, sessionPassword, showToast)
    } catch (err) {
      logger.error('Key export failed', err)
      showToast(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
    setShowKeysWarning(false)
  }, [wallet, sessionPassword, showToast, sessionNeedsExportPassword, exportPrivateKeys])

  const handleLockNow = useCallback(() => {
    lockWallet()
    onClose()
  }, [lockWallet, onClose])

  const handleSetPassword = useCallback(async () => {
    if (newPassword.length < SECURITY.MIN_PASSWORD_LENGTH) {
      setSetPasswordErrorState(`Password must be at least ${SECURITY.MIN_PASSWORD_LENGTH} characters`)
      return
    }
    if (newPassword !== confirmNewPassword) {
      setSetPasswordErrorState('Passwords do not match')
      return
    }
    setSettingPassword(true)
    try {
      const result = await enableWalletPassword(newPassword, setSessionPassword, setAutoLockMinutes)
      if (!result.ok) {
        setSetPasswordErrorState(result.error)
        return
      }

      showToast('Password set! Lock screen and auto-lock are now enabled.')
      setShowSetPassword(false)
      setNewPassword('')
      setConfirmNewPassword('')
    } catch (err) {
      setSetPasswordErrorState(err instanceof Error ? err.message : 'Failed to set password')
    } finally {
      setSettingPassword(false)
    }
  }, [newPassword, confirmNewPassword, showToast, setAutoLockMinutes, setSessionPassword, enableWalletPassword])

  const handleExportWithOneTimePassword = useCallback(async () => {
    if (exportPassword.length < SECURITY.MIN_PASSWORD_LENGTH) {
      setExportPasswordError(`Password must be at least ${SECURITY.MIN_PASSWORD_LENGTH} characters`)
      return
    }
    if (exportPassword !== confirmExportPassword) {
      setExportPasswordError('Passwords do not match')
      return
    }
    try {
      await exportPrivateKeys(wallet!, exportPassword, showToast)
    } catch (err) {
      logger.error('Key export failed', err)
      showToast(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
    setShowExportPasswordPrompt(false)
    setExportPassword('')
    setConfirmExportPassword('')
    setExportPasswordError('')
  }, [exportPassword, confirmExportPassword, wallet, showToast, exportPrivateKeys])

  if (!wallet) return null

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">Security</div>
        <div className="settings-card">
          {!isPasswordless && (
            <>
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
                        onChange={(e) => setAutoLockMinutes(parseInt(e.target.value, 10))}
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
            </>
          )}

          {isPasswordless && (
            <div className="settings-row" role="button" tabIndex={0}
                 onClick={() => setShowSetPassword(true)}
                 onKeyDown={handleKeyDown(() => setShowSetPassword(true))}
                 aria-label="Set wallet password">
              <div className="settings-row-left">
                <div className="settings-row-icon" aria-hidden="true"><Lock size={16} strokeWidth={1.75} /></div>
                <div className="settings-row-content">
                  <div className="settings-row-label">Set Password</div>
                  <div className="settings-row-value">Enable lock screen and encryption</div>
                </div>
              </div>
              <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
            </div>
          )}

          {wallet && (
            <>
              <div className="settings-row" aria-label="Recovery phrase display policy">
                <div className="settings-row-left">
                  <div className="settings-row-icon" aria-hidden="true"><FileText size={16} strokeWidth={1.75} /></div>
                  <div className="settings-row-content">
                    <div className="settings-row-label">Recovery Phrase</div>
                    <div className="settings-row-value">Direct display disabled for security</div>
                  </div>
                </div>
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

      {/* Set Password Modal */}
      {showSetPassword && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="set-pwd-title">
          <div className="modal-container modal-sm">
            <h3 className="modal-title" id="set-pwd-title">Set Wallet Password</h3>
            <p className="modal-text">
              This will encrypt your wallet keys and enable the lock screen.
            </p>
            <div className="form-group">
              <label className="form-label">Password</label>
              <PasswordInput
                id="set-password-input"
                value={newPassword}
                onChange={setNewPassword}
                placeholder={`At least ${SECURITY.MIN_PASSWORD_LENGTH} characters`}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <PasswordInput
                id="set-password-confirm-input"
                value={confirmNewPassword}
                onChange={setConfirmNewPassword}
                placeholder="Confirm password"
              />
            </div>
            {setPasswordError && <div className="form-error" role="alert">{setPasswordError}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => {
                setShowSetPassword(false)
                setNewPassword('')
                setConfirmNewPassword('')
                setSetPasswordErrorState('')
              }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSetPassword} disabled={settingPassword || !newPassword || !confirmNewPassword}>
                {settingPassword ? 'Setting...' : 'Set Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Password Prompt Modal */}
      {showExportPasswordPrompt && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="export-pwd-title">
          <div className="modal-container modal-sm">
            <h3 className="modal-title" id="export-pwd-title">Export Password</h3>
            <p className="modal-text">
              Enter a password to protect your exported keys. You will need this password to import them later.
            </p>
            <div className="form-group">
              <label className="form-label">Password</label>
              <PasswordInput
                id="export-password-input"
                value={exportPassword}
                onChange={setExportPassword}
                placeholder={`At least ${SECURITY.MIN_PASSWORD_LENGTH} characters`}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <PasswordInput
                id="export-password-confirm-input"
                value={confirmExportPassword}
                onChange={setConfirmExportPassword}
                placeholder="Confirm password"
              />
            </div>
            {exportPasswordError && <div className="form-error" role="alert">{exportPasswordError}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => {
                setShowExportPasswordPrompt(false)
                setExportPassword('')
                setConfirmExportPassword('')
                setExportPasswordError('')
              }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleExportWithOneTimePassword} disabled={!exportPassword || !confirmExportPassword}>
                Export Keys
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
