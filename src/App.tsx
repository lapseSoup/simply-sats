import { useState, useEffect, useCallback, useRef } from 'react'
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
  getTransactionDetails,
  calculateTxAmount,
  getOrdinals,
  sendBSV,
  saveWallet,
  loadWallet,
  hasWallet,
  clearWallet,
  calculateExactFee,
  calculateTxFee,
  calculateLockFee,
  getTimelockScriptSize,
  lockBSV,
  unlockBSV,
  // generateUnlockTxHex, // Commented out - was for TX debug button
  getCurrentBlockHeight,
  detectLockedUtxos,
  getFeeRatePerKB,
  setFeeRateFromKB,
  feeFromBytes,
  type UTXO,
  type LockedUTXO
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
import { initDatabase, exportDatabase, importDatabase, clearDatabase, getAllTransactions, addTransaction, upsertTransaction, type DatabaseBackup } from './services/database'
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
import { save, open } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import { wordlists } from 'bip39'

// BIP39 English wordlist for autocomplete
const BIP39_WORDLIST = wordlists.english

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

type Tab = 'activity' | 'ordinals' | 'locks'
type Modal = 'send' | 'receive' | 'settings' | 'mnemonic' | 'restore' | 'ordinal' | 'brc100' | 'lock' | null
type RestoreMode = 'mnemonic' | 'json' | 'fullbackup'

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

// Mnemonic Input with Autocomplete
interface MnemonicInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

function MnemonicInput({ value, onChange, placeholder }: MnemonicInputProps) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const getCurrentWord = (): { word: string; startIndex: number; endIndex: number } => {
    const textarea = textareaRef.current
    if (!textarea) return { word: '', startIndex: 0, endIndex: 0 }

    const cursorPos = textarea.selectionStart
    const text = value

    // Find word boundaries
    let startIndex = cursorPos
    while (startIndex > 0 && text[startIndex - 1] !== ' ') {
      startIndex--
    }

    let endIndex = cursorPos
    while (endIndex < text.length && text[endIndex] !== ' ') {
      endIndex++
    }

    return {
      word: text.slice(startIndex, endIndex).toLowerCase(),
      startIndex,
      endIndex
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    onChange(newValue)

    // Get current word being typed
    setTimeout(() => {
      const { word } = getCurrentWord()

      if (word.length >= 1) {
        const matches = BIP39_WORDLIST.filter(w => w.startsWith(word)).slice(0, 6)
        setSuggestions(matches)
        setShowSuggestions(matches.length > 0)
        setSelectedIndex(0)
      } else {
        setSuggestions([])
        setShowSuggestions(false)
      }
    }, 0)
  }

  const selectSuggestion = (suggestion: string) => {
    const { startIndex, endIndex } = getCurrentWord()
    const newValue = value.slice(0, startIndex) + suggestion + ' ' + value.slice(endIndex).trimStart()
    onChange(newValue)
    setSuggestions([])
    setShowSuggestions(false)
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => (prev + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      selectSuggestion(suggestions[selectedIndex])
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }

  return (
    <div className="mnemonic-input-container">
      <textarea
        ref={textareaRef}
        className="form-input"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="mnemonic-suggestions">
          {suggestions.map((suggestion, index) => (
            <div
              key={suggestion}
              className={`mnemonic-suggestion ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => selectSuggestion(suggestion)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              {suggestion}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function App() {
  const [wallet, setWallet] = useState<WalletKeys | null>(null)
  const [balance, setBalance] = useState<number>(() => {
    const cached = localStorage.getItem('simply_sats_cached_balance')
    return cached ? parseInt(cached, 10) : 0
  })
  const [ordBalance, setOrdBalance] = useState<number>(() => {
    const cached = localStorage.getItem('simply_sats_cached_ord_balance')
    return cached ? parseInt(cached, 10) : 0
  })
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

  // Lock form state
  const [lockAmount, setLockAmount] = useState('')
  const [lockBlocks, setLockBlocks] = useState('')
  const [locking, setLocking] = useState(false)
  const [lockError, setLockError] = useState('')
  const [locks, setLocks] = useState<LockedUTXO[]>(() => {
    const cached = localStorage.getItem('simply_sats_locks')
    return cached ? JSON.parse(cached) : []
  })
  const [unlocking, setUnlocking] = useState<string | null>(null) // txid of lock being unlocked
  const [unlockConfirm, setUnlockConfirm] = useState<LockedUTXO | 'all' | null>(null) // lock to confirm unlock

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

  // Fee rate setting (sats/KB)
  const [feeRateKB, setFeeRateKB] = useState<number>(() => getFeeRatePerKB())

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

        // Load transactions from database immediately (with amounts!)
        try {
          const dbTxs = await getAllTransactions(30)
          if (dbTxs.length > 0) {
            console.log('Loaded', dbTxs.length, 'transactions from database')
            setTxHistory(dbTxs.map(tx => ({
              tx_hash: tx.txid,
              height: tx.blockHeight || 0,
              amount: tx.amount  // Load cached amounts from database
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

      const newBalance = bal + derivedBalance
      const newOrdBalance = ordBal + idBal

      // Get cached balance from localStorage (more reliable than state which may be stale)
      const cachedBalance = parseInt(localStorage.getItem('simply_sats_cached_balance') || '0', 10)
      const cachedOrdBalance = parseInt(localStorage.getItem('simply_sats_cached_ord_balance') || '0', 10)

      // Only update balance if we got valid data OR if we know the balance really is 0
      // Don't overwrite a good cached balance with 0 from rate limiting
      if (newBalance > 0) {
        // Got a real balance from API
        setBalance(newBalance)
        localStorage.setItem('simply_sats_cached_balance', String(newBalance))
      } else if (cachedBalance === 0 && walletHistory.length === 0) {
        // Balance is genuinely 0 (no transactions ever)
        setBalance(0)
      }
      // If newBalance is 0 but we have a cached balance, keep the cached value (likely rate limited)

      if (newOrdBalance > 0) {
        setOrdBalance(newOrdBalance)
        localStorage.setItem('simply_sats_cached_ord_balance', String(newOrdBalance))
      } else if (cachedOrdBalance === 0 && ordHistory.length === 0) {
        setOrdBalance(0)
      }

      if (walletUtxos.length > 0 || utxos.length === 0) {
        setUtxos(walletUtxos)
      }

      // Combine and dedupe transaction history from all addresses including derived
      const allHistory = [...walletHistory, ...ordHistory, ...idHistory, ...derivedHistory]
      const uniqueHistory = allHistory.filter((tx, index, self) =>
        index === self.findIndex(t => t.tx_hash === tx.tx_hash)
      )
      // Sort by height (newest first)
      uniqueHistory.sort((a, b) => (b.height || 0) - (a.height || 0))
      console.log('Total unique transactions to display:', uniqueHistory.length, uniqueHistory)

      // Load existing transactions from database to get cached amounts
      let dbTxMap = new Map<string, { amount?: number; blockHeight?: number }>()
      let dbOnlyTxs: TxHistoryItem[] = []
      try {
        const dbTxs = await getAllTransactions(100)
        for (const dbTx of dbTxs) {
          dbTxMap.set(dbTx.txid, { amount: dbTx.amount, blockHeight: dbTx.blockHeight })
        }
        console.log('Loaded', dbTxMap.size, 'transactions from database for amount lookup')

        // Find transactions that are only in database (like local lock transactions)
        const apiTxIds = new Set(uniqueHistory.map(t => t.tx_hash))
        for (const dbTx of dbTxs) {
          if (!apiTxIds.has(dbTx.txid)) {
            dbOnlyTxs.push({
              tx_hash: dbTx.txid,
              height: dbTx.blockHeight || 0,
              amount: dbTx.amount
            })
          }
        }
        if (dbOnlyTxs.length > 0) {
          console.log('Found', dbOnlyTxs.length, 'database-only transactions (e.g. local locks)')
        }
      } catch (e) {
        console.log('Could not load transactions from database')
      }

      // Merge database-only transactions with API transactions
      // Prefer API version (has correct block height) over database version
      const allTxs = [...uniqueHistory, ...dbOnlyTxs]
      // Re-dedupe (keeps first occurrence, which is now API version)
      const mergedHistory = allTxs.filter((tx, index, self) =>
        index === self.findIndex(t => t.tx_hash === tx.tx_hash)
      )
      // Sort: unconfirmed (height 0) first, then by descending block height, then by tx_pos (within same block)
      mergedHistory.sort((a, b) => {
        const aHeight = a.height || 0
        const bHeight = b.height || 0
        // Unconfirmed transactions (height 0) go to the top
        if (aHeight === 0 && bHeight !== 0) return -1
        if (bHeight === 0 && aHeight !== 0) return 1
        // Sort by descending height first
        if (aHeight !== bHeight) return bHeight - aHeight
        // For same block, sort by descending tx_pos (later transactions first)
        const aPos = (a as any).tx_pos ?? 0
        const bPos = (b as any).tx_pos ?? 0
        return bPos - aPos
      })

      // Fetch amounts for recent transactions - use database first, only fetch new ones from API
      const recentTxs = mergedHistory.slice(0, 10)
      const txsWithAmounts: TxHistoryItem[] = []

      for (const tx of recentTxs) {
        // Check if we have a non-null amount in database first
        const dbData = dbTxMap.get(tx.tx_hash)
        if (dbData?.amount != null) {  // Use != to check for both null and undefined
          txsWithAmounts.push({ ...tx, amount: dbData.amount })
        } else {
          // Fetch transaction details to calculate amount (for new transactions or those without amounts)
          try {
            const details = await getTransactionDetails(tx.tx_hash)
            if (details) {
              const amount = await calculateTxAmount(details, wallet.walletAddress)
              txsWithAmounts.push({ ...tx, amount })
              // Save to database for next time (upsert preserves existing data)
              await upsertTransaction({
                txid: tx.tx_hash,
                createdAt: Date.now(),
                blockHeight: tx.height || undefined,
                status: tx.height > 0 ? 'confirmed' : 'pending',
                amount: amount
              })
              console.log('Fetched and saved amount for tx:', tx.tx_hash.slice(0, 8), amount, 'sats')
            } else {
              txsWithAmounts.push(tx)
            }
            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 150))
          } catch {
            txsWithAmounts.push(tx)
          }
        }
      }

      // Add remaining transactions - use database amounts if available
      for (const tx of mergedHistory.slice(10, 30)) {
        const dbData = dbTxMap.get(tx.tx_hash)
        txsWithAmounts.push({ ...tx, amount: dbData?.amount })
        // Save transaction to database if it doesn't exist yet (without amount)
        if (!dbTxMap.has(tx.tx_hash)) {
          try {
            await addTransaction({
              txid: tx.tx_hash,
              createdAt: Date.now(),
              blockHeight: tx.height || undefined,
              status: tx.height > 0 ? 'confirmed' : 'pending'
            })
          } catch {
            // Ignore duplicate errors
          }
        }
      }

      // Only update if we got results - don't overwrite with empty data (rate limiting protection)
      if (txsWithAmounts.length > 0) {
        // Final sort to ensure consistent ordering after all async processing
        txsWithAmounts.sort((a, b) => {
          const aHeight = a.height || 0
          const bHeight = b.height || 0
          // Unconfirmed transactions (height 0) go to the top
          if (aHeight === 0 && bHeight !== 0) return -1
          if (bHeight === 0 && aHeight !== 0) return 1
          // Sort by descending height first (newest blocks first)
          if (aHeight !== bHeight) return bHeight - aHeight
          // For same block, sort by descending tx_pos (later transactions first)
          const aPos = (a as any).tx_pos ?? 0
          const bPos = (b as any).tx_pos ?? 0
          return bPos - aPos
        })
        setTxHistory(txsWithAmounts.slice(0, 30))
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
  const handleCreateWallet = async () => {
    // Clear old wallet data from database
    await clearDatabase()

    // Clear localStorage data
    localStorage.removeItem('simply_sats_locks')
    localStorage.removeItem('simply_sats_known_senders')
    localStorage.removeItem('simply_sats_connected_apps')
    localStorage.removeItem('simply_sats_display_sats')

    const keys = createWallet()
    setNewMnemonic(keys.mnemonic)
    setModal('mnemonic')
    saveWallet(keys, '')
    setWallet(keys)

    // Reset UI state
    setBalance(0)
    setOrdBalance(0)
    setTxHistory([])
    setOrdinals([])
    setLocks([])
    setConnectedApps([])
  }

  const handleMnemonicConfirm = () => {
    setNewMnemonic(null)
    setModal(null)
  }

  const handleRestoreFromMnemonic = async () => {
    try {
      // Clear old wallet data from database
      await clearDatabase()

      // Clear localStorage data
      localStorage.removeItem('simply_sats_locks')
      localStorage.removeItem('simply_sats_known_senders')
      localStorage.removeItem('simply_sats_connected_apps')

      const keys = restoreWallet(restoreMnemonic.trim())
      saveWallet(keys, '')
      setWallet(keys)
      setRestoreMnemonic('')
      setModal(null)

      // Reset UI state
      setBalance(0)
      setOrdBalance(0)
      setTxHistory([])
      setOrdinals([])
      setLocks([])
      setConnectedApps([])

      setSyncing(true)
      setTimeout(async () => {
        try {
          await restoreFromBlockchain(keys.walletAddress, keys.ordAddress, keys.identityAddress)

          // Detect and restore locked UTXOs from transaction history
          console.log('Scanning for locked UTXOs...')
          const detectedLocks = await detectLockedUtxos(keys.walletAddress, keys.walletPubKey)
          if (detectedLocks.length > 0) {
            console.log(`Restored ${detectedLocks.length} locked UTXO(s)`)
            setLocks(detectedLocks)
            localStorage.setItem('simply_sats_locks', JSON.stringify(detectedLocks))
          }

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
      // Clear old wallet data from database
      await clearDatabase()

      // Clear localStorage data
      localStorage.removeItem('simply_sats_locks')
      localStorage.removeItem('simply_sats_known_senders')
      localStorage.removeItem('simply_sats_connected_apps')

      const keys = importFromJSON(restoreJSON.trim())
      saveWallet(keys, '')
      setWallet(keys)
      setRestoreJSON('')
      setModal(null)

      // Reset UI state
      setBalance(0)
      setOrdBalance(0)
      setTxHistory([])
      setOrdinals([])
      setLocks([])
      setConnectedApps([])

      setSyncing(true)
      setTimeout(async () => {
        try {
          await restoreFromBlockchain(keys.walletAddress, keys.ordAddress, keys.identityAddress)

          // Detect and restore locked UTXOs from transaction history
          console.log('Scanning for locked UTXOs...')
          const detectedLocks = await detectLockedUtxos(keys.walletAddress, keys.walletPubKey)
          if (detectedLocks.length > 0) {
            console.log(`Restored ${detectedLocks.length} locked UTXO(s)`)
            setLocks(detectedLocks)
            localStorage.setItem('simply_sats_locks', JSON.stringify(detectedLocks))
          }

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
      // Parse amount based on display mode (sats or BSV)
      const satoshis = displayInSats
        ? Math.round(parseFloat(sendAmount))
        : Math.round(parseFloat(sendAmount) * 100000000)
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

  // Lock handler
  const handleLock = async () => {
    if (!wallet || !lockAmount || !lockBlocks) return

    setLocking(true)
    setLockError('')

    try {
      const satoshis = displayInSats
        ? Math.round(parseFloat(lockAmount))
        : Math.round(parseFloat(lockAmount) * 100000000)
      const blocks = parseInt(lockBlocks)

      if (blocks < 1) {
        throw new Error('Lock must be at least 1 block')
      }

      // Get current block height
      const currentHeight = networkInfo?.blockHeight || await getCurrentBlockHeight()
      const unlockBlock = currentHeight + blocks

      const walletUtxos = await getUTXOs(wallet.walletAddress)
      const { txid, lockedUtxo } = await lockBSV(wallet.walletWif, satoshis, unlockBlock, walletUtxos)

      // Save lock to local storage
      const newLocks = [...locks, lockedUtxo]
      setLocks(newLocks)
      localStorage.setItem('simply_sats_locks', JSON.stringify(newLocks))

      // Add to state immediately so it shows right away in Activity tab
      // (The transaction is also recorded in the database by lockBSV with the amount)
      const lockTxAmount = -satoshis  // Negative because we're locking/sending
      setTxHistory(prev => [{
        tx_hash: txid,
        height: 0,
        amount: lockTxAmount
      }, ...prev])

      alert(`Locked ${satoshis.toLocaleString()} sats until block ${unlockBlock}!\n\nTXID: ${txid.slice(0, 16)}...`)
      setLockAmount('')
      setLockBlocks('')
      setModal(null)
      fetchData()
    } catch (error) {
      setLockError(error instanceof Error ? error.message : 'Failed to lock')
    } finally {
      setLocking(false)
    }
  }

  // Calculate unlock fee for a single lock
  const getUnlockFee = () => calculateTxFee(1, 1)

  // Get unlockable locks
  const getUnlockableLocks = () => {
    const currentHeight = networkInfo?.blockHeight || 0
    return locks.filter(l => currentHeight >= l.unlockBlock)
  }


  // Unlock handler - performs the actual unlock
  const performUnlock = async (lockedUtxo: LockedUTXO): Promise<{ success: boolean; txid?: string; amount?: number; error?: string }> => {
    if (!wallet) return { success: false, error: 'No wallet' }

    setUnlocking(lockedUtxo.txid)

    try {
      const currentHeight = networkInfo?.blockHeight || await getCurrentBlockHeight()

      if (currentHeight < lockedUtxo.unlockBlock) {
        const blocksRemaining = lockedUtxo.unlockBlock - currentHeight
        throw new Error(`Cannot unlock yet. ${blocksRemaining} blocks remaining.`)
      }

      const txid = await unlockBSV(wallet.walletWif, lockedUtxo, currentHeight)

      // Remove from locks
      const newLocks = locks.filter(l => l.txid !== lockedUtxo.txid)
      setLocks(newLocks)
      localStorage.setItem('simply_sats_locks', JSON.stringify(newLocks))

      // Add to state immediately so it shows right away in Activity tab
      const fee = getUnlockFee()
      const unlockTxAmount = lockedUtxo.satoshis - fee
      setTxHistory(prev => [{
        tx_hash: txid,
        height: 0,
        amount: unlockTxAmount
      }, ...prev])

      return { success: true, txid, amount: unlockTxAmount }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to unlock' }
    } finally {
      setUnlocking(null)
    }
  }

  // Confirm and execute unlock
  const handleConfirmUnlock = async () => {
    if (!unlockConfirm) return

    // Capture the value before clearing
    const toUnlock = unlockConfirm
    setUnlockConfirm(null)

    try {
      if (toUnlock === 'all') {
        // Unlock all unlockable locks
        const unlockable = getUnlockableLocks()
        let successCount = 0
        let totalAmount = 0
        const errors: string[] = []

        for (const lock of unlockable) {
          const result = await performUnlock(lock)
          if (result.success) {
            successCount++
            totalAmount += result.amount || 0
          } else {
            errors.push(result.error || 'Unknown error')
          }
          // Small delay between transactions
          await new Promise(r => setTimeout(r, 500))
        }

        if (successCount > 0) {
          showToast(`Unlocked ${successCount} lock${successCount > 1 ? 's' : ''} for ${totalAmount.toLocaleString()} sats!`, 5000)
          fetchData()
        } else if (errors.length > 0) {
          alert(`Failed to unlock:\n\n${errors[0]}`)
        }
      } else {
        // Unlock single lock
        console.log('Unlocking single lock:', toUnlock)
        const result = await performUnlock(toUnlock)
        console.log('Unlock result:', result)
        if (result.success) {
          showToast(`Unlocked ${toUnlock.satoshis.toLocaleString()} sats!`, 5000)
          fetchData()
        } else {
          // Show detailed error
          alert(`Failed to unlock:\n\n${result.error || 'Unknown error'}`)
        }
      }
    } catch (error) {
      console.error('Unlock error:', error)
      alert(`Unlock failed:\n\n${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /* TX Export function - kept for potential future use
  // Export raw unlock transaction hex for manual miner submission
  const handleExportUnlockTx = async (lockedUtxo: LockedUTXO) => {
    if (!wallet) return

    try {
      const { txHex, txid, outputSats } = await generateUnlockTxHex(wallet.walletWif, lockedUtxo)

      // Copy to clipboard and show info
      navigator.clipboard.writeText(txHex)

      const message = `Raw Transaction Hex copied to clipboard!\n\n` +
        `TXID: ${txid}\n` +
        `Output: ${outputSats} sats\n\n` +
        `This transaction uses OP_NOP2 which is rejected by most nodes due to policy (not consensus).\n\n` +
        `To broadcast, you can:\n` +
        `1. Contact a miner directly (GorillaPool, TAAL)\n` +
        `2. Use a miner's mAPI with policy bypass\n` +
        `3. Post in BSV dev communities for help`

      alert(message)
    } catch (error) {
      alert(`Failed to generate transaction: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
  */

  // Copy feedback state
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)

  const copyToClipboard = (text: string, label = 'Copied!') => {
    navigator.clipboard.writeText(text)
    showToast(label)
  }

  const showToast = (message: string, duration = 3000) => {
    setCopyFeedback(message)
    setTimeout(() => setCopyFeedback(null), duration)
  }

  const openOnWoC = async (txid: string) => {
    try {
      await openUrl(`https://whatsonchain.com/tx/${txid}`)
    } catch (e) {
      // Fallback to window.open if Tauri opener fails
      window.open(`https://whatsonchain.com/tx/${txid}`, '_blank')
    }
  }

  const handleDeleteWallet = async () => {
    if (confirm('Are you sure? Make sure you have backed up your recovery phrase!')) {
      // Clear database
      await clearDatabase()

      // Clear ALL localStorage data
      localStorage.removeItem('simply_sats_locks')
      localStorage.removeItem('simply_sats_known_senders')
      localStorage.removeItem('simply_sats_connected_apps')
      localStorage.removeItem('simply_sats_display_sats')
      localStorage.removeItem('simply_sats_cached_balance')
      localStorage.removeItem('simply_sats_cached_ord_balance')

      // Clear wallet from storage
      clearWallet()

      // Reset ALL state
      setWallet(null)
      setBalance(0)
      setOrdBalance(0)
      setTxHistory([])
      setOrdinals([])
      setLocks([])
      setConnectedApps([])
      setDisplayInSats(true)
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
                  <button
                    className={`pill-tab ${restoreMode === 'fullbackup' ? 'active' : ''}`}
                    onClick={() => setRestoreMode('fullbackup')}
                  >
                    Full Backup
                  </button>
                </div>

                {restoreMode === 'mnemonic' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">12-Word Recovery Phrase</label>
                      <MnemonicInput
                        value={restoreMnemonic}
                        onChange={setRestoreMnemonic}
                        placeholder="Start typing your seed words..."
                      />
                      <div className="form-hint">
                        Type each word and use arrow keys + Enter to select from suggestions
                      </div>
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

                {restoreMode === 'fullbackup' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Full Backup File</label>
                      <div className="form-hint" style={{ marginBottom: 12 }}>
                        Restore from a Simply Sats full backup file (.json) including wallet keys, UTXOs, and transaction history.
                      </div>
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={async () => {
                        try {
                          const filePath = await open({
                            filters: [{ name: 'JSON', extensions: ['json'] }],
                            multiple: false
                          })

                          if (!filePath || Array.isArray(filePath)) return

                          const json = await readTextFile(filePath)
                          const backup = JSON.parse(json)

                          if (backup.format !== 'simply-sats-full' || !backup.wallet) {
                            alert('Invalid backup format. This should be a Simply Sats full backup file.')
                            return
                          }

                          // Restore wallet from backup
                          if (backup.wallet.mnemonic) {
                            // Restore from mnemonic in backup
                            const keys = await restoreWallet(backup.wallet.mnemonic)
                            setWallet({ ...keys, mnemonic: backup.wallet.mnemonic })
                            setWalletKeys(keys)
                          } else if (backup.wallet.keys) {
                            // Fallback to WIF keys
                            const keys = await importFromJSON(JSON.stringify(backup.wallet.keys))
                            setWallet(keys)
                            setWalletKeys(keys)
                          } else {
                            alert('Backup does not contain wallet keys.')
                            return
                          }

                          // Import database if present
                          if (backup.database) {
                            await importDatabase(backup.database as DatabaseBackup)
                          }

                          setModal(null)
                          alert(`Wallet restored from backup!\n\n${backup.database?.utxos?.length || 0} UTXOs\n${backup.database?.transactions?.length || 0} transactions`)

                          // Trigger sync to update balances
                          performSync(false)
                        } catch (err) {
                          alert('Import failed: ' + (err instanceof Error ? err.message : 'Invalid file'))
                        }
                      }}
                    >
                      Select Backup File
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
        <button
          className={`nav-tab ${activeTab === 'locks' ? 'active' : ''}`}
          onClick={() => setActiveTab('locks')}
        >
          Locks
          <span className="tab-count">{locks.length}</span>
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
              txHistory.map((tx) => {
                const isLockTx = locks.some(l => l.txid === tx.tx_hash)
                const txType = isLockTx ? 'Locked' : (tx.amount && tx.amount > 0 ? 'Received' : tx.amount && tx.amount < 0 ? 'Sent' : 'Transaction')
                const txIcon = isLockTx ? '🔒' : (tx.amount && tx.amount > 0 ? '📥' : tx.amount && tx.amount < 0 ? '📤' : '📄')
                return (
                  <div key={tx.tx_hash} className="tx-item" onClick={() => openOnWoC(tx.tx_hash)}>
                    <div className="tx-icon">{txIcon}</div>
                    <div className="tx-info">
                      <div className="tx-type">{txType}</div>
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
                )
              })
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

        {activeTab === 'locks' && (
          <div className="locks-list">
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => setModal('lock')}
              >
                🔒 Lock BSV
              </button>
              {getUnlockableLocks().length > 1 && (
                <button
                  className="unlock-btn"
                  style={{ padding: '8px 16px' }}
                  onClick={() => setUnlockConfirm('all')}
                >
                  🔓 Unlock All ({getUnlockableLocks().length})
                </button>
              )}
            </div>
            {locks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🔓</div>
                <div className="empty-title">No Locks Yet</div>
                <div className="empty-text">Lock your BSV for a set number of blocks</div>
              </div>
            ) : (
              locks.map((lock) => {
                const currentHeight = networkInfo?.blockHeight || 0
                const blocksRemaining = Math.max(0, lock.unlockBlock - currentHeight)
                const isUnlockable = currentHeight >= lock.unlockBlock
                const isUnlocking = unlocking === lock.txid

                return (
                  <div key={lock.txid} className="tx-item lock-item">
                    <div className="tx-icon" onClick={() => openOnWoC(lock.txid)} style={{ cursor: 'pointer' }}>{isUnlockable ? '🔓' : '🔒'}</div>
                    <div className="tx-info" onClick={() => openOnWoC(lock.txid)} style={{ cursor: 'pointer' }}>
                      <div className="tx-type">
                        {lock.satoshis.toLocaleString()} sats
                      </div>
                      <div className="tx-meta">
                        {isUnlockable ? (
                          <span className="unlock-ready">Ready to unlock!</span>
                        ) : (
                          <span>{blocksRemaining.toLocaleString()} blocks remaining</span>
                        )}
                        <span>• Block {lock.unlockBlock.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="tx-amount">
                      {isUnlockable ? (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            className="unlock-btn"
                            onClick={() => setUnlockConfirm(lock)}
                            disabled={isUnlocking}
                          >
                            {isUnlocking ? '...' : 'Unlock'}
                          </button>
                          {/* TX button removed - was for debug raw hex export
                          <button
                            className="unlock-btn"
                            onClick={() => handleExportUnlockTx(lock)}
                            disabled={isUnlocking}
                            title="Export raw TX hex for manual miner submission"
                            style={{ fontSize: '10px', padding: '4px 6px' }}
                          >
                            TX
                          </button>
                          */}
                        </div>
                      ) : (
                        <div className="lock-progress">
                          <div className="lock-progress-text">
                            {Math.round(((lock.unlockBlock - currentHeight) / (lock.unlockBlock - (lock.createdAt ? Math.floor(lock.createdAt / 600000) : lock.unlockBlock - 100))) * 100)}%
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Send Modal */}
      {modal === 'send' && (() => {
        // Parse amount based on display mode (sats or BSV)
        const sendSats = displayInSats
          ? Math.round(parseFloat(sendAmount || '0'))
          : Math.round(parseFloat(sendAmount || '0') * 100000000)
        const availableSats = balance

        // Calculate number of inputs - use UTXOs if available, otherwise estimate from balance
        const numInputs = utxos.length > 0 ? utxos.length : Math.max(1, Math.ceil(balance / 10000))
        const totalUtxoValue = utxos.length > 0 ? utxos.reduce((sum, u) => sum + u.satoshis, 0) : balance

        // Calculate fee - use exact calculation if UTXOs available, otherwise estimate
        let fee = 0
        if (sendSats > 0) {
          if (utxos.length > 0) {
            const feeInfo = calculateExactFee(sendSats, utxos)
            fee = feeInfo.fee
          } else {
            // Estimate fee: check if this is max send (no change) or regular (with change)
            const isMaxSend = sendSats >= totalUtxoValue - 50
            const numOutputs = isMaxSend ? 1 : 2
            fee = calculateTxFee(numInputs, numOutputs)
          }
        }

        // Calculate max sendable with 1 output (no change)
        const maxFee = calculateTxFee(numInputs, 1)
        const maxSendSats = Math.max(0, totalUtxoValue - maxFee)

        return (
          <div className="modal-overlay" onClick={() => setModal(null)}>
            <div className="modal send-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Send BSV</h2>
                <button className="modal-close" onClick={() => setModal(null)}>×</button>
              </div>
              <div className="modal-content compact">
                <div className="form-group">
                  <label className="form-label">To</label>
                  <input
                    type="text"
                    className="form-input mono"
                    placeholder="Enter BSV address"
                    value={sendAddress}
                    onChange={e => setSendAddress(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount ({displayInSats ? 'sats' : 'BSV'})</label>
                  <div className="input-with-action">
                    <input
                      type="number"
                      className="form-input"
                      placeholder={displayInSats ? '0' : '0.00000000'}
                      step={displayInSats ? '1' : '0.00000001'}
                      value={sendAmount}
                      onChange={e => setSendAmount(e.target.value)}
                    />
                    <button
                      className="input-action"
                      onClick={() => setSendAmount(displayInSats ? String(maxSendSats) : (maxSendSats / 100000000).toFixed(8))}
                    >
                      MAX
                    </button>
                  </div>
                </div>

                <div className="send-summary compact">
                  <div className="send-summary-row">
                    <span>Balance</span>
                    <span>{availableSats.toLocaleString()} sats</span>
                  </div>
                  {sendSats > 0 && (
                    <>
                      <div className="send-summary-row">
                        <span>Send</span>
                        <span>{sendSats.toLocaleString()} sats</span>
                      </div>
                      <div className="send-summary-row">
                        <span>Fee</span>
                        <span>{fee} sats</span>
                      </div>
                      <div className="send-summary-row total">
                        <span>Total</span>
                        <span>{(sendSats + fee).toLocaleString()} sats</span>
                      </div>
                    </>
                  )}
                </div>

                {sendError && (
                  <div className="warning compact">
                    <span className="warning-icon">⚠️</span>
                    <span className="warning-text">{sendError}</span>
                  </div>
                )}
                <button
                  className="btn btn-primary"
                  onClick={handleSend}
                  disabled={sending || !sendAddress || !sendAmount || sendSats + fee > availableSats}
                >
                  {sending ? 'Sending...' : `Send ${sendSats > 0 ? sendSats.toLocaleString() + ' sats' : 'BSV'}`}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Lock Modal */}
      {modal === 'lock' && (() => {
        const lockSats = displayInSats
          ? Math.round(parseFloat(lockAmount || '0'))
          : Math.round(parseFloat(lockAmount || '0') * 100000000)
        const blocks = parseInt(lockBlocks || '0')
        const currentHeight = networkInfo?.blockHeight || 0
        const unlockBlock = currentHeight + blocks

        // Estimate unlock time (average 10 min per block)
        const estimatedMinutes = blocks * 10
        const estimatedHours = Math.floor(estimatedMinutes / 60)
        const estimatedDays = Math.floor(estimatedHours / 24)

        let timeEstimate = ''
        if (estimatedDays > 0) {
          timeEstimate = `~${estimatedDays} day${estimatedDays > 1 ? 's' : ''}`
        } else if (estimatedHours > 0) {
          timeEstimate = `~${estimatedHours} hour${estimatedHours > 1 ? 's' : ''}`
        } else if (estimatedMinutes > 0) {
          timeEstimate = `~${estimatedMinutes} min`
        }

        // Calculate exact fee using actual script size
        let fee = 0
        if (wallet && blocks > 0) {
          const scriptSize = getTimelockScriptSize(wallet.walletPubKey, unlockBlock)
          fee = calculateLockFee(1, scriptSize)
        } else {
          fee = calculateLockFee(1) // Fallback estimate
        }

        return (
          <div className="modal-overlay" onClick={() => setModal(null)}>
            <div className="modal send-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Lock BSV</h2>
                <button className="modal-close" onClick={() => setModal(null)}>×</button>
              </div>
              <div className="modal-content compact">
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Amount ({displayInSats ? 'sats' : 'BSV'})</span>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
                      {displayInSats ? balance.toLocaleString() : (balance / 100000000).toFixed(8)} available
                    </span>
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder=""
                    step={displayInSats ? '1' : '0.00000001'}
                    value={lockAmount}
                    onChange={e => setLockAmount(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Lock Duration (blocks)</label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder=""
                    min="1"
                    value={lockBlocks}
                    onChange={e => setLockBlocks(e.target.value)}
                  />
                  <div className="form-hint">
                    {blocks > 0 ? (
                      <>Unlocks at block {unlockBlock.toLocaleString()} {timeEstimate && `(${timeEstimate})`}</>
                    ) : (
                      <>1 block ≈ 10 minutes</>
                    )}
                  </div>
                </div>

                <div className="send-summary compact">
                  <div className="send-summary-row">
                    <span>Current Block</span>
                    <span>{currentHeight.toLocaleString()}</span>
                  </div>
                  {lockSats > 0 && blocks > 0 && (
                    <>
                      <div className="send-summary-row">
                        <span>Lock Amount</span>
                        <span>{lockSats.toLocaleString()} sats</span>
                      </div>
                      <div className="send-summary-row">
                        <span>Unlock Block</span>
                        <span>{unlockBlock.toLocaleString()}</span>
                      </div>
                      <div className="send-summary-row">
                        <span>Fee</span>
                        <span>{fee} sats</span>
                      </div>
                    </>
                  )}
                </div>

                {lockError && (
                  <div className="warning compact">
                    <span className="warning-icon">⚠️</span>
                    <span className="warning-text">{lockError}</span>
                  </div>
                )}
                <button
                  className="btn btn-primary"
                  onClick={handleLock}
                  disabled={locking || !lockAmount || !lockBlocks || lockSats <= 0 || blocks <= 0}
                >
                  {locking ? 'Locking...' : `🔒 Lock ${lockSats > 0 ? lockSats.toLocaleString() + ' sats' : 'BSV'}`}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Unlock Confirmation Modal */}
      {unlockConfirm && (() => {
        const isAll = unlockConfirm === 'all'
        const locksToUnlock = isAll ? getUnlockableLocks() : [unlockConfirm]
        const totalSats = locksToUnlock.reduce((sum, l) => sum + l.satoshis, 0)
        const totalFee = locksToUnlock.length * getUnlockFee()
        const totalReceive = totalSats - totalFee
        const cantUnlock = totalReceive <= 0

        return (
          <div className="modal-overlay" onClick={() => setUnlockConfirm(null)}>
            <div className="modal send-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Confirm Unlock</h2>
                <button className="modal-close" onClick={() => setUnlockConfirm(null)}>×</button>
              </div>
              <div className="modal-content compact">
                {cantUnlock && (
                  <div className="warning compact" style={{ marginBottom: 12 }}>
                    <span className="warning-icon">⚠️</span>
                    <span className="warning-text">
                      Locked amount is less than the unlock fee. Cannot unlock.
                    </span>
                  </div>
                )}
                <div className="send-summary compact">
                  <div className="send-summary-row">
                    <span>Locks to Unlock</span>
                    <span>{locksToUnlock.length}</span>
                  </div>
                  <div className="send-summary-row">
                    <span>Total Locked</span>
                    <span>{totalSats.toLocaleString()} sats</span>
                  </div>
                  <div className="send-summary-row">
                    <span>Transaction Fee{locksToUnlock.length > 1 ? 's' : ''}</span>
                    <span>-{totalFee.toLocaleString()} sats</span>
                  </div>
                  <div className="send-summary-row" style={{ fontWeight: 600, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
                    <span>You'll Receive</span>
                    <span style={{ color: cantUnlock ? 'var(--error)' : 'var(--success)' }}>{cantUnlock ? 'Insufficient' : `+${totalReceive.toLocaleString()} sats`}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button
                    className="btn"
                    style={{ flex: 1, background: 'var(--surface-hover)' }}
                    onClick={() => setUnlockConfirm(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="unlock-btn"
                    style={{ flex: 1, padding: '12px 24px', opacity: cantUnlock ? 0.5 : 1 }}
                    onClick={handleConfirmUnlock}
                    disabled={unlocking !== null || cantUnlock}
                  >
                    {unlocking ? 'Unlocking...' : cantUnlock ? 'Cannot Unlock' : `🔓 Unlock ${totalReceive.toLocaleString()} sats`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Receive Modal */}
      {modal === 'receive' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal send-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Receive</h2>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="modal-content compact">
              <div className="pill-tabs compact">
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
                  Identity
                </button>
              </div>

              {receiveType === 'brc100' ? (
                <div className="qr-container compact">
                  <div className="brc100-qr-row">
                    <div className="brc100-qr-col">
                      <div className="brc100-qr-label">Address</div>
                      <div className="qr-wrapper compact">
                        <QRCodeSVG value={wallet.identityAddress} size={90} level="L" bgColor="#fff" fgColor="#000" />
                      </div>
                      <button className="copy-btn-small" onClick={() => copyToClipboard(wallet.identityAddress, 'Address copied!')}>
                        📋 Copy
                      </button>
                    </div>
                    <div className="brc100-qr-col">
                      <div className="brc100-qr-label">Public Key</div>
                      <div className="qr-wrapper compact">
                        <QRCodeSVG value={wallet.identityPubKey} size={90} level="L" bgColor="#fff" fgColor="#000" />
                      </div>
                      <button className="copy-btn-small" onClick={() => copyToClipboard(wallet.identityPubKey, 'Key copied!')}>
                        📋 Copy
                      </button>
                    </div>
                  </div>
                  <div className="address-type-hint">
                    BRC-100 identity for app connections
                  </div>
                </div>
              ) : (
                <div className="qr-container compact">
                  <div className="qr-wrapper compact">
                    <QRCodeSVG
                      value={receiveType === 'wallet' ? wallet.walletAddress : wallet.ordAddress}
                      size={120}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#000000"
                    />
                  </div>
                  <div className="address-display compact">
                    {receiveType === 'wallet' ? wallet.walletAddress : wallet.ordAddress}
                  </div>
                  <button
                    className="copy-btn compact"
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
            <div className="modal-header">
              <h2 className="modal-title">Settings</h2>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="modal-content">
              {/* WALLET SECTION */}
              <div className="settings-section">
                <div className="settings-section-title">Wallet</div>
                <div className="settings-card">
                  <div className="settings-row" onClick={() => copyToClipboard(wallet.walletAddress, 'Payment address copied!')}>
                    <div className="settings-row-left">
                      <div className="settings-row-icon">💳</div>
                      <div className="settings-row-content">
                        <div className="settings-row-label">Payment Address</div>
                        <div className="settings-row-value">{wallet.walletAddress.slice(0, 12)}...{wallet.walletAddress.slice(-6)}</div>
                      </div>
                    </div>
                    <span className="settings-row-arrow">📋</span>
                  </div>
                  <div className="settings-row" onClick={() => copyToClipboard(wallet.ordAddress, 'Ordinals address copied!')}>
                    <div className="settings-row-left">
                      <div className="settings-row-icon">🎨</div>
                      <div className="settings-row-content">
                        <div className="settings-row-label">Ordinals Address</div>
                        <div className="settings-row-value">{wallet.ordAddress.slice(0, 12)}...{wallet.ordAddress.slice(-6)}</div>
                      </div>
                    </div>
                    <span className="settings-row-arrow">📋</span>
                  </div>
                  <div className="settings-row" onClick={() => copyToClipboard(wallet.identityPubKey, 'Identity key copied!')}>
                    <div className="settings-row-left">
                      <div className="settings-row-icon">🔑</div>
                      <div className="settings-row-content">
                        <div className="settings-row-label">Identity Key</div>
                        <div className="settings-row-value">{wallet.identityPubKey.slice(0, 12)}...{wallet.identityPubKey.slice(-6)}</div>
                      </div>
                    </div>
                    <span className="settings-row-arrow">📋</span>
                  </div>
                </div>
              </div>

              {/* TRANSACTION SECTION */}
              <div className="settings-section">
                <div className="settings-section-title">Transactions</div>
                <div className="settings-card">
                  <div className="settings-row">
                    <div className="settings-row-left">
                      <div className="settings-row-icon">⛽</div>
                      <div className="settings-row-content">
                        <div className="settings-row-label">Fee Rate</div>
                        <div className="settings-row-value">
                          <input
                            type="number"
                            min="1"
                            max="1000"
                            value={feeRateKB}
                            onChange={(e) => {
                              const val = parseInt(e.target.value) || 71
                              setFeeRateKB(val)
                              setFeeRateFromKB(val)
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              width: '60px',
                              padding: '4px 8px',
                              border: '1px solid var(--border)',
                              borderRadius: '6px',
                              background: 'var(--bg-primary)',
                              color: 'var(--text-primary)',
                              fontSize: '13px',
                              textAlign: 'right'
                            }}
                          /> sats/KB
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                    Default: 71 sats/KB. Most miners accept 50-100. Lower = cheaper, higher = faster confirmation.
                  </div>
                </div>
              </div>

              {/* SECURITY SECTION */}
              <div className="settings-section">
                <div className="settings-section-title">Security</div>
                <div className="settings-card">
                  {wallet.mnemonic && (
                    <div className="settings-row" onClick={() => {
                      if (confirm('Make sure no one can see your screen!')) {
                        alert(wallet.mnemonic)
                      }
                    }}>
                      <div className="settings-row-left">
                        <div className="settings-row-icon">📝</div>
                        <div className="settings-row-content">
                          <div className="settings-row-label">Recovery Phrase</div>
                          <div className="settings-row-value">12 words</div>
                        </div>
                      </div>
                      <span className="settings-row-arrow">→</span>
                    </div>
                  )}
                  <div className="settings-row" onClick={() => {
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
                      showToast('Keys copied to clipboard!')
                    }
                  }}>
                    <div className="settings-row-left">
                      <div className="settings-row-icon">🔐</div>
                      <div className="settings-row-content">
                        <div className="settings-row-label">Export Private Keys</div>
                        <div className="settings-row-value">Copy JSON to clipboard</div>
                      </div>
                    </div>
                    <span className="settings-row-arrow">→</span>
                  </div>
                </div>
              </div>

              {/* BACKUP SECTION */}
              <div className="settings-section">
                <div className="settings-section-title">Backup</div>
                <div className="settings-card">
                  <div className="settings-row" onClick={async () => {
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
                      const backupJson = JSON.stringify(fullBackup, null, 2)
                      const filePath = await save({
                        defaultPath: `simply-sats-backup-${new Date().toISOString().split('T')[0]}.json`,
                        filters: [{ name: 'JSON', extensions: ['json'] }]
                      })
                      if (filePath) {
                        await writeTextFile(filePath, backupJson)
                        showToast('Backup saved!')
                      }
                    } catch (err) {
                      showToast('Backup failed')
                    }
                  }}>
                    <div className="settings-row-left">
                      <div className="settings-row-icon">💾</div>
                      <div className="settings-row-content">
                        <div className="settings-row-label">Export Full Backup</div>
                        <div className="settings-row-value">Wallet + transactions</div>
                      </div>
                    </div>
                    <span className="settings-row-arrow">→</span>
                  </div>
                  <div className="settings-row" onClick={async () => {
                    try {
                      const filePath = await open({
                        filters: [{ name: 'JSON', extensions: ['json'] }],
                        multiple: false
                      })
                      if (!filePath || Array.isArray(filePath)) return
                      const json = await readTextFile(filePath)
                      const backup = JSON.parse(json)
                      if (backup.format !== 'simply-sats-full' || !backup.database) {
                        showToast('Invalid backup format')
                        return
                      }
                      if (confirm(`Import ${backup.database.utxos.length} UTXOs and ${backup.database.transactions.length} transactions?`)) {
                        await importDatabase(backup.database as DatabaseBackup)
                        showToast('Backup imported!')
                        performSync(false)
                      }
                    } catch (err) {
                      showToast('Import failed')
                    }
                  }}>
                    <div className="settings-row-left">
                      <div className="settings-row-icon">📥</div>
                      <div className="settings-row-content">
                        <div className="settings-row-label">Import Backup</div>
                        <div className="settings-row-value">Restore from file</div>
                      </div>
                    </div>
                    <span className="settings-row-arrow">→</span>
                  </div>
                </div>
              </div>

              {/* ADVANCED SECTION */}
              <div className="settings-section">
                <div className="settings-section-title">Advanced</div>
                <div className="settings-card">
                  <div className="settings-row" onClick={async () => {
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
                      setMessageBoxStatus('error')
                      showToast('MessageBox check failed')
                    }
                  }}>
                    <div className="settings-row-left">
                      <div className="settings-row-icon">{messageBoxStatus === 'checking' ? '🔄' : '📬'}</div>
                      <div className="settings-row-content">
                        <div className="settings-row-label">MessageBox (BRC-29)</div>
                        <div className="settings-row-value">{paymentNotifications.length} payment{paymentNotifications.length !== 1 ? 's' : ''} received</div>
                      </div>
                    </div>
                    <span className="settings-row-arrow">↻</span>
                  </div>
                  {!showSenderInput ? (
                    <div className="settings-row" onClick={() => setShowSenderInput(true)}>
                      <div className="settings-row-left">
                        <div className="settings-row-icon">👥</div>
                        <div className="settings-row-content">
                          <div className="settings-row-label">Known Senders (BRC-42/43)</div>
                          <div className="settings-row-value">{getKnownSenders().length} configured</div>
                        </div>
                      </div>
                      <span className="settings-row-arrow">+</span>
                    </div>
                  ) : (
                    <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="66 character hex public key"
                        value={senderInput}
                        onChange={e => setSenderInput(e.target.value)}
                        style={{ fontFamily: 'monospace', fontSize: 11, marginBottom: 8 }}
                      />
                      <div className="btn-group">
                        <button className="btn btn-secondary" onClick={() => { setShowSenderInput(false); setSenderInput('') }}>Cancel</button>
                        <button className="btn btn-primary" onClick={() => {
                          if (senderInput.length === 66) {
                            addKnownSender(senderInput)
                            setSenderInput('')
                            setShowSenderInput(false)
                            fetchData()
                            showToast('Sender added!')
                          } else {
                            showToast('Invalid: must be 66 hex chars')
                          }
                        }}>Add</button>
                      </div>
                    </div>
                  )}
                  {getKnownSenders().length > 0 && !showDebugInput && (
                    <div className="settings-row" onClick={() => setShowDebugInput(true)}>
                      <div className="settings-row-left">
                        <div className="settings-row-icon">🔍</div>
                        <div className="settings-row-content">
                          <div className="settings-row-label">Debug Invoice Finder</div>
                          <div className="settings-row-value">Search derived addresses</div>
                        </div>
                      </div>
                      <span className="settings-row-arrow">→</span>
                    </div>
                  )}
                  {showDebugInput && (
                    <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Target address (e.g. 172Hcm...)"
                        value={debugAddressInput}
                        onChange={e => setDebugAddressInput(e.target.value)}
                        style={{ fontFamily: 'monospace', fontSize: 11, marginBottom: 8 }}
                      />
                      <div className="btn-group">
                        <button className="btn btn-secondary" onClick={() => { setShowDebugInput(false); setDebugAddressInput(''); setDebugResult(null) }}>Cancel</button>
                        <button className="btn btn-primary" disabled={debugSearching || !debugAddressInput} onClick={() => {
                          if (!debugAddressInput) return
                          const senders = getKnownSenders()
                          if (senders.length === 0) { setDebugResult('❌ No known senders'); return }
                          setDebugSearching(true)
                          setDebugResult('🔍 Searching...')
                          setTimeout(() => {
                            try {
                              const identityPrivKey = PrivateKey.fromWif(wallet.identityWif)
                              for (const sender of senders) {
                                const result = debugFindInvoiceNumber(identityPrivKey, sender, debugAddressInput)
                                if (result.found) {
                                  setDebugResult(`✅ Found: "${result.invoiceNumber}"`)
                                  setDebugSearching(false)
                                  return
                                }
                              }
                              setDebugResult('❌ Not found')
                            } catch (e) {
                              setDebugResult('❌ Error')
                            }
                            setDebugSearching(false)
                          }, 100)
                        }}>{debugSearching ? 'Searching...' : 'Search'}</button>
                      </div>
                      {debugResult && <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 12, fontFamily: 'monospace' }}>{debugResult}</div>}
                    </div>
                  )}
                </div>
              </div>

              {/* CONNECTED APPS */}
              {connectedApps.length > 0 && (
                <div className="settings-section">
                  <div className="settings-section-title">Connected Apps</div>
                  <div className="settings-card">
                    {connectedApps.map(app => (
                      <div key={app} className="settings-row">
                        <div className="settings-row-left">
                          <div className="settings-row-icon">🔗</div>
                          <div className="settings-row-content">
                            <div className="settings-row-label">{app}</div>
                          </div>
                        </div>
                        <button className="app-disconnect" onClick={() => disconnectApp(app)}>Disconnect</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* DANGER ZONE */}
              <div className="settings-section">
                <div className="settings-section-title">Danger Zone</div>
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
                    // Calculate exact fee based on transaction size using configured fee rate
                    // P2PKH: ~10 bytes overhead + 148 bytes per input + 34 bytes per output
                    const numOutputs = brc100Request.params.outputs.length + 1 // outputs + change
                    const numInputs = Math.ceil((brc100Request.params.outputs.reduce((sum: number, o: any) => sum + (o.satoshis || 0), 0) + 200) / 10000) || 1
                    const txSize = 10 + (numInputs * 148) + (numOutputs * 34)
                    const fee = feeFromBytes(txSize)
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
