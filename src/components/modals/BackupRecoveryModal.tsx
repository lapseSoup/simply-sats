/**
 * Backup Recovery Modal
 *
 * Allows users to recover accounts from old Simply Sats backups.
 * Supports two recovery options:
 * - Add as Account: Import the recovered account to current wallet
 * - Sweep Funds: Transfer all funds to current wallet address
 */

import { useState, useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { Modal } from '../shared/Modal'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import {
  readExternalDatabase,
  readBackupFolder,
  decryptAllAccounts,
  fetchAllBalances,
  calculateSweepEstimate,
  addRecoveredAccount,
  executeSweep,
  type RecoveredAccount,
  type SweepEstimate
} from '../../services/backupRecovery'

// ============================================
// Types
// ============================================

type ModalStep = 'select_file' | 'enter_password' | 'account_list' | 'action_select' | 'enter_current_password' | 'result'

interface BackupRecoveryModalProps {
  onClose: () => void
}

// ============================================
// Component
// ============================================

export function BackupRecoveryModal({ onClose }: BackupRecoveryModalProps) {
  const { wallet, refreshAccounts } = useWallet()
  const { showToast } = useUI()

  // Modal state
  const [step, setStep] = useState<ModalStep>('select_file')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // File selection state
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  // Password state
  const [backupPassword, setBackupPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [pendingAction, setPendingAction] = useState<'add' | 'sweep' | null>(null)

  // Account state
  const [accounts, setAccounts] = useState<RecoveredAccount[]>([])
  const [selectedAccountIndex, setSelectedAccountIndex] = useState(0)

  // Action result state
  const [resultMessage, setResultMessage] = useState('')
  const [resultTxid, setResultTxid] = useState<string | null>(null)

  // ============================================
  // Handlers
  // ============================================

  const handleSelectFile = useCallback(async () => {
    try {
      const filePath = await open({
        multiple: false
        // Don't set directory at all - let it default to file selection
      })

      if (!filePath || Array.isArray(filePath)) return

      // Validate file extension
      if (!filePath.toLowerCase().endsWith('.db')) {
        setError('Please select a .db database file')
        return
      }

      setSelectedPath(filePath)
      setError('')
      setStep('enter_password')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select file')
    }
  }, [])

  const handleSelectFolder = useCallback(async () => {
    try {
      const folderPath = await open({
        directory: true,
        multiple: false
      })

      if (!folderPath || Array.isArray(folderPath)) return

      setSelectedPath(folderPath)
      setError('')
      setStep('enter_password')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select folder')
    }
  }, [])

  const handleDecrypt = useCallback(async () => {
    if (!selectedPath || !backupPassword) return

    setLoading(true)
    setError('')

    try {
      // Read accounts from database
      const isFolder = !selectedPath.endsWith('.db')
      const rawAccounts = isFolder
        ? await readBackupFolder(selectedPath)
        : await readExternalDatabase(selectedPath)

      // Decrypt all accounts with the password
      const decryptedAccounts = await decryptAllAccounts(rawAccounts, backupPassword)

      // Fetch live balances from blockchain
      const accountsWithBalances = await fetchAllBalances(decryptedAccounts)

      setAccounts(accountsWithBalances)
      setStep('account_list')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to decrypt backup'
      if (message.includes('Decryption failed')) {
        setError('Incorrect password. Please try again.')
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }, [selectedPath, backupPassword])

  const handleRequestAddAccount = useCallback(() => {
    setPendingAction('add')
    setCurrentPassword('')
    setError('')
    setStep('enter_current_password')
  }, [])

  const handleAddAccount = useCallback(async () => {
    const account = accounts[selectedAccountIndex]
    if (!account?.decryptedKeys || !currentPassword) {
      setError('Unable to add account. Please enter your wallet password.')
      return
    }

    setLoading(true)
    setError('')

    try {
      await addRecoveredAccount(
        account.decryptedKeys,
        account.name,
        currentPassword
      )

      // Refresh the accounts list so the new account appears
      await refreshAccounts()

      setResultMessage(`Account "${account.name}" has been added to your wallet. You can now switch to it from the account menu.`)
      setStep('result')
      showToast('Account imported successfully!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add account')
    } finally {
      setLoading(false)
    }
  }, [accounts, selectedAccountIndex, currentPassword, showToast, refreshAccounts])

  const handleSweep = useCallback(async () => {
    const account = accounts[selectedAccountIndex]
    if (!account?.decryptedKeys || !account.liveUtxos || !wallet?.walletAddress) {
      setError('Unable to sweep. Missing required data.')
      return
    }

    const estimate = calculateSweepEstimate(account.liveUtxos)
    if (estimate.isDust) {
      setError('Balance too small to sweep (would be consumed by fees)')
      return
    }

    setLoading(true)
    setError('')

    try {
      const txid = await executeSweep(
        account.decryptedKeys,
        wallet.walletAddress,
        account.liveUtxos
      )

      setResultTxid(txid)
      setResultMessage(`Successfully swept ${estimate.netSats.toLocaleString()} sats to your wallet.`)
      setStep('result')
      showToast('Funds swept successfully!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sweep funds')
    } finally {
      setLoading(false)
    }
  }, [accounts, selectedAccountIndex, wallet?.walletAddress, showToast])

  // ============================================
  // Computed Values
  // ============================================

  const selectedAccount = accounts[selectedAccountIndex]
  const sweepEstimate: SweepEstimate | null = selectedAccount?.liveUtxos
    ? calculateSweepEstimate(selectedAccount.liveUtxos)
    : null

  // ============================================
  // Render Functions
  // ============================================

  const renderSelectFile = () => (
    <div className="backup-recovery-content">
      <p className="modal-description">
        Select a backup file or folder from a previous Simply Sats installation.
      </p>

      <div className="file-select-buttons">
        <button
          type="button"
          className="primary-button"
          onClick={handleSelectFile}
        >
          Select Database File (.db)
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={handleSelectFolder}
        >
          Select .wallet Folder
        </button>
      </div>

      {error && <p className="error-message">{error}</p>}
    </div>
  )

  const renderEnterPassword = () => (
    <div className="backup-recovery-content">
      <p className="modal-description">
        Enter the password you used for this backup.
      </p>

      <div className="selected-file">
        <span className="file-label">Selected:</span>
        <span className="file-path">{selectedPath?.split('/').pop()}</span>
      </div>

      <div className="form-group">
        <label htmlFor="backup-password">Backup Password</label>
        <input
          id="backup-password"
          type="password"
          value={backupPassword}
          onChange={e => setBackupPassword(e.target.value)}
          placeholder="Enter backup password"
          disabled={loading}
          autoFocus
        />
      </div>

      {error && <p className="error-message">{error}</p>}

      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setSelectedPath(null)
            setBackupPassword('')
            setError('')
            setStep('select_file')
          }}
        >
          Back
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={handleDecrypt}
          disabled={loading || !backupPassword}
        >
          {loading ? 'Decrypting...' : 'Decrypt'}
        </button>
      </div>
    </div>
  )

  const renderAccountList = () => (
    <div className="backup-recovery-content">
      <p className="modal-description">
        Found {accounts.length} account{accounts.length !== 1 ? 's' : ''} in backup.
        Select one to recover.
      </p>

      <div className="account-list">
        {accounts.map((account, index) => (
          <div
            key={account.id}
            className={`account-card ${selectedAccountIndex === index ? 'selected' : ''}`}
            onClick={() => setSelectedAccountIndex(index)}
            role="button"
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                setSelectedAccountIndex(index)
              }
            }}
          >
            <div className="account-name">{account.name}</div>
            <div className="account-address">
              {account.identityAddress.slice(0, 8)}...{account.identityAddress.slice(-6)}
            </div>
            <div className="account-balance">
              {account.liveBalance !== undefined
                ? `${account.liveBalance.toLocaleString()} sats`
                : 'Loading...'}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="error-message">{error}</p>}

      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setAccounts([])
            setBackupPassword('')
            setStep('enter_password')
          }}
        >
          Back
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => setStep('action_select')}
          disabled={accounts.length === 0}
        >
          Continue
        </button>
      </div>
    </div>
  )

  const renderActionSelect = () => (
    <div className="backup-recovery-content">
      <div className="selected-account-summary">
        <h4>{selectedAccount?.name}</h4>
        <p className="balance-large">
          {selectedAccount?.liveBalance?.toLocaleString() ?? 0} sats
        </p>
      </div>

      <div className="action-options">
        <div className="action-card" onClick={handleRequestAddAccount} role="button" tabIndex={0}>
          <div className="action-icon">+</div>
          <div className="action-content">
            <div className="action-title">Add as Account</div>
            <div className="action-description">
              Import this account to your wallet. You can switch to it anytime.
            </div>
          </div>
        </div>

        <div
          className={`action-card ${sweepEstimate?.isDust ? 'disabled' : ''}`}
          onClick={sweepEstimate?.isDust ? undefined : handleSweep}
          role="button"
          tabIndex={sweepEstimate?.isDust ? -1 : 0}
        >
          <div className="action-icon">{'>'}</div>
          <div className="action-content">
            <div className="action-title">Sweep to Wallet</div>
            <div className="action-description">
              {sweepEstimate?.isDust ? (
                'Balance too small to sweep'
              ) : sweepEstimate ? (
                <>
                  Send {sweepEstimate.netSats.toLocaleString()} sats to your current wallet.
                  <span className="fee-info">Fee: {sweepEstimate.fee} sats</span>
                </>
              ) : (
                'No balance to sweep'
              )}
            </div>
          </div>
        </div>
      </div>

      {error && <p className="error-message">{error}</p>}
      {loading && <p className="loading-message">Processing...</p>}

      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => setStep('account_list')}
          disabled={loading}
        >
          Back
        </button>
      </div>
    </div>
  )

  const renderEnterCurrentPassword = () => (
    <div className="backup-recovery-content">
      <p className="modal-description">
        Enter your current wallet password to {pendingAction === 'add' ? 'add this account' : 'proceed'}.
      </p>

      <div className="form-group">
        <label htmlFor="current-password">Current Wallet Password</label>
        <input
          id="current-password"
          type="password"
          value={currentPassword}
          onChange={e => setCurrentPassword(e.target.value)}
          placeholder="Enter your wallet password"
          disabled={loading}
          autoFocus
        />
      </div>

      {error && <p className="error-message">{error}</p>}

      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setCurrentPassword('')
            setError('')
            setStep('action_select')
          }}
          disabled={loading}
        >
          Back
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={handleAddAccount}
          disabled={loading || !currentPassword}
        >
          {loading ? 'Adding...' : 'Add Account'}
        </button>
      </div>
    </div>
  )

  const renderResult = () => (
    <div className="backup-recovery-content">
      <div className="success-icon">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="22" stroke="#22c55e" strokeWidth="4" />
          <path d="M14 24L21 31L34 18" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <h3>Success!</h3>
      <p className="modal-description">{resultMessage}</p>

      {resultTxid && (
        <div className="txid-display">
          <span className="txid-label">Transaction ID:</span>
          <code className="txid-value">{resultTxid.slice(0, 16)}...{resultTxid.slice(-8)}</code>
        </div>
      )}

      <button
        type="button"
        className="primary-button"
        onClick={onClose}
      >
        Done
      </button>
    </div>
  )

  // ============================================
  // Main Render
  // ============================================

  return (
    <Modal onClose={onClose} title="Recover from Backup">
      {step === 'select_file' && renderSelectFile()}
      {step === 'enter_password' && renderEnterPassword()}
      {step === 'account_list' && renderAccountList()}
      {step === 'action_select' && renderActionSelect()}
      {step === 'enter_current_password' && renderEnterCurrentPassword()}
      {step === 'result' && renderResult()}

      <style>{`
        .backup-recovery-content {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 0.5rem 0;
        }

        .modal-description {
          color: var(--text-secondary);
          font-size: 0.875rem;
          margin: 0;
        }

        .file-select-buttons {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .selected-file {
          background: var(--surface);
          border-radius: 8px;
          padding: 0.75rem;
          display: flex;
          gap: 0.5rem;
          font-size: 0.875rem;
        }

        .file-label {
          color: var(--text-secondary);
        }

        .file-path {
          color: var(--text-primary);
          font-family: monospace;
          word-break: break-all;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .form-group label {
          font-size: 0.875rem;
          color: var(--text-secondary);
        }

        .form-group input {
          padding: 0.75rem;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text-primary);
          font-size: 1rem;
        }

        .form-group input:focus {
          outline: none;
          border-color: var(--primary);
        }

        .button-row {
          display: flex;
          gap: 0.75rem;
          margin-top: 0.5rem;
        }

        .button-row button {
          flex: 1;
        }

        .primary-button, .secondary-button {
          padding: 0.75rem 1rem;
          border-radius: 8px;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: opacity 0.15s;
        }

        .primary-button {
          background: var(--primary);
          color: white;
          border: none;
        }

        .primary-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .secondary-button {
          background: transparent;
          color: var(--text-primary);
          border: 1px solid var(--border);
        }

        .account-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          max-height: 250px;
          overflow-y: auto;
        }

        .account-card {
          background: var(--surface);
          border: 2px solid var(--border);
          border-radius: 8px;
          padding: 0.75rem;
          cursor: pointer;
          transition: border-color 0.15s;
        }

        .account-card:hover {
          border-color: var(--text-secondary);
        }

        .account-card.selected {
          border-color: var(--primary);
          background: var(--surface-hover);
        }

        .account-name {
          font-weight: 500;
          color: var(--text-primary);
        }

        .account-address {
          font-size: 0.75rem;
          color: var(--text-secondary);
          font-family: monospace;
          margin-top: 0.25rem;
        }

        .account-balance {
          font-size: 0.875rem;
          color: var(--primary);
          margin-top: 0.5rem;
        }

        .selected-account-summary {
          text-align: center;
          padding: 1rem;
          background: var(--surface);
          border-radius: 8px;
        }

        .selected-account-summary h4 {
          margin: 0 0 0.5rem;
          color: var(--text-primary);
        }

        .balance-large {
          font-size: 1.5rem;
          font-weight: 600;
          color: var(--primary);
          margin: 0;
        }

        .action-options {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .action-card {
          display: flex;
          gap: 1rem;
          padding: 1rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s;
        }

        .action-card:hover:not(.disabled) {
          border-color: var(--primary);
          background: var(--surface-hover);
        }

        .action-card.disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .action-icon {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--primary);
          color: white;
          border-radius: 8px;
          font-size: 1.25rem;
          font-weight: bold;
          flex-shrink: 0;
        }

        .action-content {
          flex: 1;
        }

        .action-title {
          font-weight: 500;
          color: var(--text-primary);
          margin-bottom: 0.25rem;
        }

        .action-description {
          font-size: 0.875rem;
          color: var(--text-secondary);
        }

        .fee-info {
          display: block;
          font-size: 0.75rem;
          color: var(--text-tertiary);
          margin-top: 0.25rem;
        }

        .error-message {
          color: var(--error);
          font-size: 0.875rem;
          margin: 0;
          padding: 0.5rem;
          background: var(--error-bg, rgba(239, 68, 68, 0.1));
          border-radius: 4px;
        }

        .loading-message {
          color: var(--text-secondary);
          font-size: 0.875rem;
          text-align: center;
        }

        .success-icon {
          display: flex;
          justify-content: center;
          margin-bottom: 0.5rem;
        }

        .success-icon + h3 {
          text-align: center;
          margin: 0 0 0.5rem;
          color: var(--text-primary);
        }

        .txid-display {
          background: var(--surface);
          border-radius: 8px;
          padding: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .txid-label {
          font-size: 0.75rem;
          color: var(--text-secondary);
        }

        .txid-value {
          font-size: 0.875rem;
          color: var(--text-primary);
          font-family: monospace;
          word-break: break-all;
        }
      `}</style>
    </Modal>
  )
}
