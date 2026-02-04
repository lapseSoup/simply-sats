import { useState, useEffect, useCallback } from 'react'
import './App.css'

import { WalletProvider, useWallet, NetworkProvider, UIProvider, useUI, AccountsProvider, TokensProvider } from './contexts'
import {
  Toast,
  PaymentAlert,
  ScreenReaderAnnounceProvider,
  SkipLink
} from './components/shared'
import { useKeyboardNav } from './hooks'
import {
  Header,
  BalanceDisplay,
  BasketChips,
  QuickActions
} from './components/wallet'
import {
  SendModal,
  LockModal,
  ReceiveModal,
  BRC100Modal,
  MnemonicModal,
  OrdinalModal,
  UnlockConfirmModal,
  RestoreModal,
  SettingsModal,
  LockScreenModal,
  OrdinalTransferModal
} from './components/modals'
import {
  ActivityTab,
  OrdinalsTab,
  LocksTab,
  TokensTab
} from './components/tabs'
import { OnboardingFlow } from './components/onboarding'

import type { Ordinal, LockedUTXO } from './services/wallet'
import type { BRC100Request } from './services/brc100'
import {
  setRequestHandler,
  approveRequest,
  rejectRequest,
  getPendingRequests,
  setupHttpServerListener
} from './services/brc100'
import { setupDeepLinkListener } from './services/deeplink'
import type { PaymentNotification } from './services/messageBox'
import { loadNotifications, startPaymentListener } from './services/messageBox'
import { PrivateKey } from '@bsv/sdk'
import { getDerivedAddresses } from './services/database'
import { needsInitialSync } from './services/sync'

type Tab = 'activity' | 'ordinals' | 'tokens' | 'locks'
type Modal = 'send' | 'receive' | 'settings' | 'mnemonic' | 'restore' | 'ordinal' | 'brc100' | 'lock' | 'transfer-ordinal' | null

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
    connectedApps,
    performSync,
    fetchData,
    // Lock screen state
    isLocked,
    unlockWallet,
    // Token state
    tokenBalances,
    refreshTokens
  } = useWallet()

  const { copyFeedback, showToast } = useUI()

  const [activeTab, setActiveTab] = useState<Tab>('activity')
  const [modal, setModal] = useState<Modal>(null)

  // Tab order for keyboard navigation
  const tabOrder: Tab[] = ['activity', 'ordinals', 'tokens', 'locks']

  // Ordinal for transfer
  const [ordinalToTransfer, setOrdinalToTransfer] = useState<Ordinal | null>(null)

  const navigateTab = useCallback((direction: 'left' | 'right') => {
    const currentIndex = tabOrder.indexOf(activeTab)
    let newIndex: number
    if (direction === 'left') {
      newIndex = currentIndex === 0 ? tabOrder.length - 1 : currentIndex - 1
    } else {
      newIndex = currentIndex === tabOrder.length - 1 ? 0 : currentIndex + 1
    }
    setActiveTab(tabOrder[newIndex])
  }, [activeTab])

  // Keyboard navigation for tabs (arrow keys) and Escape to close modals
  useKeyboardNav({
    onArrowLeft: () => !modal && navigateTab('left'),
    onArrowRight: () => !modal && navigateTab('right'),
    onEscape: () => modal && setModal(null),
    enabled: true
  })

  // BRC-100 request state
  const [brc100Request, setBrc100Request] = useState<BRC100Request | null>(null)
  const [localConnectedApps, setLocalConnectedApps] = useState<string[]>(connectedApps)

  // New wallet mnemonic display
  const [newMnemonic, setNewMnemonic] = useState<string | null>(null)

  // Ordinal detail
  const [selectedOrdinal, setSelectedOrdinal] = useState<Ordinal | null>(null)

  // Unlock confirm
  const [unlockConfirm, setUnlockConfirm] = useState<LockedUTXO | 'all' | null>(null)
  const [unlocking, setUnlocking] = useState<string | null>(null)

  // Payment alert
  const [newPaymentAlert, setNewPaymentAlert] = useState<PaymentNotification | null>(null)

  // Set up BRC-100 request handler
  useEffect(() => {
    const handleIncomingRequest = async (request: BRC100Request) => {
      // Check if this is from a trusted origin (auto-approve)
      const savedTrustedOrigins = JSON.parse(localStorage.getItem('simply_sats_trusted_origins') || '[]')
      const isTrusted = request.origin && savedTrustedOrigins.includes(request.origin)

      if (isTrusted && wallet) {
        console.log(`Auto-approving request from trusted origin: ${request.origin}`)
        approveRequest(request.id, wallet)
        return
      }

      setBrc100Request(request)
      setModal('brc100')
    }

    setRequestHandler(handleIncomingRequest)

    let unlistenDeepLink: (() => void) | null = null
    setupDeepLinkListener(handleIncomingRequest).then(unlisten => {
      unlistenDeepLink = unlisten
    })

    let unlistenHttp: (() => void) | null = null
    setupHttpServerListener().then(unlisten => {
      unlistenHttp = unlisten
    })

    const pending = getPendingRequests()
    if (pending.length > 0) {
      setBrc100Request(pending[0])
      setModal('brc100')
    }

    return () => {
      if (unlistenDeepLink) unlistenDeepLink()
      if (unlistenHttp) unlistenHttp()
    }
  }, [wallet])

  // MessageBox listener for payments
  useEffect(() => {
    if (!wallet?.identityWif) return

    loadNotifications()

    const handleNewPayment = (payment: PaymentNotification) => {
      console.log('New payment received:', payment)
      setNewPaymentAlert(payment)
      showToast(`Received ${payment.amount?.toLocaleString() || 'unknown'} sats!`)
      fetchData()
      // Auto-dismiss after 5 seconds
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
        console.log('Initial sync needed, starting...')
        performSync(true)
      } else {
        const derivedAddrs = await getDerivedAddresses()
        if (derivedAddrs.length > 0) {
          console.log('Auto-syncing', derivedAddrs.length, 'derived addresses...')
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

  const handleApproveBRC100 = () => {
    if (!brc100Request || !wallet) return

    if (brc100Request.origin && !localConnectedApps.includes(brc100Request.origin)) {
      const newConnectedApps = [...localConnectedApps, brc100Request.origin]
      setLocalConnectedApps(newConnectedApps)
      localStorage.setItem('simply_sats_connected_apps', JSON.stringify(newConnectedApps))
    }

    approveRequest(brc100Request.id, wallet)
    setBrc100Request(null)
    setModal(null)
  }

  const handleRejectBRC100 = () => {
    if (!brc100Request) return
    rejectRequest(brc100Request.id)
    setBrc100Request(null)
    setModal(null)
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

  // Loading screen
  if (loading) {
    return (
      <div className="setup-screen">
        <div className="spinner" aria-label="Loading" />
      </div>
    )
  }

  // Lock screen (wallet is locked due to inactivity)
  if (isLocked && wallet === null) {
    return (
      <>
        <LockScreenModal onUnlock={unlockWallet} />
        <Toast message={copyFeedback} />
      </>
    )
  }

  // Setup screen (no wallet) - new onboarding flow
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

        {/* Restore Modal */}
        {modal === 'restore' && (
          <RestoreModal
            onClose={() => setModal(null)}
            onSuccess={() => setModal(null)}
          />
        )}

        {/* Mnemonic Display Modal */}
        {modal === 'mnemonic' && newMnemonic && (
          <MnemonicModal mnemonic={newMnemonic} onConfirm={handleMnemonicConfirm} />
        )}

        <Toast message={copyFeedback} />
      </>
    )
  }

  // Main wallet UI
  return (
    <div className="app">
      <SkipLink targetId="main-content">Skip to main content</SkipLink>

      <Header onSettingsClick={() => setModal('settings')} />

      <BalanceDisplay />

      <QuickActions
        onSend={() => setModal('send')}
        onReceive={() => setModal('receive')}
      />

      <BasketChips />

      {/* Navigation Tabs */}
      <nav className="nav-tabs" role="tablist" aria-label="Wallet sections">
        <button
          id="tab-activity"
          className={`nav-tab ${activeTab === 'activity' ? 'active' : ''}`}
          onClick={() => setActiveTab('activity')}
          role="tab"
          aria-selected={activeTab === 'activity'}
          aria-controls="tabpanel-activity"
          tabIndex={activeTab === 'activity' ? 0 : -1}
        >
          Activity
          <span className="tab-count" aria-label={`${txHistory.length} transactions`}>{txHistory.length}</span>
        </button>
        <button
          id="tab-ordinals"
          className={`nav-tab ${activeTab === 'ordinals' ? 'active' : ''}`}
          onClick={() => setActiveTab('ordinals')}
          role="tab"
          aria-selected={activeTab === 'ordinals'}
          aria-controls="tabpanel-ordinals"
          tabIndex={activeTab === 'ordinals' ? 0 : -1}
        >
          Ordinals
          <span className="tab-count" aria-label={`${ordinals.length} ordinals`}>{ordinals.length}</span>
        </button>
        <button
          id="tab-tokens"
          className={`nav-tab ${activeTab === 'tokens' ? 'active' : ''}`}
          onClick={() => setActiveTab('tokens')}
          role="tab"
          aria-selected={activeTab === 'tokens'}
          aria-controls="tabpanel-tokens"
          tabIndex={activeTab === 'tokens' ? 0 : -1}
        >
          Tokens
          <span className="tab-count" aria-label={`${tokenBalances.length} tokens`}>{tokenBalances.length}</span>
        </button>
        <button
          id="tab-locks"
          className={`nav-tab ${activeTab === 'locks' ? 'active' : ''}`}
          onClick={() => setActiveTab('locks')}
          role="tab"
          aria-selected={activeTab === 'locks'}
          aria-controls="tabpanel-locks"
          tabIndex={activeTab === 'locks' ? 0 : -1}
        >
          Locks
          <span className="tab-count" aria-label={`${locks.length} locks`}>{locks.length}</span>
        </button>
      </nav>

      {/* Content */}
      <main
        id="main-content"
        className="content"
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        tabIndex={-1}
      >
        {activeTab === 'activity' && <ActivityTab />}
        {activeTab === 'ordinals' && (
          <OrdinalsTab
            onSelectOrdinal={handleSelectOrdinal}
            onTransferOrdinal={handleTransferOrdinal}
          />
        )}
        {activeTab === 'tokens' && <TokensTab onRefresh={refreshTokens} />}
        {activeTab === 'locks' && (
          <LocksTab
            onLock={() => setModal('lock')}
            onUnlock={handleUnlockClick}
            onUnlockAll={handleUnlockAll}
            unlocking={unlocking}
          />
        )}
      </main>

      {/* Modals */}
      {modal === 'send' && <SendModal onClose={() => setModal(null)} />}
      {modal === 'lock' && <LockModal onClose={() => setModal(null)} />}
      {modal === 'receive' && <ReceiveModal onClose={() => setModal(null)} />}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'ordinal' && selectedOrdinal && (
        <OrdinalModal
          ordinal={selectedOrdinal}
          onClose={() => setModal(null)}
          onTransfer={() => {
            setOrdinalToTransfer(selectedOrdinal)
            setModal('transfer-ordinal')
          }}
        />
      )}
      {modal === 'transfer-ordinal' && ordinalToTransfer && (
        <OrdinalTransferModal
          ordinal={ordinalToTransfer}
          onClose={() => {
            setOrdinalToTransfer(null)
            setModal(null)
          }}
        />
      )}
      {modal === 'brc100' && brc100Request && (
        <BRC100Modal
          request={brc100Request}
          onApprove={handleApproveBRC100}
          onReject={handleRejectBRC100}
        />
      )}
      {modal === 'mnemonic' && newMnemonic && (
        <MnemonicModal mnemonic={newMnemonic} onConfirm={handleMnemonicConfirm} />
      )}

      {/* Unlock Confirm Modal */}
      {unlockConfirm && (
        <UnlockConfirmModal
          locks={unlockConfirm === 'all' ? getUnlockableLocks() : [unlockConfirm]}
          onConfirm={handleConfirmUnlock}
          onCancel={() => setUnlockConfirm(null)}
          unlocking={!!unlocking}
        />
      )}

      {/* Toast */}
      <Toast message={copyFeedback} />

      {/* Payment Alert */}
      <PaymentAlert
        payment={newPaymentAlert}
        onDismiss={() => setNewPaymentAlert(null)}
      />
    </div>
  )
}

function App() {
  return (
    <ScreenReaderAnnounceProvider>
      <NetworkProvider>
        <UIProvider>
          <AccountsProvider>
            <TokensProvider>
              <WalletProvider>
                <WalletApp />
              </WalletProvider>
            </TokensProvider>
          </AccountsProvider>
        </UIProvider>
      </NetworkProvider>
    </ScreenReaderAnnounceProvider>
  )
}

export default App
