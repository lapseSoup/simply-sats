import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { WalletKeys, UTXO, LockedUTXO, Ordinal, ExtendedUTXO } from '../services/wallet'
import {
  createWallet,
  restoreWallet,
  importFromJSON,
  getBalance,
  getUTXOs,
  getOrdinals,
  sendBSVMultiKey,
  saveWallet,
  loadWallet,
  hasWallet,
  clearWallet,
  lockBSV,
  unlockBSV,
  detectLockedUtxos,
  getFeeRatePerKB,
  setFeeRateFromKB
} from '../services/wallet'
import {
  setWalletKeys,
  getNetworkStatus
} from '../services/brc100'
import {
  initDatabase,
  repairUTXOs,
  ensureDerivedAddressesTable,
  ensureContactsTable,
  getContacts,
  getAllTransactions,
  getDerivedAddresses,
  type Contact
} from '../services/database'
import {
  syncWallet,
  restoreFromBlockchain,
  getBalanceFromDatabase,
  getSpendableUtxosFromDatabase
} from '../services/sync'

interface NetworkInfo {
  blockHeight: number
  overlayHealthy: boolean
  overlayNodeCount: number
}

interface TxHistoryItem {
  tx_hash: string
  height: number
  amount?: number
  address?: string
}

interface BasketBalances {
  default: number
  ordinals: number
  identity: number
  derived: number
  locks: number
}

interface WalletContextType {
  // Wallet state
  wallet: WalletKeys | null
  setWallet: (wallet: WalletKeys | null) => void
  balance: number
  ordBalance: number
  usdPrice: number
  utxos: UTXO[]
  ordinals: Ordinal[]
  locks: LockedUTXO[]
  txHistory: TxHistoryItem[]
  basketBalances: BasketBalances
  contacts: Contact[]

  // Network state
  networkInfo: NetworkInfo | null
  syncing: boolean
  loading: boolean

  // Settings
  displayInSats: boolean
  toggleDisplayUnit: () => void
  feeRateKB: number
  setFeeRate: (rate: number) => void

  // Connected apps
  connectedApps: string[]
  trustedOrigins: string[]
  addTrustedOrigin: (origin: string) => void
  removeTrustedOrigin: (origin: string) => void
  disconnectApp: (origin: string) => void

  // Actions
  performSync: (isRestore?: boolean, forceReset?: boolean) => Promise<void>
  fetchData: () => Promise<void>
  handleCreateWallet: () => Promise<string | null>
  handleRestoreWallet: (mnemonic: string) => Promise<boolean>
  handleImportJSON: (json: string) => Promise<boolean>
  handleDeleteWallet: () => Promise<void>
  handleSend: (address: string, amountSats: number) => Promise<{ success: boolean; txid?: string; error?: string }>
  handleLock: (amountSats: number, blocks: number) => Promise<{ success: boolean; txid?: string; error?: string }>
  handleUnlock: (lock: LockedUTXO) => Promise<{ success: boolean; txid?: string; error?: string }>

  // Utilities
  copyToClipboard: (text: string, feedback?: string) => Promise<void>
  showToast: (message: string) => void
  copyFeedback: string | null

  // Format helpers
  formatBSVShort: (sats: number) => string
  formatUSD: (sats: number) => string
}

const WalletContext = createContext<WalletContextType | null>(null)

export function useWallet() {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}

interface WalletProviderProps {
  children: ReactNode
}

export function WalletProvider({ children }: WalletProviderProps) {
  // Core wallet state
  const [wallet, setWalletState] = useState<WalletKeys | null>(null)
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState<number>(() => {
    const cached = localStorage.getItem('simply_sats_cached_balance')
    return cached ? parseInt(cached, 10) : 0
  })
  const [ordBalance, setOrdBalance] = useState<number>(() => {
    const cached = localStorage.getItem('simply_sats_cached_ord_balance')
    return cached ? parseInt(cached, 10) : 0
  })
  const [usdPrice, setUsdPrice] = useState<number>(0)
  const [utxos, setUtxos] = useState<UTXO[]>([])
  const [ordinals, setOrdinals] = useState<Ordinal[]>([])
  const [locks, setLocks] = useState<LockedUTXO[]>(() => {
    const cached = localStorage.getItem('simply_sats_locks')
    return cached ? JSON.parse(cached) : []
  })
  const [txHistory, setTxHistory] = useState<TxHistoryItem[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])

  // Basket balances
  const [basketBalances, setBasketBalances] = useState<BasketBalances>({
    default: 0,
    ordinals: 0,
    identity: 0,
    derived: 0,
    locks: 0
  })

  // Network state
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null)
  const [syncing, setSyncing] = useState(false)

  // Settings
  const [displayInSats, setDisplayInSats] = useState<boolean>(() => {
    const saved = localStorage.getItem('simply_sats_display_sats')
    return saved === 'true'
  })
  const [feeRateKB, setFeeRateKBState] = useState<number>(() => getFeeRatePerKB())

  // Connected apps
  const [connectedApps, setConnectedApps] = useState<string[]>([])
  const [trustedOrigins, setTrustedOrigins] = useState<string[]>(() => {
    const saved = localStorage.getItem('simply_sats_trusted_origins')
    return saved ? JSON.parse(saved) : []
  })

  // UI feedback
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)

  // Set wallet and update BRC-100 service
  const setWallet = useCallback((newWallet: WalletKeys | null) => {
    setWalletState(newWallet)
    setWalletKeys(newWallet)
  }, [])

  // Initialize database and load wallet on mount
  useEffect(() => {
    const init = async () => {
      try {
        await initDatabase()
        console.log('Database initialized successfully')

        const repaired = await repairUTXOs()
        if (repaired > 0) {
          console.log(`Repaired ${repaired} UTXOs`)
        }

        await ensureDerivedAddressesTable()
        console.log('Derived addresses table ready')

        await ensureContactsTable()
        const loadedContacts = await getContacts()
        setContacts(loadedContacts)
        console.log('Loaded', loadedContacts.length, 'contacts')

        // Load transactions from database
        try {
          const dbTxs = await getAllTransactions(30)
          if (dbTxs.length > 0) {
            console.log('Loaded', dbTxs.length, 'transactions from database')
            setTxHistory(dbTxs.map(tx => ({
              tx_hash: tx.txid,
              height: tx.blockHeight || 0,
              amount: tx.amount
            })))
          }
        } catch (e) {
          console.log('No cached transactions yet')
        }
      } catch (err) {
        console.error('Failed to initialize database:', err)
      }

      if (hasWallet()) {
        try {
          const keys = await loadWallet('')
          if (keys) {
            setWallet(keys)
          }
        } catch (err) {
          console.error('Failed to load wallet:', err)
        }
      }
      setLoading(false)

      const savedApps = localStorage.getItem('simply_sats_connected_apps')
      if (savedApps) {
        setConnectedApps(JSON.parse(savedApps))
      }
    }
    init()
  }, [setWallet])

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

  // Fetch USD price
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate')
        const data = await res.json()
        if (data?.rate) {
          setUsdPrice(data.rate)
        }
      } catch (e) {
        console.error('Failed to fetch USD price:', e)
      }
    }
    fetchPrice()
    const interval = setInterval(fetchPrice, 60000)
    return () => clearInterval(interval)
  }, [])

  // Sync wallet with blockchain
  const performSync = useCallback(async (isRestore = false, _forceReset = false) => {
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
      console.log('Sync complete')

      // Update basket balances from database
      try {
        const [defaultBal, ordBal, idBal, lockBal, derivedBal] = await Promise.all([
          getBalanceFromDatabase('default'),
          getBalanceFromDatabase('ordinals'),
          getBalanceFromDatabase('identity'),
          getBalanceFromDatabase('locks'),
          getBalanceFromDatabase('derived')
        ])

        setBasketBalances({
          default: defaultBal,
          ordinals: ordBal,
          identity: idBal,
          locks: lockBal,
          derived: derivedBal
        })

        const totalBalance = defaultBal + derivedBal
        setBalance(totalBalance)
        localStorage.setItem('simply_sats_cached_balance', String(totalBalance))
      } catch (e) {
        console.error('Failed to get basket balances:', e)
      }
    } catch (error) {
      console.error('Sync failed:', error)
    } finally {
      setSyncing(false)
    }
  }, [wallet, syncing])

  // Fetch data from database and API
  const fetchData = useCallback(async () => {
    if (!wallet) return

    console.log('Fetching data (database-first approach)...')

    try {
      const [defaultBal, derivedBal] = await Promise.all([
        getBalanceFromDatabase('default'),
        getBalanceFromDatabase('derived')
      ])
      const totalBalance = defaultBal + derivedBal
      setBalance(totalBalance)
      localStorage.setItem('simply_sats_cached_balance', String(totalBalance))

      // Get ordinals balance from API
      try {
        const [ordBal, idBal] = await Promise.all([
          getBalance(wallet.ordAddress),
          getBalance(wallet.identityAddress)
        ])
        const totalOrdBalance = ordBal + idBal
        if (totalOrdBalance > 0) {
          setOrdBalance(totalOrdBalance)
          localStorage.setItem('simply_sats_cached_ord_balance', String(totalOrdBalance))
        }
      } catch (e) {
        const cached = parseInt(localStorage.getItem('simply_sats_cached_ord_balance') || '0', 10)
        if (cached > 0) setOrdBalance(cached)
      }

      // Get transaction history from DATABASE
      const dbTxs = await getAllTransactions(30)
      const dbTxHistory: TxHistoryItem[] = dbTxs.map(tx => ({
        tx_hash: tx.txid,
        height: tx.blockHeight || 0,
        amount: tx.amount
      }))

      dbTxHistory.sort((a, b) => {
        const aHeight = a.height || 0
        const bHeight = b.height || 0
        if (aHeight === 0 && bHeight !== 0) return -1
        if (bHeight === 0 && aHeight !== 0) return 1
        return bHeight - aHeight
      })

      setTxHistory(dbTxHistory)

      // Get ordinals
      try {
        const ords = await getOrdinals(wallet.ordAddress)
        setOrdinals(ords)
      } catch (e) {
        console.error('Failed to fetch ordinals:', e)
      }

      // Detect locks
      try {
        const utxoList = await getUTXOs(wallet.walletAddress)
        setUtxos(utxoList)
        const detectedLocks = await detectLockedUtxos(wallet.walletAddress, wallet.walletPubKey)
        if (detectedLocks.length > 0) {
          setLocks(detectedLocks)
          localStorage.setItem('simply_sats_locks', JSON.stringify(detectedLocks))
        }
      } catch (e) {
        console.error('Failed to detect locks:', e)
      }
    } catch (error) {
      console.error('Failed to fetch data:', error)
    }
  }, [wallet])

  // Wallet actions
  const handleCreateWallet = useCallback(async (): Promise<string | null> => {
    try {
      const keys = createWallet()
      await saveWallet(keys, '')
      setWallet({ ...keys })
      return keys.mnemonic || null
    } catch (err) {
      console.error('Failed to create wallet:', err)
      return null
    }
  }, [setWallet])

  const handleRestoreWallet = useCallback(async (mnemonic: string): Promise<boolean> => {
    try {
      const keys = restoreWallet(mnemonic.trim())
      await saveWallet(keys, '')
      setWallet({ ...keys, mnemonic: mnemonic.trim() })
      return true
    } catch (err) {
      console.error('Failed to restore wallet:', err)
      return false
    }
  }, [setWallet])

  const handleImportJSON = useCallback(async (json: string): Promise<boolean> => {
    try {
      const keys = await importFromJSON(json)
      await saveWallet(keys, '')
      setWallet(keys)
      return true
    } catch (err) {
      console.error('Failed to import JSON:', err)
      return false
    }
  }, [setWallet])

  const handleDeleteWallet = useCallback(async () => {
    await clearWallet()
    setWallet(null)
    setBalance(0)
    setOrdBalance(0)
    setOrdinals([])
    setLocks([])
    setTxHistory([])
    setConnectedApps([])
  }, [setWallet])

  const handleSend = useCallback(async (address: string, amountSats: number): Promise<{ success: boolean; txid?: string; error?: string }> => {
    if (!wallet) return { success: false, error: 'No wallet loaded' }

    try {
      // Get spendable UTXOs from database
      const spendableUtxos = await getSpendableUtxosFromDatabase()

      // Convert to ExtendedUTXO format with WIF
      // Note: database UTXOs use 'lockingScript', ExtendedUTXO uses 'script'
      const extendedUtxos: ExtendedUTXO[] = spendableUtxos.map(u => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.lockingScript || '',
        wif: wallet.walletWif,
        address: wallet.walletAddress
      }))

      // Also include derived address UTXOs if available
      const derivedAddrs = await getDerivedAddresses()
      for (const derived of derivedAddrs) {
        if (derived.privateKeyWif) {
          try {
            const derivedUtxos = await getUTXOs(derived.address)
            for (const u of derivedUtxos) {
              extendedUtxos.push({
                ...u,
                wif: derived.privateKeyWif,
                address: derived.address
              })
            }
          } catch (e) {
            // Skip if can't get UTXOs for this address
          }
        }
      }

      const txid = await sendBSVMultiKey(wallet.walletWif, address, amountSats, extendedUtxos)
      await fetchData()
      return { success: true, txid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Send failed' }
    }
  }, [wallet, fetchData])

  const handleLock = useCallback(async (amountSats: number, blocks: number): Promise<{ success: boolean; txid?: string; error?: string }> => {
    if (!wallet) return { success: false, error: 'No wallet loaded' }

    const currentHeight = networkInfo?.blockHeight
    if (!currentHeight) return { success: false, error: 'Could not get block height' }

    try {
      const unlockBlock = currentHeight + blocks
      const walletUtxos = await getUTXOs(wallet.walletAddress)

      const result = await lockBSV(wallet.walletWif, amountSats, unlockBlock, walletUtxos)

      // Add the locked UTXO to our list
      const newLocks = [...locks, result.lockedUtxo]
      setLocks(newLocks)
      localStorage.setItem('simply_sats_locks', JSON.stringify(newLocks))

      await fetchData()
      return { success: true, txid: result.txid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Lock failed' }
    }
  }, [wallet, networkInfo, locks, fetchData])

  const handleUnlock = useCallback(async (lock: LockedUTXO): Promise<{ success: boolean; txid?: string; error?: string }> => {
    if (!wallet) return { success: false, error: 'No wallet loaded' }

    const currentHeight = networkInfo?.blockHeight
    if (!currentHeight) return { success: false, error: 'Could not get block height' }

    try {
      const txid = await unlockBSV(wallet.walletWif, lock, currentHeight)

      const newLocks = locks.filter(l => l.txid !== lock.txid)
      setLocks(newLocks)
      localStorage.setItem('simply_sats_locks', JSON.stringify(newLocks))

      await fetchData()
      return { success: true, txid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unlock failed' }
    }
  }, [wallet, networkInfo, locks, fetchData])

  // Settings
  const toggleDisplayUnit = useCallback(() => {
    const newValue = !displayInSats
    setDisplayInSats(newValue)
    localStorage.setItem('simply_sats_display_sats', String(newValue))
  }, [displayInSats])

  const setFeeRate = useCallback((rate: number) => {
    setFeeRateKBState(rate)
    setFeeRateFromKB(rate)
  }, [])

  // Trusted origins
  const addTrustedOrigin = useCallback((origin: string) => {
    if (!trustedOrigins.includes(origin)) {
      const newOrigins = [...trustedOrigins, origin]
      localStorage.setItem('simply_sats_trusted_origins', JSON.stringify(newOrigins))
      setTrustedOrigins(newOrigins)
    }
  }, [trustedOrigins])

  const removeTrustedOrigin = useCallback((origin: string) => {
    const newOrigins = trustedOrigins.filter(o => o !== origin)
    localStorage.setItem('simply_sats_trusted_origins', JSON.stringify(newOrigins))
    setTrustedOrigins(newOrigins)
  }, [trustedOrigins])

  const disconnectApp = useCallback((origin: string) => {
    const newConnectedApps = connectedApps.filter(app => app !== origin)
    setConnectedApps(newConnectedApps)
    localStorage.setItem('simply_sats_connected_apps', JSON.stringify(newConnectedApps))
  }, [connectedApps])

  // Utilities
  const copyToClipboard = useCallback(async (text: string, feedback = 'Copied!') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyFeedback(feedback)
      setTimeout(() => setCopyFeedback(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [])

  const showToast = useCallback((message: string) => {
    setCopyFeedback(message)
    setTimeout(() => setCopyFeedback(null), 2000)
  }, [])

  // Format helpers
  const formatBSVShort = useCallback((sats: number) => {
    const bsv = sats / 100000000
    if (bsv >= 1) return bsv.toFixed(4)
    if (bsv >= 0.01) return bsv.toFixed(6)
    return bsv.toFixed(8)
  }, [])

  const formatUSD = useCallback((sats: number) => {
    return ((sats / 100000000) * usdPrice).toFixed(2)
  }, [usdPrice])

  const value: WalletContextType = {
    wallet,
    setWallet,
    balance,
    ordBalance,
    usdPrice,
    utxos,
    ordinals,
    locks,
    txHistory,
    basketBalances,
    contacts,
    networkInfo,
    syncing,
    loading,
    displayInSats,
    toggleDisplayUnit,
    feeRateKB,
    setFeeRate,
    connectedApps,
    trustedOrigins,
    addTrustedOrigin,
    removeTrustedOrigin,
    disconnectApp,
    performSync,
    fetchData,
    handleCreateWallet,
    handleRestoreWallet,
    handleImportJSON,
    handleDeleteWallet,
    handleSend,
    handleLock,
    handleUnlock,
    copyToClipboard,
    showToast,
    copyFeedback,
    formatBSVShort,
    formatUSD
  }

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}
