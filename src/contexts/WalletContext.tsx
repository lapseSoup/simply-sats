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
import { useAccounts } from './AccountsContext'
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
  migrateToMultiAccount
} from '../services/accounts'
import { type TokenBalance } from '../services/tokens'
import { useTokens } from './TokensContext'
import {
  initAutoLock,
  stopAutoLock,
  resetInactivityTimer,
  setInactivityLimit,
  minutesToMs
} from '../services/autoLock'
import { isValidOrigin, normalizeOrigin } from '../utils/validation'
import { validatePassword, MIN_PASSWORD_LENGTH } from '../utils/passwordValidation'
import { walletLogger, syncLogger, uiLogger } from '../services/logger'
import {
  checkUnlockRateLimit,
  recordFailedUnlockAttempt,
  recordSuccessfulUnlock,
  formatLockoutTime
} from '../services/rateLimiter'
import {
  secureGetJSON,
  secureSetJSON,
  migrateToSecureStorage
} from '../services/secureStorage'
import { audit } from '../services/auditLog'

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
  switchAccount: (accountId: number) => Promise<boolean>
  createNewAccount: (name: string) => Promise<boolean>
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
  feeRateKB: number
  setFeeRate: (rate: number) => void

  // Connected apps
  connectedApps: string[]
  trustedOrigins: string[]
  addTrustedOrigin: (origin: string) => boolean
  removeTrustedOrigin: (origin: string) => void
  disconnectApp: (origin: string) => void

  // Actions
  performSync: (isRestore?: boolean, forceReset?: boolean) => Promise<void>
  fetchData: () => Promise<void>
  handleCreateWallet: (password: string) => Promise<string | null>
  handleRestoreWallet: (mnemonic: string, password: string) => Promise<boolean>
  handleImportJSON: (json: string, password: string) => Promise<boolean>
  handleDeleteWallet: () => Promise<void>
  handleSend: (address: string, amountSats: number) => Promise<{ success: boolean; txid?: string; error?: string }>
  handleLock: (amountSats: number, blocks: number) => Promise<{ success: boolean; txid?: string; error?: string }>
  handleUnlock: (lock: LockedUTXO) => Promise<{ success: boolean; txid?: string; error?: string }>
  handleTransferOrdinal: (ordinal: Ordinal, toAddress: string) => Promise<{ success: boolean; txid?: string; error?: string }>
  handleSendToken: (ticker: string, protocol: 'bsv20' | 'bsv21', amount: string, toAddress: string) => Promise<{ success: boolean; txid?: string; error?: string }>

}

const WalletContext = createContext<WalletContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
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
  const [locks, setLocks] = useState<LockedUTXO[]>([])
  const [txHistory, setTxHistory] = useState<TxHistoryItem[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])

  // Get multi-account state from AccountsContext
  const {
    accounts,
    activeAccount,
    activeAccountId,
    switchAccount: accountsSwitchAccount,
    createNewAccount: accountsCreateNewAccount,
    deleteAccount: accountsDeleteAccount,
    renameAccount,
    refreshAccounts,
    getKeysForAccount
  } = useAccounts()

  // Token state from TokensContext
  const {
    tokenBalances,
    tokensSyncing,
    refreshTokens: tokensRefresh,
    sendTokenAction
  } = useTokens()

  // Lock state
  const [isLocked, setIsLocked] = useState(false)
  const [autoLockMinutes, setAutoLockMinutesState] = useState<number>(() => {
    const saved = localStorage.getItem('simply_sats_auto_lock_minutes')
    return saved ? parseInt(saved, 10) : 10
  })

  // Session password - stored in memory only while wallet is unlocked
  // Used for creating new accounts without re-prompting
  const [sessionPassword, setSessionPassword] = useState<string | null>(null)

  // Debug: log when session password changes
  useEffect(() => {
    walletLogger.debug('Session password state changed', { hasPassword: !!sessionPassword })
  }, [sessionPassword])

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
  const [feeRateKB, setFeeRateKBState] = useState<number>(() => getFeeRatePerKB())

  // Connected apps (loaded asynchronously from secure storage)
  const [connectedApps, setConnectedApps] = useState<string[]>([])
  const [trustedOrigins, setTrustedOrigins] = useState<string[]>([])


  // Set wallet and update BRC-100 service
  const setWallet = useCallback((newWallet: WalletKeys | null) => {
    setWalletState(newWallet)
    setWalletKeys(newWallet)
  }, [])

  // Lock wallet (clear keys from memory)
  const lockWallet = useCallback(() => {
    walletLogger.info('Locking wallet')
    setIsLocked(true)
    // Clear sensitive data from memory
    setWalletState(null)
    setWalletKeys(null)
    setSessionPassword(null) // Clear session password on lock
    // Audit log wallet lock
    audit.walletLocked(activeAccountId ?? undefined)
  }, [activeAccountId])

  // Unlock wallet with password (with rate limiting)
  const unlockWallet = useCallback(async (password: string): Promise<boolean> => {
    // Check rate limit before attempting unlock
    const rateLimit = checkUnlockRateLimit()
    if (rateLimit.isLimited) {
      const timeStr = formatLockoutTime(rateLimit.remainingMs)
      walletLogger.warn('Unlock blocked by rate limit', { remainingMs: rateLimit.remainingMs })
      throw new Error(`Too many failed attempts. Please wait ${timeStr} before trying again.`)
    }

    try {
      // Try to get active account from state, or fetch from database
      let account = activeAccount
      if (!account) {
        walletLogger.debug('No active account in state, fetching from database...')
        account = await getActiveAccount()
        if (!account) {
          // No accounts at all - try to get first available account
          const allAccounts = await getAllAccounts()
          if (allAccounts.length > 0) {
            account = allAccounts[0]
          }
        }
      }

      if (!account) {
        walletLogger.error('No account found to unlock')
        return false
      }

      const keys = await getKeysForAccount(account, password)
      if (keys) {
        recordSuccessfulUnlock()
        setWalletState(keys)
        setWalletKeys(keys)
        setIsLocked(false)
        setSessionPassword(password) // Store password for session operations
        walletLogger.debug('Session password stored for account switching')
        resetInactivityTimer()
        // Refresh accounts to ensure state is in sync
        await refreshAccounts()
        walletLogger.info('Wallet unlocked successfully')
        // Audit log successful unlock
        audit.walletUnlocked(account.id)
        return true
      }

      // Record failed attempt and check for lockout
      const result = recordFailedUnlockAttempt()
      // Audit log failed unlock
      audit.unlockFailed(account.id, 'incorrect_password')
      if (result.isLocked) {
        const timeStr = formatLockoutTime(result.lockoutMs)
        throw new Error(`Too many failed attempts. Please wait ${timeStr} before trying again.`)
      } else if (result.attemptsRemaining <= 2) {
        walletLogger.warn('Few unlock attempts remaining', { remaining: result.attemptsRemaining })
      }

      walletLogger.warn('Failed to decrypt keys - incorrect password')
      return false
    } catch (e) {
      // Re-throw rate limit errors
      if (e instanceof Error && e.message.includes('Too many failed attempts')) {
        throw e
      }
      walletLogger.error('Failed to unlock', e)
      return false
    }
  }, [activeAccount, getKeysForAccount, refreshAccounts])

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


  // Switch to a different account using session password
  const switchAccount = useCallback(async (accountId: number): Promise<boolean> => {
    walletLogger.debug('switchAccount called', { accountId, hasSessionPassword: !!sessionPassword })
    if (!sessionPassword) {
      walletLogger.error('Cannot switch account - no session password available. User must re-unlock wallet.')
      return false
    }
    try {
      const keys = await accountsSwitchAccount(accountId, sessionPassword)
      if (keys) {
        setWallet(keys)
        setIsLocked(false)
        walletLogger.info('Account switched successfully', { accountId })
        return true
      }
      walletLogger.error('Failed to switch account - invalid password or account not found')
      return false
    } catch (e) {
      walletLogger.error('Error switching account', e)
      return false
    }
  }, [accountsSwitchAccount, setWallet, sessionPassword])

  // Create a new account - wraps AccountsContext to also set wallet state
  // Create a new account using session password
  const createNewAccount = useCallback(async (name: string): Promise<boolean> => {
    if (!sessionPassword) {
      walletLogger.error('Cannot create account - no session password available')
      return false
    }
    const keys = await accountsCreateNewAccount(name, sessionPassword)
    if (keys) {
      setWallet(keys)
      setIsLocked(false)
      return true
    }
    return false
  }, [accountsCreateNewAccount, setWallet, sessionPassword])

  // Delete an account - wraps AccountsContext, may need to load new active account
  const deleteAccount = useCallback(async (accountId: number): Promise<boolean> => {
    const success = await accountsDeleteAccount(accountId)
    if (success) {
      // If we deleted the active account, load the new active one
      const active = await getActiveAccount()
      if (active && wallet === null) {
        const keys = await getKeysForAccount(active, '')
        if (keys) {
          setWallet(keys)
        }
      }
    }
    return success
  }, [accountsDeleteAccount, wallet, setWallet, getKeysForAccount])


  // Refresh token balances - wraps TokensContext to pass wallet
  const refreshTokens = useCallback(async () => {
    if (!wallet) return
    const accountId = activeAccountId || 1
    await tokensRefresh(wallet, accountId)
  }, [wallet, activeAccountId, tokensRefresh])

  // Initialize database and load wallet on mount
  useEffect(() => {
    let mounted = true

    const init = async () => {
      try {
        // Migrate any existing unencrypted sensitive data
        await migrateToSecureStorage()
        if (!mounted) return

        // Load trusted origins from secure storage
        const savedOrigins = await secureGetJSON<string[]>('trusted_origins')
        if (savedOrigins && mounted) {
          setTrustedOrigins(savedOrigins)
        }

        // Load connected apps from secure storage
        const savedApps = await secureGetJSON<string[]>('connected_apps')
        if (savedApps && mounted) {
          setConnectedApps(savedApps)
        }

        await initDatabase()
        if (!mounted) return
        uiLogger.info('Database initialized successfully')

        const repaired = await repairUTXOs()
        if (!mounted) return
        if (repaired > 0) {
          uiLogger.info('Repaired UTXOs', { count: repaired })
        }

        await ensureDerivedAddressesTable()
        if (!mounted) return
        uiLogger.debug('Derived addresses table ready')

        await ensureContactsTable()
        if (!mounted) return
        const loadedContacts = await getContacts()
        if (!mounted) return
        setContacts(loadedContacts)
        uiLogger.info('Loaded contacts', { count: loadedContacts.length })

        // Note: Transactions are loaded per-account in fetchData, not here
        // This prevents showing wrong account's transactions on startup

        // Load accounts from AccountsContext
        await refreshAccounts()
        if (!mounted) return
      } catch (err) {
        uiLogger.error('Failed to initialize database', err)
      }

      if (!mounted) return

      // Try to load wallet (legacy support + new account system)
      if (hasWallet()) {
        // Check if we have accounts in the database
        const allAccounts = await getAllAccounts()
        if (!mounted) return

        if (allAccounts.length > 0) {
          // We have accounts - wallet is encrypted, show lock screen
          walletLogger.info('Found encrypted wallet with accounts, showing lock screen')
          setIsLocked(true)
          // Don't try to load wallet - it requires password
        } else {
          // No accounts yet - try loading with empty password (legacy unencrypted support)
          try {
            const keys = await loadWallet('')
            if (!mounted) return
            if (keys) {
              setWallet(keys)
              // Migrate to multi-account system
              walletLogger.info('Migrating to multi-account system')
              await migrateToMultiAccount(keys, '')
              if (!mounted) return
              await refreshAccounts()
            }
          } catch (_err) {
            // Wallet exists but couldn't load - it's encrypted, show lock screen
            if (!mounted) return
            walletLogger.info('Wallet is encrypted, showing lock screen')
            setIsLocked(true)
          }
        }
      }
      if (!mounted) return
      setLoading(false)

      const savedApps = localStorage.getItem('simply_sats_connected_apps')
      if (savedApps) {
        setConnectedApps(JSON.parse(savedApps))
      }
    }
    init()

    return () => {
      mounted = false
    }
  }, [setWallet, refreshAccounts])

  // Migration: remove old localStorage locks (database is source of truth)
  useEffect(() => {
    localStorage.removeItem('simply_sats_locks')
  }, [])

  // Initialize auto-lock when wallet is loaded
  useEffect(() => {
    if (wallet && autoLockMinutes > 0) {
      walletLogger.debug('AutoLock initializing', { timeoutMinutes: autoLockMinutes })
      const cleanup = initAutoLock(lockWallet, minutesToMs(autoLockMinutes))
      return cleanup
    }
  }, [wallet, autoLockMinutes, lockWallet])

  // Sync wallet with blockchain
  const performSync = useCallback(async (isRestore = false, _forceReset = false) => {
    if (!wallet || syncing) return

    setSyncing(true)
    try {
      syncLogger.info('Starting wallet sync...', { accountId: activeAccountId })
      if (isRestore) {
        await restoreFromBlockchain(
          wallet.walletAddress,
          wallet.ordAddress,
          wallet.identityAddress,
          activeAccountId || undefined
        )
      } else {
        await syncWallet(
          wallet.walletAddress,
          wallet.ordAddress,
          wallet.identityAddress,
          activeAccountId || undefined
        )
      }
      syncLogger.info('Sync complete')

      // Update basket balances from database (scoped to account)
      try {
        const [defaultBal, ordBal, idBal, lockBal, derivedBal] = await Promise.all([
          getBalanceFromDatabase('default', activeAccountId || undefined),
          getBalanceFromDatabase('ordinals', activeAccountId || undefined),
          getBalanceFromDatabase('identity', activeAccountId || undefined),
          getBalanceFromDatabase('locks', activeAccountId || undefined),
          getBalanceFromDatabase('derived', activeAccountId || undefined)
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
        syncLogger.error('Failed to get basket balances', e)
      }
    } catch (error) {
      syncLogger.error('Sync failed', error)
    } finally {
      setSyncing(false)
    }
  }, [wallet, syncing, setSyncing, activeAccountId])

  // Fetch data from database and API
  const fetchData = useCallback(async () => {
    if (!wallet) return

    const effectiveAccountId = activeAccountId || undefined
    syncLogger.debug('Fetching data (database-first approach)...', {
      activeAccountId,
      effectiveAccountId,
      walletAddress: wallet.walletAddress.slice(0, 12) + '...'
    })

    try {
      const [defaultBal, derivedBal] = await Promise.all([
        getBalanceFromDatabase('default', activeAccountId || undefined),
        getBalanceFromDatabase('derived', activeAccountId || undefined)
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

      // Get transaction history from DATABASE (scoped to account)
      console.log('[FETCH DEBUG] Calling getAllTransactions with accountId:', activeAccountId)
      const dbTxs = await getAllTransactions(30, activeAccountId || undefined)
      console.log('[FETCH DEBUG] Got', dbTxs.length, 'transactions:', dbTxs.map(tx => tx.txid.slice(0, 8)))
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
        // First get ordinals already in the database (synced from blockchain, scoped to account)
        const dbOrdinals = await getOrdinalsFromDatabase(activeAccountId || undefined)
        syncLogger.debug('Found ordinals in database', { count: dbOrdinals.length, accountId: activeAccountId })

        // Also fetch from APIs for any that might not be in database yet
        syncLogger.debug('Fetching additional ordinals from APIs...')

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
        syncLogger.debug('Ordinals fetched', {
          fromDatabase: dbOrdinals.length,
          fromOrdAddress: ordAddressOrdinals.length,
          fromWalletAddress: walletAddressOrdinals.length,
          fromIdentityAddress: identityAddressOrdinals.length,
          fromDerived: derivedCount,
          totalUnique: allOrdinals.length
        })
        setOrdinals(allOrdinals)
      } catch (e) {
        syncLogger.error('Failed to fetch ordinals', e)
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
        } else if (knownUnlockedLocks.size > 0) {
          // If we had unlocked locks and now there are none, clear the list
          setLocks([])
        }
      } catch (e) {
        walletLogger.error('Failed to detect locks', e)
      }
    } catch (error) {
      syncLogger.error('Failed to fetch data', error)
    }
  }, [wallet, knownUnlockedLocks, activeAccountId])

  // Wallet actions
  const handleCreateWallet = useCallback(async (password: string): Promise<string | null> => {
    const validation = validatePassword(password)
    if (!validation.isValid) {
      throw new Error(validation.errors[0] || `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    }
    try {
      const keys = createWallet()
      await saveWallet(keys, password)
      // Create account in database for persistence across app restarts
      // Use legacy password requirements since we've already validated length above
      await migrateToMultiAccount(keys, password)
      await refreshAccounts()
      setWallet({ ...keys })
      // Audit log wallet creation
      audit.walletCreated()
      return keys.mnemonic || null
    } catch (err) {
      walletLogger.error('Failed to create wallet', err)
      return null
    }
  }, [setWallet, refreshAccounts])

  const handleRestoreWallet = useCallback(async (mnemonic: string, password: string): Promise<boolean> => {
    const validation = validatePassword(password)
    if (!validation.isValid) {
      throw new Error(validation.errors[0] || `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    }
    try {
      const keys = restoreWallet(mnemonic.trim())
      await saveWallet(keys, password)
      // Create account in database for persistence across app restarts
      await migrateToMultiAccount({ ...keys, mnemonic: mnemonic.trim() }, password)
      await refreshAccounts()
      setWallet({ ...keys, mnemonic: mnemonic.trim() })
      // Audit log wallet restoration
      audit.walletRestored()
      return true
    } catch (err) {
      walletLogger.error('Failed to restore wallet', err)
      return false
    }
  }, [setWallet, refreshAccounts])

  const handleImportJSON = useCallback(async (json: string, password: string): Promise<boolean> => {
    const validation = validatePassword(password)
    if (!validation.isValid) {
      throw new Error(validation.errors[0] || `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    }
    try {
      const keys = await importFromJSON(json)
      await saveWallet(keys, password)
      // Create account in database for persistence across app restarts
      await migrateToMultiAccount(keys, password)
      await refreshAccounts()
      setWallet(keys)
      return true
    } catch (err) {
      walletLogger.error('Failed to import JSON', err)
      return false
    }
  }, [setWallet, refreshAccounts])

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
      // Audit log successful send
      audit.transactionSent(txid, amountSats, activeAccountId ?? undefined)
      return { success: true, txid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Send failed' }
    }
  }, [wallet, fetchData, activeAccountId])

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

      await fetchData()
      // Audit log lock creation
      audit.lockCreated(result.txid, amountSats, unlockBlock, activeAccountId ?? undefined)
      return { success: true, txid: result.txid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Lock failed' }
    }
  }, [wallet, networkInfo, locks, fetchData, activeAccountId])

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

      await fetchData()
      // Audit log lock release
      audit.lockReleased(txid, lock.satoshis, activeAccountId ?? undefined)
      return { success: true, txid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unlock failed' }
    }
  }, [wallet, networkInfo, locks, fetchData, activeAccountId])

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

  // Token send handler - wraps TokensContext sendTokenAction
  const handleSendToken = useCallback(async (
    ticker: string,
    protocol: 'bsv20' | 'bsv21',
    amount: string,
    toAddress: string
  ): Promise<{ success: boolean; txid?: string; error?: string }> => {
    if (!wallet) return { success: false, error: 'No wallet loaded' }

    const result = await sendTokenAction(wallet, ticker, protocol, amount, toAddress)

    if (result.success) {
      // Refresh data after successful send
      await fetchData()
      await refreshTokens()
    }

    return result
  }, [wallet, fetchData, refreshTokens, sendTokenAction])

  // Settings
  const setFeeRate = useCallback((rate: number) => {
    setFeeRateKBState(rate)
    setFeeRateFromKB(rate)
  }, [])

  // Trusted origins (using secure storage)
  const addTrustedOrigin = useCallback((origin: string) => {
    if (!isValidOrigin(origin)) {
      walletLogger.warn('Invalid origin format', { origin })
      return false
    }
    const normalized = normalizeOrigin(origin)
    if (!trustedOrigins.includes(normalized)) {
      const newOrigins = [...trustedOrigins, normalized]
      // Save to secure storage (async, fire-and-forget)
      secureSetJSON('trusted_origins', newOrigins).catch(e => {
        walletLogger.error('Failed to save trusted origins', e)
      })
      setTrustedOrigins(newOrigins)
      // Audit log origin trusted
      audit.originTrusted(normalized, activeAccountId ?? undefined)
    }
    return true
  }, [trustedOrigins, activeAccountId])

  const removeTrustedOrigin = useCallback((origin: string) => {
    const newOrigins = trustedOrigins.filter(o => o !== origin)
    secureSetJSON('trusted_origins', newOrigins).catch(e => {
      walletLogger.error('Failed to save trusted origins', e)
    })
    setTrustedOrigins(newOrigins)
    // Audit log origin removed
    audit.originRemoved(origin, activeAccountId ?? undefined)
  }, [trustedOrigins, activeAccountId])

  const disconnectApp = useCallback((origin: string) => {
    const newConnectedApps = connectedApps.filter(app => app !== origin)
    setConnectedApps(newConnectedApps)
    secureSetJSON('connected_apps', newConnectedApps).catch(e => {
      walletLogger.error('Failed to save connected apps', e)
    })
    // Audit log app disconnected
    audit.appDisconnected(origin, activeAccountId ?? undefined)
  }, [connectedApps, activeAccountId])

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
    handleSendToken
  }

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}
