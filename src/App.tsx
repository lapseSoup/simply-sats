import { useState, useEffect, useCallback, useRef } from 'react'
import { AlertCircle } from 'lucide-react'
import './App.css'

import { useWallet, useUI, useModal } from './contexts'
import { isOk } from './domain/types'
import { logger } from './services/logger'
import { Toast, PaymentAlert, SkipLink, ErrorBoundary } from './components/shared'
import { useKeyboardNav, useBrc100Handler } from './hooks'
import { Header, BalanceDisplay, QuickActions } from './components/wallet'
import { RestoreModal, MnemonicModal, LockScreenModal, BackupVerificationModal } from './components/modals'
import { FEATURES, SECURITY } from './config'
import { OnboardingFlow } from './components/onboarding'
import { AppProviders } from './AppProviders'
import { AppModals } from './AppModals'
import { AppTabNav, AppTabContent, type Tab } from './AppTabs'

import type { PaymentNotification } from './services/messageBox'
import { loadNotifications, startPaymentListener } from './services/messageBox'
import { PrivateKey } from '@bsv/sdk'
import { getDerivedAddresses } from './services/database'
import { needsInitialSync } from './services/sync'
import { discoverAccounts } from './services/accountDiscovery'
// import { needsBackupReminder } from './services/backupReminder'  // Disabled: reminder too aggressive

// Tab order for keyboard navigation
const TAB_ORDER: Tab[] = ['activity', 'ordinals', 'tokens', 'locks', 'search']

function WalletApp() {
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
    refreshAccounts
  } = useWallet()

  const { copyFeedback, toasts, showToast, dismissToast } = useUI()
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

  // Payment alert state
  const [newPaymentAlert, setNewPaymentAlert] = useState<PaymentNotification | null>(null)

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

  // Keep refs to fetchData/performSync so effects don't re-trigger when
  // their identity changes (e.g. knownUnlockedLocks updates detectLocks → fetchData)
  const fetchDataRef = useRef(fetchData)
  useEffect(() => { fetchDataRef.current = fetchData }, [fetchData])
  const performSyncRef = useRef(performSync)
  useEffect(() => { performSyncRef.current = performSync }, [performSync])

  // MessageBox listener for payments
  useEffect(() => {
    if (!wallet) return

    loadNotifications()

    const handleNewPayment = (payment: PaymentNotification) => {
      logger.info('New payment received', { txid: payment.txid, amount: payment.amount })
      setNewPaymentAlert(payment)
      showToast(`Received ${payment.amount?.toLocaleString() || 'unknown'} sats!`)
      fetchDataRef.current()
      setTimeout(() => setNewPaymentAlert(null), 5000)
    }

    const setupListener = async () => {
      const { getWifForOperation } = await import('./services/wallet')
      const identityWif = await getWifForOperation('identity', 'paymentListener', wallet)
      const identityPrivKey = PrivateKey.fromWif(identityWif)
      return startPaymentListener(identityPrivKey, handleNewPayment)
    }

    let stopListener: (() => void) | undefined
    setupListener()
      .then(stop => { stopListener = stop })
      .catch(err => logger.error('Failed to start payment listener', err))

    return () => {
      stopListener?.()
    }
  }, [wallet, showToast])

  // Auto-sync on wallet load (only when account is set)
  // Single effect handles both sync + data fetch to avoid race conditions
  // Uses refs for fetchData/performSync to avoid re-triggering when their
  // identity changes (e.g. knownUnlockedLocks → detectLocks → fetchData)
  useEffect(() => {
    if (!wallet || activeAccountId === null) return

    const checkSync = async () => {
      // Load DB data immediately so UI is populated while sync runs
      await fetchDataRef.current()

      const needsSync = await needsInitialSync([
        wallet.walletAddress,
        wallet.ordAddress,
        wallet.identityAddress
      ])
      if (needsSync) {
        logger.info('Initial sync needed, starting...', { accountId: activeAccountId })
        await performSyncRef.current(true)
      } else {
        const derivedAddrs = await getDerivedAddresses(activeAccountId ?? undefined)
        if (derivedAddrs.length > 0) {
          logger.info('Auto-syncing derived addresses', { count: derivedAddrs.length, accountId: activeAccountId })
          await performSyncRef.current(false)
        }
      }
      // Refresh data after sync to pick up new blockchain data
      await fetchDataRef.current()

      // Run account discovery AFTER primary sync to avoid race conditions
      // (discoverAccounts changes activeAccountId which would discard fetchData results if concurrent)
      if (needsSync) {
        const discoveryParams = consumePendingDiscovery()
        if (discoveryParams) {
          try {
            const found = await discoverAccounts(
              discoveryParams.mnemonic,
              discoveryParams.password,
              discoveryParams.excludeAccountId
            )
            if (found > 0) {
              await refreshAccounts()
              showToast(`Discovered ${found} additional account${found > 1 ? 's' : ''}`)
            }
          } catch (_e) {
            // Silent failure — primary restore already succeeded
          }
        }
      }
    }

    checkSync().catch(err => logger.error('Auto-sync check failed', err))
  }, [wallet, activeAccountId, consumePendingDiscovery, refreshAccounts, showToast])

  // Auto-clear mnemonic from memory after timeout (security)
  useEffect(() => {
    if (!newMnemonic) return
    const timer = setTimeout(() => {
      setNewMnemonic(null)
      logger.info('Mnemonic auto-cleared from memory after timeout')
    }, SECURITY.MNEMONIC_AUTO_CLEAR_MS)
    return () => clearTimeout(timer)
  }, [newMnemonic, setNewMnemonic])

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

  // Handlers

  const handleAccountCreate = useCallback(async (name: string): Promise<boolean> => {
    return await createNewAccount(name)
  }, [createNewAccount])

  const handleAccountImport = useCallback(async (name: string, mnemonic: string): Promise<boolean> => {
    return importAccount(name, mnemonic)
  }, [importAccount])

  const getUnlockableLocks = useCallback(() => {
    const currentHeight = networkInfo?.blockHeight || 0
    return locks.filter(lock => currentHeight >= lock.unlockBlock)
  }, [networkInfo?.blockHeight, locks])

  const handleConfirmUnlock = useCallback(async () => {
    if (!unlockConfirm) return

    const locksToUnlock = unlockConfirm === 'all' ? getUnlockableLocks() : [unlockConfirm]

    for (const lock of locksToUnlock) {
      setUnlocking(lock.txid)
      const result = await handleUnlock(lock)
      if (isOk(result)) {
        showToast(`Unlocked ${lock.satoshis.toLocaleString()} sats!`)
      } else {
        showToast(result.error || 'Unlock failed', 'error')
      }
    }

    setUnlocking(null)
    cancelUnlock()
  }, [unlockConfirm, getUnlockableLocks, handleUnlock, showToast, setUnlocking, cancelUnlock])

  const handleBrc100Approve = useCallback(() => {
    handleApproveBRC100()
    closeModal()
  }, [handleApproveBRC100, closeModal])

  const handleBrc100Reject = useCallback(() => {
    handleRejectBRC100()
    closeModal()
  }, [handleRejectBRC100, closeModal])

  // Loading screen
  if (loading) {
    return (
      <div className="setup-screen">
        <div className="spinner" aria-label="Loading" />
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
            ✕
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
        unlockableLocks={getUnlockableLocks()}
        onConfirmUnlock={handleConfirmUnlock}
      />

      <Toast message={copyFeedback} toasts={toasts} onDismiss={dismissToast} />

      <PaymentAlert
        payment={newPaymentAlert}
        onDismiss={() => setNewPaymentAlert(null)}
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
