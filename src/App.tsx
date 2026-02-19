import { useState, useEffect, useCallback, useRef } from 'react'
import { AlertCircle, X } from 'lucide-react'
import './App.css'

import { useWallet, useUI, useModal } from './contexts'
import { useNetwork } from './contexts/NetworkContext'
import { isOk } from './domain/types'
import { logger } from './services/logger'
import { Toast, PaymentAlert, SkipLink, ErrorBoundary, SimplySatsLogo } from './components/shared'
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
import { getDerivedAddresses } from './infrastructure/database'
import { needsInitialSync, syncWallet } from './services/sync'
import { discoverAccounts } from './services/accountDiscovery'
import { getAccountKeys } from './services/accounts'
import { getSessionPassword } from './services/sessionPasswordStore'
// import { needsBackupReminder } from './services/backupReminder'  // Disabled: reminder too aggressive

// Tab order for keyboard navigation
const TAB_ORDER: Tab[] = ['activity', 'ordinals', 'tokens', 'locks', 'search']

function WalletApp() {
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
  const { setSyncPhase } = useNetwork()
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

  // Keep refs for all callbacks used inside checkSync so the effect itself only
  // depends on [wallet, activeAccountId] — the two values that actually signal
  // "a new account is ready to sync". Every other function either:
  //   (a) has a dep on wallet/activeAccountId (performSync, fetchData, refreshTokens)
  //       and therefore gets a new identity on every restore/switch, or
  //   (b) arrives through the actionsValue useMemo in WalletContext, which recreates
  //       whenever performSync/fetchData change, giving consumePendingDiscovery and
  //       refreshAccounts new object references even though their underlying logic
  //       is stable.
  // Putting any of these in the dep array caused an infinite sync loop:
  //   wallet changes → new performSync → new actionsValue → new consumePendingDiscovery
  //   → effect re-fires → sync starts again → repeat.
  const fetchDataRef = useRef(fetchData)
  useEffect(() => { fetchDataRef.current = fetchData }, [fetchData])
  const performSyncRef = useRef(performSync)
  useEffect(() => { performSyncRef.current = performSync }, [performSync])
  const refreshTokensRef = useRef(refreshTokens)
  useEffect(() => { refreshTokensRef.current = refreshTokens }, [refreshTokens])
  const consumePendingDiscoveryRef = useRef(consumePendingDiscovery)
  useEffect(() => { consumePendingDiscoveryRef.current = consumePendingDiscovery }, [consumePendingDiscovery])
  const refreshAccountsRef = useRef(refreshAccounts)
  useEffect(() => { refreshAccountsRef.current = refreshAccounts }, [refreshAccounts])
  // setSyncPhase arrives via NetworkContext's useMemo, which recreates whenever
  // syncPhase/networkInfo/syncing/usdPrice change. Keeping it in the effect deps
  // caused an infinite loop: setSyncPhase('syncing') → syncPhase changes →
  // useMemo recreates → new setSyncPhase reference → effect re-fires → repeat.
  const setSyncPhaseRef = useRef(setSyncPhase)
  useEffect(() => { setSyncPhaseRef.current = setSyncPhase }, [setSyncPhase])
  // showToast arrives via UIContext's useMemo, which includes `toasts` in its deps.
  // Every time a toast is displayed, toasts changes → useMemo recreates → new
  // showToast reference → effect re-fires → sync starts again → repeat.
  // Calling showToast('Wallet ready ✓') inside the effect was the trigger.
  const showToastRef = useRef(showToast)
  useEffect(() => { showToastRef.current = showToast }, [showToast])
  const accountsRef = useRef(accounts)
  useEffect(() => { accountsRef.current = accounts }, [accounts])

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
  // identity changes (detectLocks/syncFetchData identity changes)
  useEffect(() => {
    if (!wallet || activeAccountId === null) return

    const checkSync = async () => {
      // Consume restore-discovery params up front so transient sync/token failures
      // do not permanently skip discovery for this restore session.
      const discoveryParams = consumePendingDiscoveryRef.current()
      logger.info('Account discovery check', {
        hasParams: !!discoveryParams,
        excludeAccountId: discoveryParams?.excludeAccountId
      })

      let needsSync = false

      // Load DB data immediately so UI is populated while sync runs
      try {
        await fetchDataRef.current()

        needsSync = await needsInitialSync([
          wallet.walletAddress,
          wallet.ordAddress,
          wallet.identityAddress
        ], activeAccountId ?? undefined)
        if (needsSync) {
          logger.info('Initial sync needed, starting...', { accountId: activeAccountId })
          setSyncPhaseRef.current('syncing')
          await performSyncRef.current(true)
          setSyncPhaseRef.current('loading')
        } else {
          const derivedAddrs = await getDerivedAddresses(activeAccountId ?? undefined)
          if (derivedAddrs.length > 0) {
            logger.info('Auto-syncing derived addresses', { count: derivedAddrs.length, accountId: activeAccountId })
            await performSyncRef.current(false)
          }
        }
        // Refresh data after sync to pick up new blockchain data
        await fetchDataRef.current()

        if (needsSync) {
          showToastRef.current('Wallet ready ✓', 'success')
        }
      } catch (e) {
        logger.error('Auto-sync pipeline failed', e)
      } finally {
        // Always clear sync phase regardless of success/failure
        setSyncPhaseRef.current(null)
      }

      // Sync token balances as part of initial load
      try {
        await refreshTokensRef.current()
      } catch (e) {
        logger.error('Token refresh during auto-sync failed', e)
      }

      // Background-sync all inactive accounts so their data is fresh when switched to.
      // Fire-and-forget: failures are logged but don't affect the active account.
      const otherAccounts = accountsRef.current.filter(a => a.id !== activeAccountId)
      if (otherAccounts.length > 0) {
        const sessionPwd = getSessionPassword()
        ;(async () => {
          for (const account of otherAccounts) {
            try {
              const keys = await getAccountKeys(account, sessionPwd)
              if (!keys) continue
              logger.info('Background-syncing account', { accountId: account.id, name: account.name })
              await syncWallet(
                keys.walletAddress,
                keys.ordAddress,
                keys.identityAddress,
                account.id ?? undefined,
                keys.walletPubKey
              )
            } catch (e) {
              logger.warn('Background sync failed for account', { accountId: account.id, error: String(e) })
            }
          }
        })()
      }

      // Run account discovery AFTER primary sync to avoid race conditions
      // (discoverAccounts changes activeAccountId which would discard fetchData results if concurrent)
      //
      // NOTE: Discovery is NOT gated on needsSync — these are orthogonal concerns.
      // pendingDiscoveryRef is a one-shot signal set only during handleRestoreWallet.
      // If Account 1 was previously synced (needsSync = false), additional accounts on
      // the blockchain still need to be discovered. The ref being non-null is the sole
      // gate: it's only populated during restore and consumed exactly once.
      if (discoveryParams) {
        try {
          const found = await discoverAccounts(
            discoveryParams.mnemonic,
            discoveryParams.password,
            discoveryParams.excludeAccountId
          )
          logger.info('Account discovery complete', { found })
          if (found > 0) {
            await refreshAccountsRef.current()
            showToastRef.current(`Discovered ${found} additional account${found > 1 ? 's' : ''}`)
          }
        } catch (e) {
          logger.error('Account discovery failed', e)
        }
      }
    }

    checkSync().catch(err => logger.error('Auto-sync check failed', err))
  }, [wallet, activeAccountId])

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
