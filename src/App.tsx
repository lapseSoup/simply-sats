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
import { needsInitialSync, syncWallet, getLastSyncTimeForAccount } from './services/sync'
import { discoverAccounts } from './services/accountDiscovery'
import { getAccountKeys } from './services/accounts'
import { getSessionPassword } from './services/sessionPasswordStore'
import { switchJustCompleted } from './hooks/useAccountSwitching'
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
  const fetchDataFromDBRef = useRef(fetchDataFromDB)
  useEffect(() => { fetchDataFromDBRef.current = fetchDataFromDB }, [fetchDataFromDB])
  const fetchDataRef = useRef(fetchData)
  useEffect(() => { fetchDataRef.current = fetchData }, [fetchData])
  const performSyncRef = useRef(performSync)
  useEffect(() => { performSyncRef.current = performSync }, [performSync])
  const refreshTokensRef = useRef(refreshTokens)
  useEffect(() => { refreshTokensRef.current = refreshTokens }, [refreshTokens])
  const consumePendingDiscoveryRef = useRef(consumePendingDiscovery)
  useEffect(() => { consumePendingDiscoveryRef.current = consumePendingDiscovery }, [consumePendingDiscovery])
  const peekPendingDiscoveryRef = useRef(peekPendingDiscovery)
  useEffect(() => { peekPendingDiscoveryRef.current = peekPendingDiscovery }, [peekPendingDiscovery])
  const clearPendingDiscoveryRef = useRef(clearPendingDiscovery)
  useEffect(() => { clearPendingDiscoveryRef.current = clearPendingDiscovery }, [clearPendingDiscovery])
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
  // walletRef lets checkSync always read the latest wallet without depending on it.
  // This prevents the effect from firing when setWallet() is called during a switch
  // (which would cause a mismatched newWallet+oldAccountId pair).
  const walletRef = useRef(wallet)
  useEffect(() => { walletRef.current = wallet }, [wallet])
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

  // Coerce wallet to boolean: true when loaded, false when null.
  // Using this in deps instead of `wallet` directly prevents the effect from firing
  // on every account switch (where wallet identity changes but stays non-null).
  // It DOES fire on restore/create (null → non-null) and delete (non-null → null).
  const hasWallet = !!wallet

  // Auto-sync on wallet load or account change.
  // Depends on [activeAccountId, hasWallet] — NOT the wallet object itself.
  // - hasWallet fires the effect on initial restore/create (wallet null → non-null)
  // - activeAccountId fires on account switches
  // During account switches, wallet identity changes (Account1Keys → Account2Keys)
  // but hasWallet stays true, so the effect doesn't re-fire from wallet alone.
  // This avoids the mismatched (newWallet, oldAccountId) pair that caused wrong data.
  useEffect(() => {
    const currentWallet = walletRef.current
    if (!currentWallet || activeAccountId === null) return

    let cancelled = false

    const checkSync = async () => {
      // Read the latest wallet from ref (always current, no stale closure)
      const w = walletRef.current
      if (!w) return

      const discoveryParams = peekPendingDiscoveryRef.current()
      const isPostSwitch = switchJustCompleted()
      logger.info('checkSync starting', {
        hasDiscoveryParams: !!discoveryParams,
        walletAddress: w.walletAddress?.substring(0, 12),
        activeAccountId,
        isPostSwitch,
        accountCount: accountsRef.current.length
      })

      let needsSync = false

      try {
        // If a switch just completed, useAccountSwitching already loaded all DB
        // data with the correct keys+accountId. Skip the DB preload here.
        if (!isPostSwitch) {
          await fetchDataFromDBRef.current()
        }

        needsSync = await needsInitialSync([
          w.walletAddress,
          w.ordAddress,
          w.identityAddress
        ], activeAccountId ?? undefined)

        if (needsSync && !isPostSwitch) {
          // First-ever sync for this account: must block — no cached data to show
          logger.info('Initial sync needed, starting...', { accountId: activeAccountId })
          setSyncPhaseRef.current('syncing')
          await performSyncRef.current(true)
          setSyncPhaseRef.current('loading')
          await fetchDataRef.current()
          showToastRef.current('Wallet ready ✓', 'success')
          setSyncPhaseRef.current(null)
        } else if (needsSync && isPostSwitch) {
          // Account was just switched to but has never been synced (e.g. discovered
          // account). Do a background sync — DB data was already loaded by the switch.
          logger.info('Post-switch initial sync (background)', { accountId: activeAccountId })
          ;(async () => {
            try {
              if (cancelled) return
              await performSyncRef.current(false, false, true)
              if (cancelled) return
              await fetchDataRef.current()
            } catch (e) {
              logger.warn('Post-switch background sync failed', { error: String(e) })
            } finally {
              setSyncPhaseRef.current(null)
            }
          })()
        } else {
          // Already-synced account — background-sync if data is stale (>5 min since last sync).
          const SYNC_COOLDOWN_MS = 5 * 60 * 1000
          const lastSyncTime = await getLastSyncTimeForAccount(activeAccountId!)
          const isStale = (Date.now() - lastSyncTime) > SYNC_COOLDOWN_MS

          if (isStale) {
            logger.info('Account data stale, background-syncing', { accountId: activeAccountId, lastSyncTime })
            ;(async () => {
              try {
                if (cancelled) return
                await performSyncRef.current(false, false, true)
                if (cancelled) return
                await fetchDataFromDBRef.current()
              } catch (e) {
                logger.warn('Background sync after switch failed', { error: String(e) })
              } finally {
                setSyncPhaseRef.current(null)
              }
            })()
          } else {
            logger.info('Account data fresh, skipping sync', { accountId: activeAccountId, lastSyncTime })
          }
        }
      } catch (e) {
        logger.error('Auto-sync pipeline failed', e)
      } finally {
        // Clear sync phase for the initial-sync (blocking) path.
        // Background sync manages its own phase in its own finally block.
        if (needsSync) {
          setSyncPhaseRef.current(null)
        }
      }

      // Bail out if this invocation was superseded by a newer one
      if (cancelled) {
        logger.info('checkSync cancelled after sync pipeline (superseded by newer invocation)')
        return
      }

      // Sync token balances as part of initial load
      try {
        await refreshTokensRef.current()
      } catch (e) {
        logger.error('Token refresh during auto-sync failed', e)
      }

      // Background-sync all inactive accounts so their data is fresh when switched to.
      // Skip when discovery is pending — background sync holds the DB lock and would
      // race with discoverAccounts' createAccount calls, causing "database is locked" errors.
      // Fire-and-forget: failures are logged but don't affect the active account.
      const otherAccounts = accountsRef.current.filter(a => a.id !== activeAccountId)
      if (otherAccounts.length > 0 && !discoveryParams) {
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
              // Refresh accounts after EACH account sync so Header picks up
              // the new balance immediately (instead of waiting for all accounts).
              try { await refreshAccountsRef.current() } catch { /* non-critical */ }
            } catch (e) {
              logger.warn('Background sync failed for account', { accountId: account.id, error: String(e) })
            }
          }
        })()
      }

      // Bail out if this invocation was superseded by a newer one
      if (cancelled) {
        logger.info('checkSync cancelled before discovery (superseded by newer invocation)')
        return
      }

      // Run account discovery AFTER primary sync to avoid race conditions
      // (discoverAccounts changes activeAccountId which would discard fetchData results if concurrent)
      //
      // NOTE: Discovery is NOT gated on needsSync — these are orthogonal concerns.
      // pendingDiscoveryRef is a one-shot signal set only during handleRestoreWallet.
      // If Account 1 was previously synced (needsSync = false), additional accounts on
      // the blockchain still need to be discovered.
      //
      // We peek first, then clear only when we're about to run discovery.
      // This ensures a cancelled invocation doesn't destroy the params.
      if (discoveryParams) {
        // Clear the ref now that we've committed to running discovery
        clearPendingDiscoveryRef.current()
        // Brief cooldown to let DB writes from restore sync settle.
        // Discovery uses Tauri's Rust reqwest client (not WKWebView), so
        // CDN caching and rate limiting are less of a concern.
        await new Promise(resolve => setTimeout(resolve, 1000))
        if (cancelled) {
          logger.info('checkSync cancelled during pre-discovery cooldown')
          return
        }
        logger.info('Account discovery starting', {
          excludeAccountId: discoveryParams.excludeAccountId
        })
        showToastRef.current('Scanning for additional accounts...')
        try {
          const found = await discoverAccounts(
            discoveryParams.mnemonic,
            discoveryParams.password,
            discoveryParams.excludeAccountId
          )
          logger.info('Account discovery complete', { found })
          if (found > 0) {
            await refreshAccountsRef.current()
            showToastRef.current(`Discovered ${found} additional account${found > 1 ? 's' : ''}`, 'success')

            // Background-sync discovered accounts so their balances appear in the
            // account switcher. Discovery creates accounts with deferred sync, so
            // they have 0 UTXOs until explicitly synced. Fire-and-forget.
            // Read fresh account list from DB (accountsRef.current may not have
            // the newly discovered accounts yet — React state update is async).
            const sessionPwd = getSessionPassword()
            const { getAllAccounts: fetchAllAccounts } = await import('./services/accounts')
            const allAccounts = await fetchAllAccounts()
            const newAccounts = allAccounts.filter(a => a.id !== activeAccountId)
            ;(async () => {
              for (const account of newAccounts) {
                try {
                  const keys = await getAccountKeys(account, sessionPwd)
                  if (!keys) continue
                  logger.info('Post-discovery sync for account', { accountId: account.id, name: account.name })
                  await syncWallet(
                    keys.walletAddress,
                    keys.ordAddress,
                    keys.identityAddress,
                    account.id ?? undefined,
                    keys.walletPubKey
                  )
                  // Refresh after each so balances appear incrementally in switcher
                  try { await refreshAccountsRef.current() } catch { /* non-critical */ }
                } catch (e) {
                  logger.warn('Post-discovery sync failed for account', { accountId: account.id, error: String(e) })
                }
              }
            })()
          } else {
            showToastRef.current('No additional accounts found')
          }
        } catch (e) {
          logger.error('Account discovery failed', e)
          showToastRef.current('Account discovery failed', 'error')
        }
      }
    }

    checkSync().catch(err => logger.error('Auto-sync check failed', err))

    return () => { cancelled = true }
  }, [activeAccountId, hasWallet])

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
