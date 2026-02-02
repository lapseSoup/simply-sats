import { useState, useEffect, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import './App.css'
import type { WalletKeys, Ordinal } from './services/wallet'
import {
  createWallet,
  restoreWallet,
  importFromJSON,
  getBalance,
  getUTXOs,
  getTransactionHistory,
  getOrdinals,
  sendBSV,
  saveWallet,
  loadWallet,
  hasWallet,
  clearWallet,
  calculateMaxSend,
  type UTXO
} from './services/wallet'
import {
  type BRC100Request,
  setRequestHandler,
  approveRequest,
  rejectRequest,
  getPendingRequests,
  setupHttpServerListener,
  setWalletKeys,
  getNetworkStatus
} from './services/brc100'
import { setupDeepLinkListener } from './services/deeplink'
import { initDatabase, exportDatabase, importDatabase, getAllTransactions, addTransaction, type DatabaseBackup } from './services/database'
import {
  syncWallet,
  needsInitialSync,
  restoreFromBlockchain,
  getBalanceFromDatabase
} from './services/sync'
import {
  loadKnownSenders,
  addKnownSender,
  getKnownSenders,
  getDerivedAddresses,
  debugFindInvoiceNumber
} from './services/keyDerivation'
import {
  loadNotifications,
  checkForPayments,
  getPaymentNotifications,
  deriveKeyFromNotification,
  startPaymentListener,
  type PaymentNotification
} from './services/messageBox'
import { PrivateKey } from '@bsv/sdk'
import { openUrl } from '@tauri-apps/plugin-opener'

// Custom SVG Logo - Modern "S" with satoshi dots representing the smallest unit of Bitcoin
const SimplySatsLogo = ({ size = 32 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Background circle dots representing satoshis */}
    <circle cx="12" cy="12" r="3" fill="rgba(0,0,0,0.2)" />
    <circle cx="52" cy="12" r="3" fill="rgba(0,0,0,0.2)" />
    <circle cx="12" cy="52" r="3" fill="rgba(0,0,0,0.2)" />
    <circle cx="52" cy="52" r="3" fill="rgba(0,0,0,0.2)" />

    {/* Main S shape - bold, modern, geometric */}
    <path
      d="M44 18C44 18 40 12 32 12C24 12 18 17 18 24C18 31 24 33 32 35C40 37 46 39 46 48C46 55 40 60 32 60C22 60 18 52 18 52"
      stroke="#000"
      strokeWidth="6"
      strokeLinecap="round"
      fill="none"
    />

    {/* Top accent line */}
    <line x1="32" y1="4" x2="32" y2="12" stroke="#000" strokeWidth="5" strokeLinecap="round" />

    {/* Bottom accent line */}
    <line x1="32" y1="60" x2="32" y2="52" stroke="#000" strokeWidth="5" strokeLinecap="round" />

    {/* Satoshi dot accent - center */}
    <circle cx="32" cy="36" r="4" fill="#000" />
  </svg>
)

type Tab = 'activity' | 'ordinals'
type Modal = 'send' | 'receive' | 'settings' | 'mnemonic' | 'restore' | 'ordinal' | 'brc100' | null
type RestoreMode = 'mnemonic' | 'json'

interface TxHistoryItem {
  tx_hash: string
  height: number
  amount?: number // sats received (positive) or sent (negative)
  address?: string // which of our addresses was involved
}

interface NetworkInfo {
  blockHeight: number
  overlayHealthy: boolean
  overlayNodeCount: number
}

function App() {
  const [wallet, setWallet] = useState<WalletKeys | null>(null)
  const [balance, setBalance] = useState<number>(0)
  const [ordBalance, setOrdBalance] = useState<number>(0)
  const [usdPrice, setUsdPrice] = useState<number>(0)
  const [activeTab, setActiveTab] = useState<Tab>('activity')
  const [modal, setModal] = useState<Modal>(null)
  const [loading, setLoading] = useState(true)
  const [txHistory, setTxHistory] = useState<TxHistoryItem[]>([])
  const [ordinals, setOrdinals] = useState<Ordinal[]>([])
  const [selectedOrdinal, setSelectedOrdinal] = useState<Ordinal | null>(null)
  const [utxos, setUtxos] = useState<UTXO[]>([])

  // Send form state
  const [sendAddress, setSendAddress] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  // Restore form state
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('mnemonic')
  const [restoreMnemonic, setRestoreMnemonic] = useState('')
  const [restoreJSON, setRestoreJSON] = useState('')

  // Receive address type
  const [receiveType, setReceiveType] = useState<'wallet' | 'ordinals' | 'brc100'>('wallet')

  // New wallet mnemonic display
  const [newMnemonic, setNewMnemonic] = useState<string | null>(null)

  // Display settings
  const [displayInSats, setDisplayInSats] = useState<boolean>(() => {
    const saved = localStorage.getItem('simply_sats_display_sats')
    return saved === 'true'
  })

  // BRC-100 request state
  const [brc100Request, setBrc100Request] = useState<BRC100Request | null>(null)
  const [connectedApps, setConnectedApps] = useState<string[]>([])

  // Sync state
  const [syncing, setSyncing] = useState(false)
  const [, setLastSyncTime] = useState<number | null>(null)

  // Network status
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null)

  // Basket balances
  const [basketBalances, setBasketBalances] = useState({
    default: 0,
    ordinals: 0,
    identity: 0,
    locks: 0
  })

  // Known sender input state
  const [senderInput, setSenderInput] = useState('')
  const [showSenderInput, setShowSenderInput] = useState(false)

  // Debug invoice finder state
  const [showDebugInput, setShowDebugInput] = useState(false)
  const [debugAddressInput, setDebugAddressInput] = useState('')
  const [debugSearching, setDebugSearching] = useState(false)
  const [debugResult, setDebugResult] = useState<string | null>(null)

  // MessageBox state
  const [messageBoxStatus, setMessageBoxStatus] = useState<'idle' | 'checking' | 'error'>('idle')
  const [paymentNotifications, setPaymentNotifications] = useState<PaymentNotification[]>([])
  const [newPaymentAlert, setNewPaymentAlert] = useState<PaymentNotification | null>(null)

  // Load wallet and initialize database on mount
  useEffect(() => {
    const init = async () => {
      try {
        await initDatabase()
        console.log('Database initialized successfully')

        // Load transactions from database immediately
        try {
          const dbTxs = await getAllTransactions(30)
          if (dbTxs.length > 0) {
            console.log('Loaded', dbTxs.length, 'transactions from database')
            setTxHistory(dbTxs.map(tx => ({
              tx_hash: tx.txid,
              height: tx.blockHeight || 0
            })))
          }
        } catch (e) {
          console.log('No cached transactions yet')
        }
      } catch (err) {
        console.error('Failed to initialize database:', err)
      }

      if (hasWallet()) {
        const keys = loadWallet('')
        if (keys) {
          setWallet(keys)
        }
      }
      setLoading(false)

      const savedApps = localStorage.getItem('simply_sats_connected_apps')
      if (savedApps) {
        setConnectedApps(JSON.parse(savedApps))
      }
    }
    init()
  }, [])

  // Set up BRC-100 request handler
  useEffect(() => {
    const handleIncomingRequest = (request: BRC100Request) => {
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
  }, [])

  // Update wallet keys for BRC-100 service
  useEffect(() => {
    setWalletKeys(wallet)
  }, [wallet])

  // Fetch network status
  useEffect(() => {
    const fetchNetworkStatus = async () => {
      try {
        const status = await getNetworkStatus()
        setNetworkInfo(status)
      } catch (error) {
        console.error('Failed to fetch network status:', error)
      }
    }
    fetchNetworkStatus()
    const interval = setInterval(fetchNetworkStatus, 60000)
    return () => clearInterval(interval)
  }, [])

  // Sync wallet with blockchain
  const performSync = useCallback(async (isRestore = false) => {
    if (!wallet || syncing) return

    setSyncing(true)
    try {
      console.log('Starting wallet sync...')
      if (isRestore) {
        await restoreFromBlockchain(
          wallet.walletAddress,
          wallet.ordAddress,
          wallet.identityAddress
        )
      } else {
        await syncWallet(
          wallet.walletAddress,
          wallet.ordAddress,
          wallet.identityAddress
        )
      }
      setLastSyncTime(Date.now())
      console.log('Sync complete')

      // Update basket balances from database
      try {
        const [defaultBal, ordBal, idBal, lockBal] = await Promise.all([
          getBalanceFromDatabase('default'),
          getBalanceFromDatabase('ordinals'),
          getBalanceFromDatabase('identity'),
          getBalanceFromDatabase('locks')
        ])
        setBasketBalances({
          default: defaultBal,
          ordinals: ordBal,
          identity: idBal,
          locks: lockBal
        })
      } catch (e) {
        console.error('Failed to get basket balances:', e)
      }
    } catch (error) {
      console.error('Sync failed:', error)
    } finally {
      setSyncing(false)
    }
  }, [wallet, syncing])

  // Check if initial sync is needed
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
      }
    }

    checkSync()
  }, [wallet, performSync])

  // Fetch balances and data
  const fetchData = useCallback(async () => {
    if (!wallet) return

    // Load known senders for derived address scanning
    loadKnownSenders()

    console.log('Fetching data for addresses:', {
      wallet: wallet.walletAddress,
      ord: wallet.ordAddress,
      identity: wallet.identityAddress
    })

    try {
      // Get derived addresses from known senders
      const knownSenders = getKnownSenders()
      console.log('Known senders:', knownSenders)
      let derivedAddresses: { address: string; invoiceNumber?: string }[] = []
      if (knownSenders.length > 0 && wallet.identityWif) {
        try {
          const identityPrivKey = PrivateKey.fromWif(wallet.identityWif)
          const fullDerivedAddresses = getDerivedAddresses(identityPrivKey, knownSenders)
          derivedAddresses = fullDerivedAddresses
          console.log('Scanning', derivedAddresses.length, 'derived addresses from', knownSenders.length, 'known senders')
          // Log first 10 derived addresses for debugging
          console.log('First 10 derived addresses:', fullDerivedAddresses.slice(0, 10).map(d => ({
            address: d.address,
            invoiceNumber: d.invoiceNumber
          })))
        } catch (e) {
          console.error('Failed to derive addresses:', e)
        }
      }

      // Fetch all data in parallel for faster loading
      const [bal, ordBal, idBal, walletUtxos, walletHistory, ordHistory, idHistory, ords] = await Promise.all([
        getBalance(wallet.walletAddress),
        getBalance(wallet.ordAddress),
        getBalance(wallet.identityAddress),
        getUTXOs(wallet.walletAddress),
        getTransactionHistory(wallet.walletAddress),
        getTransactionHistory(wallet.ordAddress),
        getTransactionHistory(wallet.identityAddress),
        getOrdinals(wallet.ordAddress)
      ])

      // Also fetch history for derived addresses (limit to 5 at a time to avoid rate limits)
      let derivedBalance = 0
      let derivedHistory: any[] = []

      // First, check addresses from MessageBox payment notifications (these are reliable)
      const notifications = getPaymentNotifications()
      if (notifications.length > 0 && wallet.identityWif) {
        console.log('Checking', notifications.length, 'MessageBox payment addresses...')
        const identityPrivKey = PrivateKey.fromWif(wallet.identityWif)

        for (const notification of notifications.slice(0, 10)) {
          try {
            const { address } = deriveKeyFromNotification(identityPrivKey, notification)
            const [nBal, nHistory] = await Promise.all([
              getBalance(address),
              getTransactionHistory(address)
            ])
            if (nBal > 0) {
              console.log('Found balance at MessageBox derived address:', address, nBal, 'sats')
              derivedBalance += nBal
            }
            derivedHistory = [...derivedHistory, ...nHistory]
            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 200))
          } catch (e) {
            console.error('Failed to check MessageBox address:', e)
          }
        }
      }

      // Then scan derived addresses from known senders (brute force approach, less reliable)
      // Only scan derived addresses if we have known senders, and limit to 5 to avoid rate limiting
      const derivedToScan = derivedAddresses.slice(0, 5)
      if (derivedToScan.length > 0) {
        for (let i = 0; i < derivedToScan.length; i++) {
          const derived = derivedToScan[i]
          try {
            // Add larger delay between requests to avoid rate limiting
            if (i > 0) await new Promise(r => setTimeout(r, 500))
            const [dBal, dHistory] = await Promise.all([
              getBalance(derived.address),
              getTransactionHistory(derived.address)
            ])
            derivedBalance += dBal
            derivedHistory = [...derivedHistory, ...dHistory]
            if (dBal > 0) console.log('Found balance at derived address:', derived.address, dBal, 'sats')
          } catch (e) {
            // Skip failed fetches (likely rate limited)
            console.log('Rate limited on derived address scan, stopping early')
            break
          }
        }
      }

      console.log('Fetched balances:', { wallet: bal, ord: ordBal, identity: idBal, derived: derivedBalance })
      console.log('Fetched history counts:', {
        wallet: walletHistory.length,
        ord: ordHistory.length,
        identity: idHistory.length,
        derived: derivedHistory.length
      })

      // Log actual transaction data for debugging
      if (walletHistory.length > 0) console.log('Wallet history:', walletHistory)
      if (ordHistory.length > 0) console.log('Ord history:', ordHistory)
      if (idHistory.length > 0) console.log('Identity history:', idHistory)

      setBalance(bal + derivedBalance) // Include derived address balance
      setOrdBalance(ordBal + idBal) // Include identity balance
      setUtxos(walletUtxos)

      // Combine and dedupe transaction history from all addresses including derived
      const allHistory = [...walletHistory, ...ordHistory, ...idHistory, ...derivedHistory]
      const uniqueHistory = allHistory.filter((tx, index, self) =>
        index === self.findIndex(t => t.tx_hash === tx.tx_hash)
      )
      // Sort by height (newest first)
      uniqueHistory.sort((a, b) => (b.height || 0) - (a.height || 0))
      console.log('Total unique transactions to display:', uniqueHistory.length, uniqueHistory)

      // Save transactions to database for instant loading on next startup
      for (const tx of uniqueHistory.slice(0, 30)) {
        try {
          await addTransaction({
            txid: tx.tx_hash,
            createdAt: Date.now(),
            blockHeight: tx.height || undefined,
            status: tx.height > 0 ? 'confirmed' : 'pending'
          })
        } catch (e) {
          // Ignore duplicate errors - transaction already exists
        }
      }

      // Only update if we got results - don't overwrite with empty data (rate limiting protection)
      if (uniqueHistory.length > 0) {
        setTxHistory(uniqueHistory.slice(0, 30))
      } else if (txHistory.length === 0) {
        // Only set empty if we don't already have transactions
        setTxHistory([])
      }

      setOrdinals(ords)
    } catch (error) {
      console.error('Error fetching data:', error)
    }
  }, [wallet])

  // Fetch data immediately when wallet loads, then refresh periodically
  useEffect(() => {
    if (wallet) {
      fetchData() // Fetch immediately
    }
    // Refresh every 60 seconds instead of 30 to avoid rate limiting
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [wallet, fetchData])

  // Start MessageBox listener for payment notifications
  useEffect(() => {
    if (!wallet?.identityWif) return

    // Load stored notifications
    loadNotifications()
    setPaymentNotifications(getPaymentNotifications())

    // Set up payment listener
    const identityPrivKey = PrivateKey.fromWif(wallet.identityWif)

    const handleNewPayment = (payment: PaymentNotification) => {
      console.log('New payment notification received:', payment)
      setPaymentNotifications(getPaymentNotifications())
      setNewPaymentAlert(payment)

      // Auto-dismiss after 5 seconds
      setTimeout(() => setNewPaymentAlert(null), 5000)

      // Trigger data refresh to show new balance
      fetchData()
    }

    // Check immediately, then every 30 seconds
    const stopListener = startPaymentListener(identityPrivKey, handleNewPayment, 30000)

    return () => {
      stopListener()
    }
  }, [wallet?.identityWif, fetchData])

  // Fetch BSV price
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate')
        const data = await response.json()
        setUsdPrice(data.rate)
      } catch (error) {
        console.error('Error fetching price:', error)
      }
    }
    fetchPrice()
    const interval = setInterval(fetchPrice, 60000)
    return () => clearInterval(interval)
  }, [])

  // Wallet actions
  const handleCreateWallet = () => {
    const keys = createWallet()
    setNewMnemonic(keys.mnemonic)
    setModal('mnemonic')
    saveWallet(keys, '')
    setWallet(keys)
  }

  const handleMnemonicConfirm = () => {
    setNewMnemonic(null)
    setModal(null)
  }

  const handleRestoreFromMnemonic = async () => {
    try {
      const keys = restoreWallet(restoreMnemonic.trim())
      saveWallet(keys, '')
      setWallet(keys)
      setRestoreMnemonic('')
      setModal(null)

      setSyncing(true)
      setTimeout(async () => {
        try {
          await restoreFromBlockchain(keys.walletAddress, keys.ordAddress, keys.identityAddress)
          setLastSyncTime(Date.now())
        } catch (err) {
          console.error('Restore sync failed:', err)
        } finally {
          setSyncing(false)
        }
      }, 500)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Invalid mnemonic phrase')
    }
  }

  const handleRestoreFromJSON = async () => {
    try {
      const keys = importFromJSON(restoreJSON.trim())
      saveWallet(keys, '')
      setWallet(keys)
      setRestoreJSON('')
      setModal(null)

      setSyncing(true)
      setTimeout(async () => {
        try {
          await restoreFromBlockchain(keys.walletAddress, keys.ordAddress, keys.identityAddress)
          setLastSyncTime(Date.now())
        } catch (err) {
          console.error('Restore sync failed:', err)
        } finally {
          setSyncing(false)
        }
      }, 500)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Invalid backup file')
    }
  }

  const handleSend = async () => {
    if (!wallet || !sendAddress || !sendAmount) return

    setSending(true)
    setSendError('')

    try {
      const satoshis = Math.floor(parseFloat(sendAmount) * 100000000)
      const utxos = await getUTXOs(wallet.walletAddress)
      const txid = await sendBSV(wallet.walletWif, sendAddress, satoshis, utxos)
      alert(`Transaction sent!\n\nTXID: ${txid.slice(0, 16)}...`)
      setSendAddress('')
      setSendAmount('')
      setModal(null)
      fetchData()
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  // Copy feedback state
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)

  const copyToClipboard = (text: string, label = 'Copied!') => {
    navigator.clipboard.writeText(text)
    showToast(label)
  }

  const showToast = (message: string) => {
    setCopyFeedback(message)
    setTimeout(() => setCopyFeedback(null), 1500)
  }

  const openOnWoC = async (txid: string) => {
    try {
      await openUrl(`https://whatsonchain.com/tx/${txid}`)
    } catch (e) {
      // Fallback to window.open if Tauri opener fails
      window.open(`https://whatsonchain.com/tx/${txid}`, '_blank')
    }
  }

  const handleDeleteWallet = () => {
    if (confirm('Are you sure? Make sure you have backed up your recovery phrase!')) {
      clearWallet()
      setWallet(null)
      setModal(null)
    }
  }

  const handleApproveBRC100 = () => {
    if (!brc100Request || !wallet) return

    if (brc100Request.origin && !connectedApps.includes(brc100Request.origin)) {
      const newConnectedApps = [...connectedApps, brc100Request.origin]
      setConnectedApps(newConnectedApps)
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

  const disconnectApp = (origin: string) => {
    const newConnectedApps = connectedApps.filter(app => app !== origin)
    setConnectedApps(newConnectedApps)
    localStorage.setItem('simply_sats_connected_apps', JSON.stringify(newConnectedApps))
  }

  const formatBRC100Request = (request: BRC100Request): { title: string; description: string } => {
    switch (request.type) {
      case 'getPublicKey':
        return { title: 'Share Public Key', description: 'This app wants your public key for identification.' }
      case 'createSignature':
        return { title: 'Sign Message', description: 'Sign a message to verify your identity.' }
      case 'createAction':
        return { title: 'Create Transaction', description: 'Review this transaction carefully.' }
      case 'isAuthenticated':
        return { title: 'Check Connection', description: 'Verify wallet connection status.' }
      case 'listOutputs':
        return { title: 'List Outputs', description: 'View your UTXOs and balances.' }
      default:
        return { title: 'Request', description: `Type: ${request.type}` }
    }
  }

  const formatBSV = (sats: number) => (sats / 100000000).toFixed(8)
  const formatBSVShort = (sats: number) => {
    const bsv = sats / 100000000
    if (bsv >= 1) return bsv.toFixed(4)
    if (bsv >= 0.01) return bsv.toFixed(6)
    return bsv.toFixed(8)
  }
  const formatUSD = (sats: number) => ((sats / 100000000) * usdPrice).toFixed(2)

  const toggleDisplayUnit = () => {
    const newValue = !displayInSats
    setDisplayInSats(newValue)
    localStorage.setItem('simply_sats_display_sats', String(newValue))
  }

  // Loading screen
  if (loading) {
    return (
      <div className="setup-screen">
        <div className="spinner" />
      </div>
    )
  }

  // Setup screen (no wallet)
  if (!wallet) {
    return (
      <div className="setup-screen">
        <div className="setup-logo">
          <SimplySatsLogo size={56} />
        </div>
        <h1 className="setup-title">Simply Sats</h1>
        <div className="setup-badge">
          <span className="status-dot online"></span>
          BRC-100 Wallet
        </div>
        <p className="setup-subtitle">A powerful BSV wallet built for scale</p>
        <div className="setup-actions">
          <button className="btn btn-primary" onClick={handleCreateWallet}>
            Create New Wallet
          </button>
          <button className="btn btn-secondary" onClick={() => setModal('restore')}>
            Restore Wallet
          </button>
        </div>

        {/* Restore Modal */}
        {modal === 'restore' && (
          <div className="modal-overlay" onClick={() => setModal(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-handle" />
              <div className="modal-header">
                <h2 className="modal-title">Restore Wallet</h2>
                <button className="modal-close" onClick={() => setModal(null)}>×</button>
              </div>
              <div className="modal-content">
                <div className="pill-tabs">
                  <button
                    className={`pill-tab ${restoreMode === 'mnemonic' ? 'active' : ''}`}
                    onClick={() => setRestoreMode('mnemonic')}
                  >
                    Seed Phrase
                  </button>
                  <button
                    className={`pill-tab ${restoreMode === 'json' ? 'active' : ''}`}
                    onClick={() => setRestoreMode('json')}
                  >
                    JSON Backup
                  </button>
                </div>

                {restoreMode === 'mnemonic' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">12-Word Recovery Phrase</label>
                      <textarea
                        className="form-input"
                        placeholder="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"
                        value={restoreMnemonic}
                        onChange={e => setRestoreMnemonic(e.target.value)}
                      />
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={handleRestoreFromMnemonic}
                      disabled={!restoreMnemonic.trim()}
                    >
                      Restore Wallet
                    </button>
                  </>
                )}

                {restoreMode === 'json' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Wallet Backup JSON</label>
                      <textarea
                        className="form-input"
                        placeholder='{"mnemonic": "...", ...}'
                        value={restoreJSON}
                        onChange={e => setRestoreJSON(e.target.value)}
                        style={{ minHeight: 120 }}
                      />
                      <div className="form-hint">
                        Supports Shaullet, 1Sat Ordinals, and Simply Sats backups
                      </div>
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={handleRestoreFromJSON}
                      disabled={!restoreJSON.trim()}
                    >
                      Import Wallet
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Main wallet UI
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo">
          <div className="logo-icon">
            <SimplySatsLogo size={18} />
          </div>
          Simply Sats
          <span className="header-badge">BRC-100</span>
        </div>
        <div className="header-actions">
          <div className="header-status" title={`Block ${networkInfo?.blockHeight?.toLocaleString() || '...'}`}>
            <span className="status-dot online"></span>
            {networkInfo?.blockHeight?.toLocaleString() || '...'}
          </div>
          <button
            className={`icon-btn ${syncing ? 'active' : ''}`}
            onClick={() => performSync(false)}
            title="Sync wallet"
          >
            🔄
          </button>
          <button className="icon-btn" onClick={() => setModal('settings')}>
            ⚙️
          </button>
        </div>
      </header>

      {/* Compact Balance Section */}
      <div className="balance-row">
        <div className="balance-main" onClick={toggleDisplayUnit}>
          {displayInSats ? (
            <><span className="balance-value">{(balance + ordBalance).toLocaleString()}</span> <span className="balance-unit clickable">sats</span></>
          ) : (
            <><span className="balance-value">{formatBSVShort(balance + ordBalance)}</span> <span className="balance-unit clickable">BSV</span></>
          )}
        </div>
        <div className="balance-sub">${formatUSD(balance + ordBalance)} USD</div>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions">
        <button className="action-btn primary" onClick={() => setModal('send')}>
          ↑ Send
        </button>
        <button className="action-btn secondary" onClick={() => setModal('receive')}>
          ↓ Receive
        </button>
      </div>

      {/* Compact Baskets Row */}
      <div className="baskets-row">
        <div className="basket-chip">
          <span className="basket-chip-icon">💰</span>
          <span className="basket-chip-value">{(basketBalances.default || balance).toLocaleString()}</span>
        </div>
        <div className="basket-chip">
          <span className="basket-chip-icon">🔮</span>
          <span className="basket-chip-value">{ordinals.length}</span>
        </div>
        <div className="basket-chip">
          <span className="basket-chip-icon">🔑</span>
          <span className="basket-chip-value">{basketBalances.identity.toLocaleString()}</span>
        </div>
        <div className="basket-chip">
          <span className="basket-chip-icon">🔒</span>
          <span className="basket-chip-value">{basketBalances.locks.toLocaleString()}</span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="nav-tabs">
        <button
          className={`nav-tab ${activeTab === 'activity' ? 'active' : ''}`}
          onClick={() => setActiveTab('activity')}
        >
          Activity
          <span className="tab-count">{txHistory.length}</span>
        </button>
        <button
          className={`nav-tab ${activeTab === 'ordinals' ? 'active' : ''}`}
          onClick={() => setActiveTab('ordinals')}
        >
          Ordinals
          <span className="tab-count">{ordinals.length}</span>
        </button>
      </div>

      {/* Content */}
      <div className="content">
        {activeTab === 'activity' && (
          <div className="tx-list">
            {txHistory.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📭</div>
                <div className="empty-title">No Transactions Yet</div>
                <div className="empty-text">Your transaction history will appear here</div>
              </div>
            ) : (
              txHistory.map((tx) => (
                <div key={tx.tx_hash} className="tx-item" onClick={() => openOnWoC(tx.tx_hash)}>
                  <div className="tx-icon">{tx.amount && tx.amount > 0 ? '📥' : tx.amount && tx.amount < 0 ? '📤' : '📄'}</div>
                  <div className="tx-info">
                    <div className="tx-type">{tx.amount && tx.amount > 0 ? 'Received' : tx.amount && tx.amount < 0 ? 'Sent' : 'Transaction'}</div>
                    <div className="tx-meta">
                      <span className="tx-hash">{tx.tx_hash.slice(0, 8)}...{tx.tx_hash.slice(-6)}</span>
                      {tx.height > 0 && <span>• Block {tx.height.toLocaleString()}</span>}
                    </div>
                  </div>
                  <div className="tx-amount">
                    {tx.amount ? (
                      <div className={`tx-amount-value ${tx.amount > 0 ? 'positive' : 'negative'}`}>
                        {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()} sats
                      </div>
                    ) : (
                      <div className="tx-amount-value">View →</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'ordinals' && (
          <div className="ordinals-grid">
            {ordinals.length === 0 ? (
              <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
                <div className="empty-icon">🔮</div>
                <div className="empty-title">No Ordinals Yet</div>
                <div className="empty-text">Your 1Sat ordinals will appear here</div>
              </div>
            ) : (
              ordinals.map((ord) => (
                <div
                  key={ord.origin}
                  className="ordinal-item"
                  onClick={() => {
                    setSelectedOrdinal(ord)
                    setModal('ordinal')
                  }}
                >
                  <div className="ordinal-icon">🔮</div>
                  <div className="ordinal-id">{ord.origin.slice(0, 8)}...</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Send Modal */}
      {modal === 'send' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-header">
              <h2 className="modal-title">Send BSV</h2>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="modal-content">
              <div className="form-group">
                <label className="form-label">Recipient Address</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter BSV address"
                  value={sendAddress}
                  onChange={e => setSendAddress(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Amount (BSV)</label>
                <div className="input-with-action">
                  <input
                    type="number"
                    className="form-input"
                    placeholder="0.00000000"
                    step="0.00000001"
                    value={sendAmount}
                    onChange={e => setSendAmount(e.target.value)}
                    style={{ paddingRight: 60 }}
                  />
                  <button
                    className="input-action"
                    onClick={() => {
                      const { maxSats } = calculateMaxSend(utxos)
                      setSendAmount((maxSats / 100000000).toFixed(8))
                    }}
                  >
                    MAX
                  </button>
                </div>
                <div className="form-hint">
                  Available: {formatBSV(balance)} BSV • Fee: ~{calculateMaxSend(utxos).fee} sats
                </div>
              </div>
              {sendError && (
                <div className="warning">
                  <span className="warning-icon">⚠️</span>
                  <span className="warning-text">{sendError}</span>
                </div>
              )}
              <button
                className="btn btn-primary"
                onClick={handleSend}
                disabled={sending || !sendAddress || !sendAmount}
              >
                {sending ? 'Sending...' : 'Send BSV'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive Modal */}
      {modal === 'receive' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-header">
              <h2 className="modal-title">Receive</h2>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="modal-content">
              <div className="pill-tabs">
                <button
                  className={`pill-tab ${receiveType === 'wallet' ? 'active' : ''}`}
                  onClick={() => setReceiveType('wallet')}
                >
                  Payment
                </button>
                <button
                  className={`pill-tab ${receiveType === 'ordinals' ? 'active' : ''}`}
                  onClick={() => setReceiveType('ordinals')}
                >
                  Ordinals
                </button>
                <button
                  className={`pill-tab ${receiveType === 'brc100' ? 'active' : ''}`}
                  onClick={() => setReceiveType('brc100')}
                >
                  BRC-100
                </button>
              </div>

              {receiveType === 'brc100' ? (
                <div className="brc100-receive-compact">
                  <div className="brc100-row">
                    <div className="brc100-col">
                      <div className="brc100-label">Address</div>
                      <div className="qr-wrapper-small">
                        <QRCodeSVG value={wallet.identityAddress} size={80} level="L" bgColor="#fff" fgColor="#000" />
                      </div>
                      <button className="copy-btn-small" onClick={() => copyToClipboard(wallet.identityAddress, 'Address copied!')}>
                        📋 Copy
                      </button>
                    </div>
                    <div className="brc100-col">
                      <div className="brc100-label">Public Key</div>
                      <div className="qr-wrapper-small">
                        <QRCodeSVG value={wallet.identityPubKey} size={80} level="L" bgColor="#fff" fgColor="#000" />
                      </div>
                      <button className="copy-btn-small" onClick={() => copyToClipboard(wallet.identityPubKey, 'Public key copied!')}>
                        📋 Copy
                      </button>
                    </div>
                  </div>
                  <div className="brc100-hint-small">
                    Address: direct receive • Public Key: derived addresses
                  </div>
                </div>
              ) : (
                <div className="qr-container">
                  <div className="qr-wrapper">
                    <QRCodeSVG
                      value={receiveType === 'wallet' ? wallet.walletAddress : wallet.ordAddress}
                      size={140}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#000000"
                    />
                  </div>
                  <div className="address-display">
                    {receiveType === 'wallet' ? wallet.walletAddress : wallet.ordAddress}
                  </div>
                  <button
                    className="copy-btn"
                    onClick={() => copyToClipboard(
                      receiveType === 'wallet' ? wallet.walletAddress : wallet.ordAddress,
                      'Address copied!'
                    )}
                  >
                    📋 Copy Address
                  </button>
                  <div className="address-type-hint">
                    {receiveType === 'wallet'
                      ? 'Standard payment address — same address each time'
                      : 'Use for receiving 1Sat Ordinals & inscriptions'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {modal === 'settings' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-header">
              <h2 className="modal-title">Settings</h2>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="modal-content">
              {/* Identity Card */}
              <div className="identity-card">
                <div className="identity-header">
                  <div className="identity-avatar">🔑</div>
                  <div className="identity-info">
                    <div className="identity-label">BRC-100 Identity Key</div>
                    <div className="identity-key">
                      {wallet.identityPubKey.slice(0, 12)}...{wallet.identityPubKey.slice(-8)}
                    </div>
                  </div>
                </div>
                <button
                  className="copy-btn"
                  onClick={() => copyToClipboard(wallet.identityPubKey, 'Identity key copied!')}
                >
                  📋 Copy Identity Key
                </button>
              </div>

              {/* Addresses */}
              <div className="form-group">
                <label className="form-label">Payment Address</label>
                <div className="address-display" style={{ marginBottom: 8 }}>
                  {wallet.walletAddress}
                </div>
                <button className="copy-btn" onClick={() => copyToClipboard(wallet.walletAddress, 'Address copied!')}>
                  📋 Copy
                </button>
              </div>

              <div className="form-group">
                <label className="form-label">Ordinals Address</label>
                <div className="address-display" style={{ marginBottom: 8 }}>
                  {wallet.ordAddress}
                </div>
                <button className="copy-btn" onClick={() => copyToClipboard(wallet.ordAddress, 'Address copied!')}>
                  📋 Copy
                </button>
              </div>

              {/* Recovery Phrase */}
              <div className="form-group">
                <label className="form-label">Recovery Phrase</label>
                {wallet.mnemonic ? (
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      if (confirm('Make sure no one can see your screen!')) {
                        alert(wallet.mnemonic)
                      }
                    }}
                  >
                    Show 12 Words
                  </button>
                ) : (
                  <div className="form-hint">Imported from JSON (no mnemonic)</div>
                )}
              </div>

              {/* Export Keys */}
              <div className="form-group">
                <label className="form-label">Wallet Keys Backup</label>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    if (confirm('WARNING: Never share your private keys!')) {
                      const backup = JSON.stringify({
                        format: 'simply-sats',
                        version: 1,
                        mnemonic: wallet.mnemonic || null,
                        keys: {
                          identity: { wif: wallet.identityWif, pubKey: wallet.identityPubKey },
                          payment: { wif: wallet.walletWif, address: wallet.walletAddress },
                          ordinals: { wif: wallet.ordWif, address: wallet.ordAddress }
                        }
                      }, null, 2)
                      navigator.clipboard.writeText(backup)
                      alert('Wallet keys copied to clipboard!')
                    }
                  }}
                >
                  Export Wallet Keys
                </button>
              </div>

              {/* Database Backup */}
              <div className="form-group">
                <label className="form-label">Full Database Backup</label>
                <div className="form-hint" style={{ marginBottom: 8 }}>
                  Includes UTXOs, transactions, baskets, and sync state
                </div>
                <div className="btn-group">
                  <button
                    className="btn btn-secondary"
                    onClick={async () => {
                      try {
                        const dbBackup = await exportDatabase()
                        const fullBackup = {
                          format: 'simply-sats-full',
                          wallet: {
                            mnemonic: wallet.mnemonic || null,
                            keys: {
                              identity: { wif: wallet.identityWif, pubKey: wallet.identityPubKey },
                              payment: { wif: wallet.walletWif, address: wallet.walletAddress },
                              ordinals: { wif: wallet.ordWif, address: wallet.ordAddress }
                            }
                          },
                          database: dbBackup
                        }
                        navigator.clipboard.writeText(JSON.stringify(fullBackup, null, 2))
                        alert(`Full backup copied!\n\n${dbBackup.utxos.length} UTXOs\n${dbBackup.transactions.length} transactions`)
                      } catch (err) {
                        alert('Backup failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
                      }
                    }}
                  >
                    Export Full Backup
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={async () => {
                      const json = prompt('Paste your full backup JSON:')
                      if (!json) return
                      try {
                        const backup = JSON.parse(json)
                        if (backup.format !== 'simply-sats-full' || !backup.database) {
                          alert('Invalid backup format. Use "Export Full Backup" to create a valid backup.')
                          return
                        }
                        if (!confirm(`Import ${backup.database.utxos.length} UTXOs and ${backup.database.transactions.length} transactions?\n\nThis will replace your current data!`)) {
                          return
                        }
                        await importDatabase(backup.database as DatabaseBackup)
                        alert('Database imported successfully! Syncing...')
                        performSync(false)
                      } catch (err) {
                        alert('Import failed: ' + (err instanceof Error ? err.message : 'Invalid JSON'))
                      }
                    }}
                  >
                    Import Backup
                  </button>
                </div>
              </div>

              {/* Known Senders for BRC-42/43 */}
              <div className="form-group">
                <label className="form-label">Known Senders (BRC-42/43)</label>
                <div className="form-hint" style={{ marginBottom: 8 }}>
                  Add public keys of wallets that send to your identity key
                </div>
                {getKnownSenders().length > 0 && (
                  <div className="app-list" style={{ marginBottom: 8 }}>
                    {getKnownSenders().map(pubKey => (
                      <div key={pubKey} className="app-item">
                        <span className="app-name">{pubKey.slice(0, 12)}...{pubKey.slice(-8)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {showSenderInput ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="66 character hex public key"
                      value={senderInput}
                      onChange={e => setSenderInput(e.target.value)}
                      style={{ fontFamily: 'monospace', fontSize: 11 }}
                    />
                    <div className="btn-group">
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          setShowSenderInput(false)
                          setSenderInput('')
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          if (senderInput.length === 66) {
                            addKnownSender(senderInput)
                            setSenderInput('')
                            setShowSenderInput(false)
                            fetchData()
                            showToast('Sender added!')
                          } else {
                            showToast('Invalid: must be 66 hex chars')
                          }
                        }}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="btn btn-secondary"
                    onClick={() => setShowSenderInput(true)}
                  >
                    Add Known Sender
                  </button>
                )}
                {getKnownSenders().length > 0 && wallet.identityWif && (
                  showDebugInput ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Target address (e.g. 172Hcm...)"
                        value={debugAddressInput}
                        onChange={e => setDebugAddressInput(e.target.value)}
                        style={{ fontFamily: 'monospace', fontSize: 11 }}
                      />
                      <div className="btn-group">
                        <button
                          className="btn btn-secondary"
                          onClick={() => {
                            setShowDebugInput(false)
                            setDebugAddressInput('')
                            setDebugResult(null)
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          className="btn btn-primary"
                          disabled={debugSearching || !debugAddressInput}
                          onClick={() => {
                            if (!debugAddressInput) return
                            const senders = getKnownSenders()
                            if (senders.length === 0) {
                              setDebugResult('❌ No known senders configured')
                              return
                            }
                            setDebugSearching(true)
                            setDebugResult('🔍 Searching ~2000 invoice numbers...')
                            setTimeout(() => {
                              try {
                                const identityPrivKey = PrivateKey.fromWif(wallet.identityWif)
                                for (const sender of senders) {
                                  const result = debugFindInvoiceNumber(identityPrivKey, sender, debugAddressInput)
                                  if (result.found) {
                                    setDebugResult(`✅ FOUND!\n\nInvoice: "${result.invoiceNumber}"\nSender: ${sender.slice(0, 20)}...\nTested: ${result.testedCount}`)
                                    setDebugSearching(false)
                                    return
                                  }
                                }
                                setDebugResult(`❌ Not found after ~2000 tests.\n\nPossible reasons:\n• Wrong sender public key\n• Different derivation protocol\n• Custom invoice format`)
                              } catch (e) {
                                setDebugResult('❌ Error: ' + (e instanceof Error ? e.message : 'Unknown'))
                              }
                              setDebugSearching(false)
                            }, 100)
                          }}
                        >
                          {debugSearching ? 'Searching...' : 'Search'}
                        </button>
                      </div>
                      {debugResult && (
                        <div style={{
                          marginTop: 8,
                          padding: 12,
                          background: 'var(--bg-tertiary)',
                          borderRadius: 8,
                          fontSize: 12,
                          fontFamily: 'monospace',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all'
                        }}>
                          {debugResult}
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      className="btn btn-secondary"
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        setShowDebugInput(true)
                        setDebugResult(null)
                      }}
                    >
                      Debug: Find Invoice Number
                    </button>
                  )
                )}
              </div>

              {/* MessageBox Payment Notifications */}
              <div className="form-group">
                <label className="form-label">MessageBox Payments (BRC-29)</label>
                <div className="form-hint" style={{ marginBottom: 8 }}>
                  Receives payment info from BSV Desktop and BRC-100 wallets
                </div>
                <div className="app-list" style={{ marginBottom: 8 }}>
                  <div className="app-item">
                    <span className="app-name">
                      {messageBoxStatus === 'checking' ? '🔄' : messageBoxStatus === 'error' ? '❌' : '✅'} MessageBox
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {paymentNotifications.length} payment{paymentNotifications.length !== 1 ? 's' : ''} received
                    </span>
                  </div>
                </div>
                {paymentNotifications.length > 0 && (
                  <div className="app-list" style={{ marginBottom: 8, fontSize: 11 }}>
                    {paymentNotifications.slice(0, 5).map((p, i) => (
                      <div key={i} className="app-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                        <span className="app-name">💰 {p.amount?.toLocaleString() || '?'} sats</span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>
                          TX: {p.txid.slice(0, 12)}... • From: {p.senderPublicKey.slice(0, 12)}...
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    if (!wallet?.identityWif) return
                    setMessageBoxStatus('checking')
                    try {
                      const identityPrivKey = PrivateKey.fromWif(wallet.identityWif)
                      const newPayments = await checkForPayments(identityPrivKey)
                      setPaymentNotifications(getPaymentNotifications())
                      if (newPayments.length > 0) {
                        showToast(`Found ${newPayments.length} new payment(s)!`)
                        fetchData()
                      } else {
                        showToast('No new payments')
                      }
                      setMessageBoxStatus('idle')
                    } catch (e) {
                      console.error('MessageBox check failed:', e)
                      setMessageBoxStatus('error')
                      showToast('MessageBox check failed')
                    }
                  }}
                >
                  Check for Payments
                </button>
              </div>

              {/* Connected Apps */}
              {connectedApps.length > 0 && (
                <div className="form-group">
                  <label className="form-label">Connected Apps</label>
                  <div className="app-list">
                    {connectedApps.map(app => (
                      <div key={app} className="app-item">
                        <span className="app-name">{app}</span>
                        <button className="app-disconnect" onClick={() => disconnectApp(app)}>
                          Disconnect
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3">
                <button className="btn btn-danger" onClick={handleDeleteWallet}>
                  Delete Wallet
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mnemonic Display Modal */}
      {modal === 'mnemonic' && newMnemonic && (
        <div className="modal-overlay">
          <div className="modal centered">
            <div className="modal-header">
              <h2 className="modal-title">Recovery Phrase</h2>
            </div>
            <div className="modal-content">
              <div className="warning">
                <span className="warning-icon">⚠️</span>
                <span className="warning-text">
                  Write down these 12 words and keep them safe. This is the ONLY way to recover your wallet!
                </span>
              </div>
              <div className="mnemonic-display">
                <div className="mnemonic-words">
                  {newMnemonic.split(' ').map((word, i) => (
                    <div key={i} className="mnemonic-word">
                      <span>{i + 1}.</span>
                      {word}
                    </div>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary" onClick={handleMnemonicConfirm}>
                I've Saved My Phrase
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ordinal Detail Modal */}
      {modal === 'ordinal' && selectedOrdinal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-header">
              <h2 className="modal-title">Ordinal</h2>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="modal-content">
              <div className="ordinal-detail">
                <div className="ordinal-preview">🔮</div>
                <div className="ordinal-info-list">
                  <div className="ordinal-info-row">
                    <span className="ordinal-info-label">Origin</span>
                    <span className="ordinal-info-value">{selectedOrdinal.origin.slice(0, 16)}...</span>
                  </div>
                  <div className="ordinal-info-row">
                    <span className="ordinal-info-label">TXID</span>
                    <button className="link-btn" onClick={() => openOnWoC(selectedOrdinal.txid)}>
                      View on WhatsOnChain
                    </button>
                  </div>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => copyToClipboard(selectedOrdinal.origin, 'Origin copied!')}
                >
                  Copy Origin
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BRC-100 Request Modal */}
      {modal === 'brc100' && brc100Request && (
        <div className="modal-overlay">
          <div className="modal centered" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">App Request</h2>
            </div>
            <div className="modal-content request-modal">
              <div className="request-icon">🔐</div>
              {brc100Request.origin && (
                <div className="request-origin">{brc100Request.origin}</div>
              )}
              <div className="request-title">{formatBRC100Request(brc100Request).title}</div>
              <div className="request-description">{formatBRC100Request(brc100Request).description}</div>

              {brc100Request.type === 'createSignature' && brc100Request.params && (
                <div className="request-details">
                  <div className="request-detail-row">
                    <span className="request-detail-label">Protocol</span>
                    <span className="request-detail-value">
                      {brc100Request.params.protocolID?.[1] || 'Unknown'}
                    </span>
                  </div>
                  {brc100Request.params.keyID && (
                    <div className="request-detail-row">
                      <span className="request-detail-label">Key ID</span>
                      <span className="request-detail-value">{brc100Request.params.keyID}</span>
                    </div>
                  )}
                </div>
              )}

              {brc100Request.type === 'createAction' && brc100Request.params && (
                <div className="request-details">
                  <div className="request-detail-row">
                    <span className="request-detail-label">Description</span>
                    <span className="request-detail-value">
                      {brc100Request.params.description || 'None'}
                    </span>
                  </div>
                  {brc100Request.params.outputs && (() => {
                    // Calculate exact fee based on transaction size
                    // P2PKH: ~10 bytes overhead + 148 bytes per input + 34 bytes per output
                    const numOutputs = brc100Request.params.outputs.length + 1 // outputs + change
                    const numInputs = Math.ceil((brc100Request.params.outputs.reduce((sum: number, o: any) => sum + (o.satoshis || 0), 0) + 200) / 10000) || 1
                    const txSize = 10 + (numInputs * 148) + (numOutputs * 34)
                    // 100 sats/KB = 0.1 sats/byte
                    const fee = Math.max(1, Math.floor(txSize / 10))
                    const outputAmount = brc100Request.params.outputs.reduce((sum: number, o: any) => sum + (o.satoshis || 0), 0)

                    return (
                      <>
                        <div className="request-detail-row">
                          <span className="request-detail-label">Outputs</span>
                          <span className="request-detail-value">
                            {brc100Request.params.outputs.length}
                          </span>
                        </div>
                        <div className="request-detail-row">
                          <span className="request-detail-label">Amount</span>
                          <span className="request-detail-value">
                            {outputAmount.toLocaleString()} sats
                          </span>
                        </div>
                        <div className="request-detail-row">
                          <span className="request-detail-label">Network Fee</span>
                          <span className="request-detail-value">{fee} sats</span>
                        </div>
                        <div className="request-detail-row">
                          <span className="request-detail-label">Total</span>
                          <span className="request-detail-value" style={{ fontWeight: 600 }}>
                            {(outputAmount + fee).toLocaleString()} sats
                          </span>
                        </div>
                      </>
                    )
                  })()}
                </div>
              )}

              <div className="btn-group">
                <button className="btn btn-secondary" onClick={handleRejectBRC100}>
                  Reject
                </button>
                <button className="btn btn-primary" onClick={handleApproveBRC100}>
                  Approve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Copy Feedback Toast */}
      {copyFeedback && (
        <div className="copy-toast">✓ {copyFeedback}</div>
      )}

      {/* New Payment Alert */}
      {newPaymentAlert && (
        <div className="payment-alert" onClick={() => setNewPaymentAlert(null)}>
          <div className="payment-alert-icon">💰</div>
          <div className="payment-alert-content">
            <div className="payment-alert-title">Payment Received!</div>
            <div className="payment-alert-amount">
              {newPaymentAlert.amount?.toLocaleString() || 'Unknown'} sats
            </div>
            <div className="payment-alert-tx">
              TX: {newPaymentAlert.txid.slice(0, 16)}...
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
