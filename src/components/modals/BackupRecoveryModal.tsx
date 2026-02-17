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
import { CircleCheck } from 'lucide-react'
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
          className="btn btn-primary"
          onClick={handleSelectFile}
        >
          Select Database File (.db)
        </button>

        <button
          type="button"
          className="btn btn-secondary"
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
        <span className="file-path">{selectedPath?.split(/[\\/]/).pop()}</span>
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
          className="btn btn-secondary"
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
          className="btn btn-primary"
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
          className="btn btn-secondary"
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
          className="btn btn-primary"
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
        <div className="action-card" onClick={handleRequestAddAccount} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRequestAddAccount() } }}>
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
          onKeyDown={e => { if (!sweepEstimate?.isDust && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleSweep() } }}
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
          className="btn btn-secondary"
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
          className="btn btn-secondary"
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
          className="btn btn-primary"
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
        <CircleCheck size={48} strokeWidth={1.5} color="var(--success)" />
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
        className="btn btn-primary"
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

    </Modal>
  )
}
