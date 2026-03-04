import { useState, useCallback } from 'react'
import { AlertCircle, X } from 'lucide-react'
import './App.css'

import { useWallet, useUI, useModal } from './contexts'
import { useSyncStatus } from './contexts/NetworkContext'
import { Toast, PaymentAlert, SkipLink, ErrorBoundary, SimplySatsLogo } from './components/shared'
import { useKeyboardNav, useBrc100Handler } from './hooks'
import { Header, BalanceDisplay, QuickActions } from './components/wallet'
import { RestoreModal, MnemonicModal, LockScreenModal, BackupVerificationModal } from './components/modals'
import { FEATURES } from './config'
import { OnboardingFlow } from './components/onboarding'
import { AppProviders } from './AppProviders'
import { AppModals } from './AppModals'
import { AppTabNav, AppTabContent, type Tab } from './AppTabs'
import { useCheckSync } from './hooks/useCheckSync'
import { usePaymentListener } from './hooks/usePaymentListener'
import { useMnemonicAutoClear } from './hooks/useMnemonicAutoClear'
import { useUnlockHandler } from './hooks/useUnlockHandler'
import { logger } from './services/logger'

// Tab order for keyboard navigation
const TAB_ORDER: Tab[] = ['activity', 'ordinals', 'tokens', 'locks', 'search']

/** Exported for use by the Chrome extension popup (which wraps its own providers) */
export function WalletApp() {
  // App.tsx is the top-level orchestrator and legitimately needs both wallet state
  // and actions for lifecycle management, routing, and modal control. useWallet()
  // is the intentional exception; all other components use useWalletState/useWalletActions.
  const {
    wallet,
    loading,
    txHistory,
    ordinals,
    locks,
    networkInfo,
    handleUnlock,
    handleCreateWallet,
    performSync,
    fetchDataFromDB,
    fetchData,
    isLocked,
    unlockWallet,
    tokenBalances,
    refreshTokens,
    accounts,
    activeAccount,
    activeAccountId,
    createNewAccount,
    importAccount,
    deleteAccount,
    renameAccount,
    syncError,
    consumePendingDiscovery,
    peekPendingDiscovery,
    clearPendingDiscovery,
    refreshAccounts
  } = useWallet()

  const { copyFeedback, toasts, showToast, dismissToast } = useUI()
  const { setSyncPhase } = useSyncStatus()
  const {
    modal, openModal, closeModal,
    openAccountModal,
    selectOrdinal, startTransferOrdinal,
    newMnemonic, setNewMnemonic, confirmMnemonic,
    unlockConfirm, unlocking, setUnlocking,
    startUnlock, startUnlockAll, cancelUnlock
  } = useModal()

  // UI State
  const [activeTab, setActiveTab] = useState<Tab>('activity')

  // Backup reminder state
  const [showBackupReminder, setShowBackupReminder] = useState(false)

  // BRC-100 handler
  const {
    brc100Request,
    handleApprove: handleApproveBRC100,
    handleReject: handleRejectBRC100
  } = useBrc100Handler({
    wallet,
    onRequestReceived: () => openModal('brc100')
  })

  // Tab navigation
  const navigateTab = useCallback((direction: 'left' | 'right') => {
    const currentIndex = TAB_ORDER.indexOf(activeTab)
    let newIndex: number
    if (direction === 'left') {
      newIndex = currentIndex === 0 ? TAB_ORDER.length - 1 : currentIndex - 1
    } else {
      newIndex = currentIndex === TAB_ORDER.length - 1 ? 0 : currentIndex + 1
    }
    setActiveTab(TAB_ORDER[newIndex]!)
  }, [activeTab])

  // Keyboard navigation
  useKeyboardNav({
    onArrowLeft: () => !modal && navigateTab('left'),
    onArrowRight: () => !modal && navigateTab('right'),
    onEscape: () => modal && closeModal(),
    enabled: true
  })

  // ── Extracted hooks ────────────────────────────────────────────────────

  // Auto-sync pipeline: initial sync, background sync, account discovery
  useCheckSync({
    wallet,
    activeAccountId,
    accounts,
    fetchDataFromDB,
    fetchData,
    performSync,
    refreshTokens,
    consumePendingDiscovery,
    peekPendingDiscovery,
    clearPendingDiscovery,
    refreshAccounts,
    setSyncPhase,
    showToast,
  })

  // MessageBox payment listener
  const { newPaymentAlert, dismissPaymentAlert } = usePaymentListener({
    wallet,
    fetchData,
    showToast,
  })

  // Auto-clear mnemonic from memory after security timeout
  useMnemonicAutoClear(newMnemonic, setNewMnemonic)

  // Lock unlock confirmation logic
  const { unlockableLocks, handleConfirmUnlock } = useUnlockHandler({
    locks,
    networkInfo,
    unlockConfirm,
    handleUnlock,
    showToast,
    setUnlocking,
    cancelUnlock,
  })

  // Backup reminder disabled — too aggressive for current UX
  // Users verify their recovery phrase once during onboarding; periodic re-verification is overkill
  // useEffect(() => {
  //   if (wallet && !isLocked) {
  //     const shouldShow = needsBackupReminder()
  //     if (shouldShow) {
  //       setTimeout(() => setShowBackupReminder(true), 0)
  //     }
  //   }
  // }, [wallet, isLocked])

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleAccountCreate = useCallback(async (name: string): Promise<boolean> => {
    return await createNewAccount(name)
  }, [createNewAccount])

  const handleAccountImport = useCallback(async (name: string, mnemonic: string): Promise<boolean> => {
    return importAccount(name, mnemonic)
  }, [importAccount])

  const handleBrc100Approve = useCallback(() => {
    handleApproveBRC100()
    closeModal()
  }, [handleApproveBRC100, closeModal])

  const handleBrc100Reject = useCallback(() => {
    handleRejectBRC100()
    closeModal()
  }, [handleRejectBRC100, closeModal])

  // ── Render ─────────────────────────────────────────────────────────────

  // Loading screen
  if (loading) {
    return (
      <div className="setup-screen">
        <SimplySatsLogo size={48} />
        <div className="spinner" aria-label="Loading" style={{ marginTop: 16 }} />
      </div>
    )
  }

  // Lock screen
  if (isLocked && wallet === null) {
    return (
      <>
        <LockScreenModal
          onUnlock={unlockWallet}
          accountName={activeAccount?.name || 'Wallet'}
        />
        <Toast message={copyFeedback} toasts={toasts} onDismiss={dismissToast} />
      </>
    )
  }

  // Setup screen (no wallet)
  if (!wallet) {
    return (
      <>
        <OnboardingFlow
          onCreateWallet={handleCreateWallet}
          onRestoreClick={() => openModal('restore')}
          onWalletCreated={(mnemonic) => {
            setNewMnemonic(mnemonic)
            openModal('mnemonic')
          }}
        />

        {modal === 'restore' && (
          <RestoreModal
            onClose={closeModal}
            onSuccess={closeModal}
          />
        )}

        {modal === 'mnemonic' && newMnemonic && (
          FEATURES.BACKUP_VERIFICATION ? (
            <BackupVerificationModal
              mnemonic={newMnemonic}
              onConfirm={confirmMnemonic}
              onCancel={() => {
                setNewMnemonic(null)
                closeModal()
              }}
            />
          ) : (
            <MnemonicModal mnemonic={newMnemonic} onConfirm={confirmMnemonic} />
          )
        )}

        <Toast message={copyFeedback} toasts={toasts} onDismiss={dismissToast} />
      </>
    )
  }

  // Main wallet UI
  return (
    <div className="app">
      <SkipLink targetId="main-content">Skip to main content</SkipLink>

      <Header
        onSettingsClick={() => openModal('settings')}
        onAccountModalOpen={openAccountModal}
        onAccountSwitch={() => setActiveTab('activity')}
      />

      <BalanceDisplay />

      <QuickActions
        onSend={() => openModal('send')}
        onReceive={() => openModal('receive')}
      />

      {showBackupReminder && (
        <div className="backup-reminder-banner" role="alert">
          <span>🔒 It's been a while since you verified your recovery phrase.</span>
          <button
            className="backup-reminder-btn"
            onClick={async () => {
              // Fetch mnemonic from Rust key store on-demand
              const { invoke } = await import('@tauri-apps/api/core')
              try {
                const mnemonic = await invoke<string | null>('get_mnemonic_once')
                if (mnemonic) {
                  setNewMnemonic(mnemonic)
                  openModal('mnemonic')
                } else {
                  showToast('Mnemonic not available — wallet may have been imported without one', 'warning')
                }
              } catch (_err) {
                logger.error('get_mnemonic_once failed', { error: String(_err) })
                showToast('Failed to retrieve recovery phrase', 'error')
              }
              setShowBackupReminder(false)
            }}
          >
            Verify Now
          </button>
          <button
            className="backup-reminder-dismiss"
            onClick={() => setShowBackupReminder(false)}
            aria-label="Dismiss reminder"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      )}

      {syncError && (
        <div className="sync-error-banner" role="status" aria-live="polite">
          <AlertCircle size={14} strokeWidth={2} />
          <span>Unable to sync — data may be stale.</span>
          <button
            className="backup-reminder-btn"
            onClick={() => performSync()}
          >
            Retry
          </button>
          <button
            className="backup-reminder-btn"
            onClick={async () => {
              showToast('Running diagnostics...')
              try {
                const { diagnoseSyncHealth } = await import('./services/sync')
                const health = await diagnoseSyncHealth(activeAccountId ?? undefined)

                // Show structured diagnostics
                const dbStatus = health.dbConnected ? 'DB: Connected' : 'DB: FAILED'
                const apiStatus = health.apiReachable ? 'API: Reachable' : 'API: FAILED'
                const derivedStatus = health.derivedAddressQuery ? 'Derived Addresses: OK' : 'Derived Addresses: FAILED'
                const utxoStatus = health.utxoQuery ? 'UTXOs: OK' : 'UTXOs: FAILED'

                const allOk = health.dbConnected && health.apiReachable && health.derivedAddressQuery && health.utxoQuery
                if (allOk && health.errors.length === 0) {
                  showToast('All diagnostics passed — try syncing again', 'success')
                } else {
                  const failedItems = [dbStatus, apiStatus, derivedStatus, utxoStatus]
                    .filter(s => s.includes('FAIL'))
                  showToast(`Diagnostics: ${failedItems.join(', ')}${health.errors.length > 0 ? '. Errors: ' + health.errors.join(', ') : ''}`, 'error')
                }
              } catch (e) {
                showToast(`Diagnostics failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
              }
            }}
          >
            Diagnose
          </button>
        </div>
      )}

      <AppTabNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        counts={{
          activity: txHistory.length,
          ordinals: ordinals.length,
          tokens: tokenBalances.length,
          locks: locks.length
        }}
      />

      <AppTabContent
        activeTab={activeTab}
        onSelectOrdinal={selectOrdinal}
        onTransferOrdinal={startTransferOrdinal}
        onRefreshTokens={refreshTokens}
        onLock={() => openModal('lock')}
        onUnlock={startUnlock}
        onUnlockAll={startUnlockAll}
        unlocking={unlocking}
      />

      <AppModals
        brc100Request={brc100Request}
        onApproveBRC100={handleBrc100Approve}
        onRejectBRC100={handleBrc100Reject}
        accounts={accounts}
        activeAccountId={activeAccountId}
        onCreateAccount={handleAccountCreate}
        onImportAccount={handleAccountImport}
        onDeleteAccount={deleteAccount}
        onRenameAccount={renameAccount}
        unlockableLocks={unlockableLocks}
        onConfirmUnlock={handleConfirmUnlock}
      />

      <Toast message={copyFeedback} toasts={toasts} onDismiss={dismissToast} />

      <PaymentAlert
        payment={newPaymentAlert}
        onDismiss={dismissPaymentAlert}
      />
    </div>
  )
}

function App() {
  return (
    <ErrorBoundary
      context="AppProviders"
      fallback={(error, reset) => (
        <div className="error-boundary" role="alert">
          <div className="error-boundary-content">
            <h2>Simply Sats failed to start</h2>
            <p className="error-message">{error.message}</p>
            <p className="error-hint">
              Your funds are safe. This may be caused by database corruption or a missing resource.
            </p>
            <div className="error-actions">
              <button type="button" className="error-retry-button" onClick={reset}>
                Try Again
              </button>
              <button
                type="button"
                className="error-refresh-button"
                onClick={() => window.location.reload()}
              >
                Reload App
              </button>
            </div>
          </div>
        </div>
      )}
    >
      <AppProviders>
        <WalletApp />
      </AppProviders>
    </ErrorBoundary>
  )
}

export default App
