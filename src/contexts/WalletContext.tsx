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
  setFeeRateFromKB,
  transferOrdinal
} from '../services/wallet'
import { setWalletKeys } from '../services/brc100'
import { useNetwork, type NetworkInfo } from './NetworkContext'
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
  getSpendableUtxosFromDatabase,
  getOrdinalsFromDatabase
} from '../services/sync'
import {
  type Account,
  getAllAccounts,
  getActiveAccount,
  getAccountKeys,
  switchAccount as switchAccountDb,
  createAccount,
  deleteAccount as deleteAccountDb,
  updateAccountName,
  migrateToMultiAccount
} from '../services/accounts'
import {
  type TokenBalance,
  syncTokenBalances,
  sendToken
} from '../services/tokens'
import {
  initAutoLock,
  stopAutoLock,
  resetInactivityTimer,
  setInactivityLimit,
  minutesToMs
} from '../services/autoLock'

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

  // Multi-account state
  accounts: Account[]
  activeAccount: Account | null
  activeAccountId: number | null
  switchAccount: (accountId: number, password: string) => Promise<boolean>
  createNewAccount: (name: string, password: string) => Promise<boolean>
  deleteAccount: (accountId: number) => Promise<boolean>
  renameAccount: (accountId: number, name: string) => Promise<void>
  refreshAccounts: () => Promise<void>

  // Token state
  tokenBalances: TokenBalance[]
  refreshTokens: () => Promise<void>
  tokensSyncing: boolean

  // Lock state
  isLocked: boolean
  lockWallet: () => void
  unlockWallet: (password: string) => Promise<boolean>
  autoLockMinutes: number
  setAutoLockMinutes: (minutes: number) => void

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
  handleTransferOrdinal: (ordinal: Ordinal, toAddress: string) => Promise<{ success: boolean; txid?: string; error?: string }>
  handleSendToken: (ticker: string, protocol: 'bsv20' | 'bsv21', amount: string, toAddress: string) => Promise<{ success: boolean; txid?: string; error?: string }>

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
  const [utxos, setUtxos] = useState<UTXO[]>([])
  const [ordinals, setOrdinals] = useState<Ordinal[]>([])
  const [locks, setLocks] = useState<LockedUTXO[]>(() => {
    const cached = localStorage.getItem('simply_sats_locks')
    return cached ? JSON.parse(cached) : []
  })
  const [txHistory, setTxHistory] = useState<TxHistoryItem[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])

  // Multi-account state
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeAccount, setActiveAccount] = useState<Account | null>(null)
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null)

  // Token state
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([])
  const [tokensSyncing, setTokensSyncing] = useState(false)

  // Lock state
  const [isLocked, setIsLocked] = useState(false)
  const [autoLockMinutes, setAutoLockMinutesState] = useState<number>(() => {
    const saved = localStorage.getItem('simply_sats_auto_lock_minutes')
    return saved ? parseInt(saved, 10) : 10
  })

  // Track recently unlocked locks to prevent re-detection race condition
  // Keys are "txid:vout" strings
  const [knownUnlockedLocks, setKnownUnlockedLocks] = useState<Set<string>>(new Set())

  // Basket balances
  const [basketBalances, setBasketBalances] = useState<BasketBalances>({
    default: 0,
    ordinals: 0,
    identity: 0,
    derived: 0,
    locks: 0
  })

  // Get network state from NetworkContext
  const { networkInfo, syncing, setSyncing, usdPrice } = useNetwork()

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

  // Lock wallet (clear keys from memory)
  const lockWallet = useCallback(() => {
    console.log('[Wallet] Locking wallet')
    setIsLocked(true)
    // Clear sensitive data from memory
    setWalletState(null)
    setWalletKeys(null)
  }, [])

  // Unlock wallet with password
  const unlockWallet = useCallback(async (password: string): Promise<boolean> => {
    if (!activeAccount) {
      console.error('[Wallet] No active account to unlock')
      return false
    }

    try {
      const keys = await getAccountKeys(activeAccount, password)
      if (keys) {
        setWalletState(keys)
        setWalletKeys(keys)
        setIsLocked(false)
        resetInactivityTimer()
        console.log('[Wallet] Wallet unlocked')
        return true
      }
      return false
    } catch (e) {
      console.error('[Wallet] Failed to unlock:', e)
      return false
    }
  }, [activeAccount])

  // Set auto-lock timeout
  const setAutoLockMinutes = useCallback((minutes: number) => {
    setAutoLockMinutesState(minutes)
    localStorage.setItem('simply_sats_auto_lock_minutes', String(minutes))
    if (minutes > 0) {
      setInactivityLimit(minutesToMs(minutes))
    } else {
      stopAutoLock()
    }
  }, [])

  // Refresh accounts list
  const refreshAccounts = useCallback(async () => {
    try {
      const allAccounts = await getAllAccounts()
      setAccounts(allAccounts)

      const active = await getActiveAccount()
      if (active) {
        setActiveAccount(active)
        setActiveAccountId(active.id || null)
      }
    } catch (e) {
      console.error('[Wallet] Failed to refresh accounts:', e)
    }
  }, [])

  // Switch to a different account
  const switchAccount = useCallback(async (accountId: number, password: string): Promise<boolean> => {
    try {
      // Get the account
      const account = accounts.find(a => a.id === accountId)
      if (!account) {
        console.error('[Wallet] Account not found')
        return false
      }

      // Try to decrypt keys
      const keys = await getAccountKeys(account, password)
      if (!keys) {
        console.error('[Wallet] Invalid password')
        return false
      }

      // Switch in database
      const success = await switchAccountDb(accountId)
      if (!success) return false

      // Update state
      setActiveAccount(account)
      setActiveAccountId(accountId)
      setWallet(keys)
      setIsLocked(false)

      // Refresh data for new account
      await refreshAccounts()

      console.log(`[Wallet] Switched to account ${account.name}`)
      return true
    } catch (e) {
      console.error('[Wallet] Failed to switch account:', e)
      return false
    }
  }, [accounts, setWallet, refreshAccounts])

  // Create a new account
  const createNewAccount = useCallback(async (name: string, password: string): Promise<boolean> => {
    try {
      // Create new wallet keys
      const keys = createWallet()

      // Create account in database
      const accountId = await createAccount(name, keys, password)
      if (!accountId) return false

      // Set as active
      setWallet(keys)
      setIsLocked(false)

      // Refresh accounts
      await refreshAccounts()

      console.log(`[Wallet] Created new account: ${name}`)
      return true
    } catch (e) {
      console.error('[Wallet] Failed to create account:', e)
      return false
    }
  }, [setWallet, refreshAccounts])

  // Delete an account
  const deleteAccount = useCallback(async (accountId: number): Promise<boolean> => {
    try {
      const success = await deleteAccountDb(accountId)
      if (success) {
        await refreshAccounts()

        // If we deleted the active account, load the new active one
        const active = await getActiveAccount()
        if (active && wallet === null) {
          const keys = await getAccountKeys(active, '')
          if (keys) {
            setWallet(keys)
          }
        }
      }
      return success
    } catch (e) {
      console.error('[Wallet] Failed to delete account:', e)
      return false
    }
  }, [wallet, setWallet, refreshAccounts])

  // Rename an account
  const renameAccount = useCallback(async (accountId: number, name: string): Promise<void> => {
    await updateAccountName(accountId, name)
    await refreshAccounts()
  }, [refreshAccounts])

  // Refresh token balances
  const refreshTokens = useCallback(async () => {
    if (!wallet || tokensSyncing) return

    setTokensSyncing(true)
    try {
      const accountId = activeAccountId || 1
      const balances = await syncTokenBalances(
        accountId,
        wallet.walletAddress,
        wallet.ordAddress
      )
      setTokenBalances(balances)
      console.log(`[Tokens] Synced ${balances.length} token balances`)
    } catch (e) {
      console.error('[Tokens] Failed to sync tokens:', e)
    } finally {
      setTokensSyncing(false)
    }
  }, [wallet, activeAccountId, tokensSyncing])

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
        } catch (_e) {
          console.log('No cached transactions yet')
        }

        // Load accounts
        const allAccounts = await getAllAccounts()
        setAccounts(allAccounts)

        const active = await getActiveAccount()
        if (active) {
          setActiveAccount(active)
          setActiveAccountId(active.id || null)
        }
      } catch (err) {
        console.error('Failed to initialize database:', err)
      }

      // Try to load wallet (legacy support + new account system)
      if (hasWallet()) {
        try {
          const keys = await loadWallet('')
          if (keys) {
            setWallet(keys)

            // Migrate to multi-account if needed
            const allAccounts = await getAllAccounts()
            if (allAccounts.length === 0) {
              console.log('[Wallet] Migrating to multi-account system')
              await migrateToMultiAccount(keys, '')
              const accounts = await getAllAccounts()
              setAccounts(accounts)
              const active = await getActiveAccount()
              if (active) {
                setActiveAccount(active)
                setActiveAccountId(active.id || null)
              }
            }
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

  // Initialize auto-lock when wallet is loaded
  useEffect(() => {
    if (wallet && autoLockMinutes > 0) {
      console.log(`[AutoLock] Initializing with ${autoLockMinutes} minute timeout`)
      const cleanup = initAutoLock(lockWallet, minutesToMs(autoLockMinutes))
      return cleanup
    }
  }, [wallet, autoLockMinutes, lockWallet])

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
      } catch (_e) {
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

      // Get ordinals - first from database (already synced), then supplement with API calls
      try {
        // First get ordinals already in the database (synced from blockchain)
        const dbOrdinals = await getOrdinalsFromDatabase()
        console.log(`[WalletContext] Found ${dbOrdinals.length} ordinals in database`)

        // Also fetch from APIs for any that might not be in database yet
        console.log(`[WalletContext] Fetching additional ordinals from APIs...`)

        // Get derived addresses
        const derivedAddrs = await getDerivedAddresses()

        // Fetch from all addresses in parallel
        const [ordAddressOrdinals, walletAddressOrdinals, identityAddressOrdinals, ...derivedOrdinals] = await Promise.all([
          getOrdinals(wallet.ordAddress).catch(() => []),
          getOrdinals(wallet.walletAddress).catch(() => []),
          getOrdinals(wallet.identityAddress).catch(() => []),
          ...derivedAddrs.map(d => getOrdinals(d.address).catch(() => []))
        ])

        // Combine and deduplicate by origin
        const seen = new Set<string>()
        const allOrdinals = [
          ...dbOrdinals,  // Database ordinals first (most reliable)
          ...ordAddressOrdinals,
          ...walletAddressOrdinals,
          ...identityAddressOrdinals,
          ...derivedOrdinals.flat()
        ].filter(ord => {
          if (seen.has(ord.origin)) return false
          seen.add(ord.origin)
          return true
        })

        const derivedCount = derivedOrdinals.flat().length
        console.log(`[WalletContext] Got ${dbOrdinals.length} from database, ${ordAddressOrdinals.length} from ordAddress, ${walletAddressOrdinals.length} from walletAddress, ${identityAddressOrdinals.length} from identityAddress, ${derivedCount} from derived addresses, ${allOrdinals.length} total unique`)
        setOrdinals(allOrdinals)
      } catch (e) {
        console.error('[WalletContext] Failed to fetch ordinals:', e)
      }

      // Detect locks
      try {
        const utxoList = await getUTXOs(wallet.walletAddress)
        setUtxos(utxoList)
        // Pass knownUnlockedLocks to prevent re-adding recently unlocked locks
        const detectedLocks = await detectLockedUtxos(
          wallet.walletAddress,
          wallet.walletPubKey,
          knownUnlockedLocks
        )
        if (detectedLocks.length > 0) {
          setLocks(detectedLocks)
          localStorage.setItem('simply_sats_locks', JSON.stringify(detectedLocks))
        } else if (knownUnlockedLocks.size > 0) {
          // If we had unlocked locks and now there are none, clear the list
          setLocks([])
          localStorage.setItem('simply_sats_locks', JSON.stringify([]))
        }
      } catch (e) {
        console.error('Failed to detect locks:', e)
      }
    } catch (error) {
      console.error('Failed to fetch data:', error)
    }
  }, [wallet, knownUnlockedLocks])

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
          } catch (_e) {
            // Skip if can't get UTXOs for this address
          }
        }
      }

      // Deduplicate UTXOs by txid:vout to prevent double-spend attempts
      // Database and API sources can have overlapping UTXOs
      const seen = new Set<string>()
      const deduplicatedUtxos = extendedUtxos.filter(u => {
        const key = `${u.txid}:${u.vout}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      const txid = await sendBSVMultiKey(wallet.walletWif, address, amountSats, deduplicatedUtxos)
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

      // Add to known-unlocked set BEFORE removing from state and fetching data
      // This prevents the race condition where detectLockedUtxos re-adds the lock
      const lockKey = `${lock.txid}:${lock.vout}`
      setKnownUnlockedLocks(prev => new Set([...prev, lockKey]))

      const newLocks = locks.filter(l => l.txid !== lock.txid || l.vout !== lock.vout)
      setLocks(newLocks)
      localStorage.setItem('simply_sats_locks', JSON.stringify(newLocks))

      await fetchData()
      return { success: true, txid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unlock failed' }
    }
  }, [wallet, networkInfo, locks, fetchData])

  const handleTransferOrdinal = useCallback(async (
    ordinal: Ordinal,
    toAddress: string
  ): Promise<{ success: boolean; txid?: string; error?: string }> => {
    if (!wallet) return { success: false, error: 'No wallet loaded' }

    try {
      // Get funding UTXOs from the wallet
      const fundingUtxos = await getUTXOs(wallet.walletAddress)

      if (fundingUtxos.length === 0) {
        return { success: false, error: 'No funding UTXOs available for transfer fee' }
      }

      // Create the ordinal UTXO object
      const ordinalUtxo: UTXO = {
        txid: ordinal.txid,
        vout: ordinal.vout,
        satoshis: 1,
        script: '' // Will be fetched by transferOrdinal
      }

      const txid = await transferOrdinal(
        wallet.ordWif,
        ordinalUtxo,
        toAddress,
        wallet.walletWif,
        fundingUtxos
      )

      // Refresh data
      await fetchData()

      return { success: true, txid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Transfer failed' }
    }
  }, [wallet, fetchData])

  // Token send handler
  const handleSendToken = useCallback(async (
    ticker: string,
    protocol: 'bsv20' | 'bsv21',
    amount: string,
    toAddress: string
  ): Promise<{ success: boolean; txid?: string; error?: string }> => {
    if (!wallet) return { success: false, error: 'No wallet loaded' }

    try {
      // Get funding UTXOs from the wallet
      const fundingUtxos = await getUTXOs(wallet.walletAddress)

      if (fundingUtxos.length === 0) {
        return { success: false, error: 'No funding UTXOs available for transfer fee' }
      }

      const result = await sendToken(
        wallet.walletAddress,
        wallet.ordAddress,
        wallet.walletWif,
        wallet.ordWif,
        fundingUtxos,
        ticker,
        protocol,
        amount,
        toAddress
      )

      if (result.success) {
        // Refresh data
        await fetchData()
        await refreshTokens()
      }

      return result
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Token transfer failed' }
    }
  }, [wallet, fetchData, refreshTokens])

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
    // Wallet state
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

    // Multi-account state
    accounts,
    activeAccount,
    activeAccountId,
    switchAccount,
    createNewAccount,
    deleteAccount,
    renameAccount,
    refreshAccounts,

    // Token state
    tokenBalances,
    refreshTokens,
    tokensSyncing,

    // Lock state
    isLocked,
    lockWallet,
    unlockWallet,
    autoLockMinutes,
    setAutoLockMinutes,

    // Network state
    networkInfo,
    syncing,
    loading,

    // Settings
    displayInSats,
    toggleDisplayUnit,
    feeRateKB,
    setFeeRate,

    // Connected apps
    connectedApps,
    trustedOrigins,
    addTrustedOrigin,
    removeTrustedOrigin,
    disconnectApp,

    // Actions
    performSync,
    fetchData,
    handleCreateWallet,
    handleRestoreWallet,
    handleImportJSON,
    handleDeleteWallet,
    handleSend,
    handleLock,
    handleUnlock,
    handleTransferOrdinal,
    handleSendToken,

    // Utilities
    copyToClipboard,
    showToast,
    copyFeedback,

    // Format helpers
    formatBSVShort,
    formatUSD
  }

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}
