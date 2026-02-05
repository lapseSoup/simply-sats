import { useState, useEffect, useCallback } from 'react'
import './App.css'

import { useWallet, useUI } from './contexts'
import { logger } from './services/logger'
import { Toast, PaymentAlert, SkipLink } from './components/shared'
import { useKeyboardNav, useBrc100Handler } from './hooks'
import { Header, BalanceDisplay, BasketChips, QuickActions } from './components/wallet'
import { RestoreModal, MnemonicModal, LockScreenModal, BackupVerificationModal } from './components/modals'
import { FEATURES } from './config'
import { OnboardingFlow } from './components/onboarding'
import { AppProviders } from './AppProviders'
import { AppModals, type Modal, type AccountModalMode } from './AppModals'
import { AppTabNav, AppTabContent, type Tab } from './AppTabs'

import type { Ordinal, LockedUTXO } from './services/wallet'
import type { PaymentNotification } from './services/messageBox'
import { loadNotifications, startPaymentListener } from './services/messageBox'
import { PrivateKey } from '@bsv/sdk'
import { getDerivedAddresses } from './services/database'
import { needsInitialSync } from './services/sync'

// Tab order for keyboard navigation
const TAB_ORDER: Tab[] = ['activity', 'ordinals', 'tokens', 'locks', 'utxos']

function WalletApp() {
  const {
    wallet,
    loading,
    txHistory,
    ordinals,
    locks,
    utxos,
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
    deleteAccount,
    renameAccount
  } = useWallet()

  const { copyFeedback, showToast } = useUI()

  // UI State
  const [activeTab, setActiveTab] = useState<Tab>('activity')
  const [modal, setModal] = useState<Modal>(null)
  const [accountModalMode, setAccountModalMode] = useState<AccountModalMode>('manage')

  // Ordinal state
  const [ordinalToTransfer, setOrdinalToTransfer] = useState<Ordinal | null>(null)
  const [selectedOrdinal, setSelectedOrdinal] = useState<Ordinal | null>(null)

  // Wallet state
  const [newMnemonic, setNewMnemonic] = useState<string | null>(null)

  // Unlock state
  const [unlockConfirm, setUnlockConfirm] = useState<LockedUTXO | 'all' | null>(null)
  const [unlocking, setUnlocking] = useState<string | null>(null)

  // Payment alert state
  const [newPaymentAlert, setNewPaymentAlert] = useState<PaymentNotification | null>(null)

  // BRC-100 handler
  const {
    brc100Request,
    handleApprove: handleApproveBRC100,
    handleReject: handleRejectBRC100
  } = useBrc100Handler({
    wallet,
    onRequestReceived: () => setModal('brc100')
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
    setActiveTab(TAB_ORDER[newIndex])
  }, [activeTab])

  // Keyboard navigation
  useKeyboardNav({
    onArrowLeft: () => !modal && navigateTab('left'),
    onArrowRight: () => !modal && navigateTab('right'),
    onEscape: () => modal && setModal(null),
    enabled: true
  })

  // MessageBox listener for payments
  useEffect(() => {
    if (!wallet?.identityWif) return

    loadNotifications()

    const handleNewPayment = (payment: PaymentNotification) => {
      logger.info('New payment received', { txid: payment.txid, amount: payment.amount })
      setNewPaymentAlert(payment)
      showToast(`Received ${payment.amount?.toLocaleString() || 'unknown'} sats!`)
      fetchData()
      setTimeout(() => setNewPaymentAlert(null), 5000)
    }

    const identityPrivKey = PrivateKey.fromWif(wallet.identityWif)
    const stopListener = startPaymentListener(identityPrivKey, handleNewPayment)

    return () => {
      stopListener()
    }
  }, [wallet?.identityWif, showToast, fetchData])

  // Auto-sync on wallet load
  useEffect(() => {
    if (!wallet) return

    const checkSync = async () => {
      const needsSync = await needsInitialSync([
        wallet.walletAddress,
        wallet.ordAddress,
        wallet.identityAddress
      ])
      if (needsSync) {
        logger.info('Initial sync needed, starting...')
        performSync(true)
      } else {
        const derivedAddrs = await getDerivedAddresses()
        if (derivedAddrs.length > 0) {
          logger.info('Auto-syncing derived addresses', { count: derivedAddrs.length })
          performSync(false)
        }
      }
    }

    checkSync()
  }, [wallet, performSync])

  // Fetch data on wallet load
  useEffect(() => {
    if (wallet) {
      fetchData()
    }
  }, [wallet, fetchData])

  // Handlers
  const handleAccountModalOpen = (mode: AccountModalMode) => {
    setAccountModalMode(mode)
    setModal('account')
  }

  const handleAccountCreate = async (name: string): Promise<string | null> => {
    const password = ''
    const success = await createNewAccount(name, password)
    if (success && wallet?.mnemonic) {
      return wallet.mnemonic
    }
    return null
  }

  const handleAccountImport = async (_name: string, _mnemonic: string): Promise<boolean> => {
    return false
  }

  const handleMnemonicConfirm = () => {
    setNewMnemonic(null)
    setModal(null)
  }

  const handleSelectOrdinal = (ordinal: Ordinal) => {
    setSelectedOrdinal(ordinal)
    setModal('ordinal')
  }

  const handleTransferOrdinal = (ordinal: Ordinal) => {
    setOrdinalToTransfer(ordinal)
    setModal('transfer-ordinal')
  }

  const handleUnlockClick = (lock: LockedUTXO) => {
    setUnlockConfirm(lock)
  }

  const handleUnlockAll = () => {
    setUnlockConfirm('all')
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
      if (result.success) {
        showToast(`Unlocked ${lock.satoshis.toLocaleString()} sats!`)
      } else {
        showToast(result.error || 'Unlock failed')
      }
    }

    setUnlocking(null)
    setUnlockConfirm(null)
  }

  const handleBrc100Approve = () => {
    handleApproveBRC100()
    setModal(null)
  }

  const handleBrc100Reject = () => {
    handleRejectBRC100()
    setModal(null)
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
        <Toast message={copyFeedback} />
      </>
    )
  }

  // Setup screen (no wallet)
  if (!wallet) {
    return (
      <>
        <OnboardingFlow
          onCreateWallet={handleCreateWallet}
          onRestoreClick={() => setModal('restore')}
          onWalletCreated={(mnemonic) => {
            setNewMnemonic(mnemonic)
            setModal('mnemonic')
          }}
        />

        {modal === 'restore' && (
          <RestoreModal
            onClose={() => setModal(null)}
            onSuccess={() => setModal(null)}
          />
        )}

        {modal === 'mnemonic' && newMnemonic && (
          FEATURES.BACKUP_VERIFICATION ? (
            <BackupVerificationModal
              mnemonic={newMnemonic}
              onConfirm={handleMnemonicConfirm}
              onCancel={() => {
                setNewMnemonic(null)
                setModal(null)
              }}
            />
          ) : (
            <MnemonicModal mnemonic={newMnemonic} onConfirm={handleMnemonicConfirm} />
          )
        )}

        <Toast message={copyFeedback} />
      </>
    )
  }

  // Main wallet UI
  return (
    <div className="app">
      <SkipLink targetId="main-content">Skip to main content</SkipLink>

      <Header
        onSettingsClick={() => setModal('settings')}
        onAccountModalOpen={handleAccountModalOpen}
      />

      <BalanceDisplay />

      <QuickActions
        onSend={() => setModal('send')}
        onReceive={() => setModal('receive')}
      />

      <BasketChips />

      <AppTabNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        counts={{
          activity: txHistory.length,
          ordinals: ordinals.length,
          tokens: tokenBalances.length,
          locks: locks.length,
          utxos: utxos.length
        }}
      />

      <AppTabContent
        activeTab={activeTab}
        onSelectOrdinal={handleSelectOrdinal}
        onTransferOrdinal={handleTransferOrdinal}
        onRefreshTokens={refreshTokens}
        onLock={() => setModal('lock')}
        onUnlock={handleUnlockClick}
        onUnlockAll={handleUnlockAll}
        unlocking={unlocking}
      />

      <AppModals
        modal={modal}
        onCloseModal={() => setModal(null)}
        selectedOrdinal={selectedOrdinal}
        onTransferOrdinal={(ordinal) => {
          setOrdinalToTransfer(ordinal)
          setModal('transfer-ordinal')
        }}
        ordinalToTransfer={ordinalToTransfer}
        onTransferComplete={() => {
          setOrdinalToTransfer(null)
          setModal(null)
        }}
        brc100Request={brc100Request}
        onApproveBRC100={handleBrc100Approve}
        onRejectBRC100={handleBrc100Reject}
        newMnemonic={newMnemonic}
        onMnemonicConfirm={handleMnemonicConfirm}
        accountModalMode={accountModalMode}
        accounts={accounts}
        activeAccountId={activeAccountId}
        onCreateAccount={handleAccountCreate}
        onImportAccount={handleAccountImport}
        onDeleteAccount={deleteAccount}
        onRenameAccount={renameAccount}
        unlockConfirm={unlockConfirm}
        unlockableLocks={getUnlockableLocks()}
        onConfirmUnlock={handleConfirmUnlock}
        onCancelUnlock={() => setUnlockConfirm(null)}
        isUnlocking={!!unlocking}
      />

      <Toast message={copyFeedback} />

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
