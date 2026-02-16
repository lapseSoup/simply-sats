import { useState, useEffect, useCallback, useRef } from 'react'
import { AlertCircle } from 'lucide-react'
import './App.css'

import { useWallet, useUI, useModal } from './contexts'
import { isOk } from './domain/types'
import { logger } from './services/logger'
import { Toast, PaymentAlert, SkipLink } from './components/shared'
import { useKeyboardNav, useBrc100Handler } from './hooks'
import { Header, BalanceDisplay, BasketChips, QuickActions } from './components/wallet'
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

  // Keep a ref to fetchData so the payment listener doesn't re-setup on every sync
  const fetchDataRef = useRef(fetchData)
  useEffect(() => {
    fetchDataRef.current = fetchData
  }, [fetchData])

  // MessageBox listener for payments
  useEffect(() => {
    if (!wallet?.identityWif) return

    loadNotifications()

    const handleNewPayment = (payment: PaymentNotification) => {
      logger.info('New payment received', { txid: payment.txid, amount: payment.amount })
      setNewPaymentAlert(payment)
      showToast(`Received ${payment.amount?.toLocaleString() || 'unknown'} sats!`)
      fetchDataRef.current()
      setTimeout(() => setNewPaymentAlert(null), 5000)
    }

    const identityPrivKey = PrivateKey.fromWif(wallet.identityWif)
    const stopListener = startPaymentListener(identityPrivKey, handleNewPayment)

    return () => {
      stopListener()
    }
  }, [wallet?.identityWif, showToast])

  // Auto-sync on wallet load (only when account is set)
  // Single effect handles both sync + data fetch to avoid race conditions
  useEffect(() => {
    if (!wallet || activeAccountId === null) return

    const checkSync = async () => {
      // Load DB data immediately so UI is populated while sync runs
      await fetchData()

      const needsSync = await needsInitialSync([
        wallet.walletAddress,
        wallet.ordAddress,
        wallet.identityAddress
      ])
      if (needsSync) {
        logger.info('Initial sync needed, starting...', { accountId: activeAccountId })
        await performSync(true)
      } else {
        const derivedAddrs = await getDerivedAddresses(activeAccountId ?? undefined)
        if (derivedAddrs.length > 0) {
          logger.info('Auto-syncing derived addresses', { count: derivedAddrs.length, accountId: activeAccountId })
          await performSync(false)
        }
      }
      // Refresh data after sync to pick up new blockchain data
      await fetchData()

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

    checkSync()
  }, [wallet, performSync, fetchData, activeAccountId, consumePendingDiscovery, refreshAccounts, showToast])

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

  const handleAccountCreate = async (name: string): Promise<boolean> => {
    return await createNewAccount(name)
  }

  const handleAccountImport = async (name: string, mnemonic: string): Promise<boolean> => {
    return importAccount(name, mnemonic)
  }

  const getUnlockableLocks = () => {
    const currentHeight = networkInfo?.blockHeight || 0
    return locks.filter(lock => currentHeight >= lock.unlockBlock)
  }

  const handleConfirmUnlock = async () => {
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
  }

  const handleBrc100Approve = () => {
    handleApproveBRC100()
    closeModal()
  }

  const handleBrc100Reject = () => {
    handleRejectBRC100()
    closeModal()
  }

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

      <BasketChips />

      {showBackupReminder && (
        <div className="backup-reminder-banner" role="alert">
          <span>🔒 It's been a while since you verified your recovery phrase.</span>
          <button
            className="backup-reminder-btn"
            onClick={() => {
              setNewMnemonic(wallet?.mnemonic || null)
              openModal('mnemonic')
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
                const lines = [
                  `DB: ${health.dbConnected ? 'OK' : 'FAIL'}`,
                  `API: ${health.apiReachable ? 'OK' : 'FAIL'}`,
                  `Derived: ${health.derivedAddressQuery ? 'OK' : 'FAIL'}`,
                  `UTXOs: ${health.utxoQuery ? 'OK' : 'FAIL'}`,
                  ...health.errors
                ]
                showToast(lines.join(' | '))
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
    <AppProviders>
      <WalletApp />
    </AppProviders>
  )
}

export default App
