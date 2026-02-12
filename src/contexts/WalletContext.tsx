import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react'
import type { WalletKeys, UTXO, LockedUTXO, Ordinal, ExtendedUTXO } from '../services/wallet'
import {
  createWallet,
  restoreWallet,
  importFromJSON,
  getUTXOs,
  sendBSVMultiKey,
  saveWallet,
  loadWallet,
  hasWallet,
  clearWallet,
  getFeeRatePerKB,
  setFeeRateFromKB,
  transferOrdinal
} from '../services/wallet'
import { listOrdinal } from '../services/wallet/marketplace'
import { setWalletKeys } from '../services/brc100'
import { useNetwork, type NetworkInfo } from './NetworkContext'
import { useAccounts } from './AccountsContext'
import { useSyncContext, type TxHistoryItem, type BasketBalances } from './SyncContext'
import { useLocksContext } from './LocksContext'
import {
  initDatabase,
  repairUTXOs,
  ensureDerivedAddressesTable,
  ensureContactsTable,
  getContacts,
  getDerivedAddresses,
  clearDatabase,
  getTransactionLabels,
  updateTransactionLabels,
  getTransactionByTxid,
  upsertTransaction,
  updateLockBlock,
  getLocks as getLocksFromDB,
  addUTXO,
  addLockIfNotExists,
  deleteTransactionsForAccount,
  getAllTransactions,
  type Contact,
  type Transaction,
  type UTXO as DatabaseUTXO
} from '../services/database'
import {
  getSpendableUtxosFromDatabase,
  getOrdinalsFromDatabase,
  getBalanceFromDatabase
} from '../services/sync'
import {
  type Account,
  getAllAccounts,
  getActiveAccount,
  migrateToMultiAccount
} from '../services/accounts'
import { discoverAccounts } from '../services/accountDiscovery'
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
import { walletLogger, uiLogger } from '../services/logger'
import {
  checkUnlockRateLimit,
  recordFailedUnlockAttempt,
  recordSuccessfulUnlock,
  formatLockoutTime
} from '../services/rateLimiter'
import {
  secureGetJSON,
  secureSetJSON,
  migrateToSecureStorage,
  clearAllSimplySatsStorage
} from '../services/secureStorage'
import { audit } from '../services/auditLog'

// Re-export types for backward compatibility
export type { TxHistoryItem, BasketBalances } from './SyncContext'

interface WalletContextType {
  // Wallet state
  wallet: WalletKeys | null
  setWallet: (wallet: WalletKeys | null) => void
  balance: number
  ordBalance: number
  usdPrice: number
  utxos: UTXO[]
  ordinals: Ordinal[]
  ordinalContentCache: Map<string, { contentData?: Uint8Array; contentText?: string }>
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
  importAccount: (name: string, mnemonic: string) => Promise<boolean>
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
  syncError: string | null
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

  // Session
  sessionPassword: string | null
  refreshContacts: () => Promise<void>

  // Actions
  performSync: (isRestore?: boolean, forceReset?: boolean) => Promise<void>
  fetchData: () => Promise<void>
  handleCreateWallet: (password: string) => Promise<string | null>
  handleRestoreWallet: (mnemonic: string, password: string) => Promise<boolean>
  handleImportJSON: (json: string, password: string) => Promise<boolean>
  handleDeleteWallet: () => Promise<void>
  handleSend: (address: string, amountSats: number, selectedUtxos?: DatabaseUTXO[]) => Promise<{ success: boolean; txid?: string; error?: string }>
  handleLock: (amountSats: number, blocks: number) => Promise<{ success: boolean; txid?: string; error?: string }>
  handleUnlock: (lock: LockedUTXO) => Promise<{ success: boolean; txid?: string; error?: string }>
  handleTransferOrdinal: (ordinal: Ordinal, toAddress: string) => Promise<{ success: boolean; txid?: string; error?: string }>
  handleListOrdinal: (ordinal: Ordinal, priceSats: number) => Promise<{ success: boolean; txid?: string; error?: string }>
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
  const [contacts, setContacts] = useState<Contact[]>([])
  // Incremented on account switch to invalidate stale async callbacks
  const fetchVersionRef = useRef(0)

  // Get sync state from SyncContext
  const {
    utxos,
    ordinals,
    ordinalContentCache,
    txHistory,
    basketBalances,
    balance,
    ordBalance,
    syncError,
    setOrdinals,
    setBalance,
    setTxHistory,
    resetSync,
    performSync: syncPerformSync,
    fetchData: syncFetchData
  } = useSyncContext()

  // Get lock state from LocksContext
  const {
    locks,
    knownUnlockedLocks,
    setLocks,
    handleLock: locksHandleLock,
    handleUnlock: locksHandleUnlock,
    detectLocks
  } = useLocksContext()

  // Get multi-account state from AccountsContext
  const {
    accounts,
    activeAccount,
    activeAccountId,
    switchAccount: accountsSwitchAccount,
    createNewAccount: accountsCreateNewAccount,
    importAccount: accountsImportAccount,
    deleteAccount: accountsDeleteAccount,
    renameAccount,
    refreshAccounts,
    resetAccounts,
    getKeysForAccount
  } = useAccounts()

  // Always-current account ID ref — avoids stale closure in fetchData after account switch
  const activeAccountIdRef = useRef(activeAccountId)
  activeAccountIdRef.current = activeAccountId

  // Token state from TokensContext
  const {
    tokenBalances,
    tokensSyncing,
    resetTokens,
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
  //
  // Security note: A CryptoKey-based approach was considered but provides minimal benefit:
  // - Each account has unique salt, requiring re-derivation for every decrypt anyway
  // - Auto-lock (configurable timeout) clears all sensitive data including this
  // - Memory protection relies on OS/browser security, not JavaScript variable type
  // - CryptoKey cannot be serialized to React state (would require complex workarounds)
  const [sessionPassword, setSessionPassword] = useState<string | null>(null)

  // Debug: log when session password changes
  useEffect(() => {
    walletLogger.debug('Session password state changed', { hasPassword: !!sessionPassword })
  }, [sessionPassword])

  // Independent session password timeout — clears password after 30 minutes of inactivity
  // This is a safety net independent of auto-lock to ensure the session password
  // doesn't persist indefinitely if auto-lock is disabled or set to a long duration.
  useEffect(() => {
    if (!sessionPassword) return

    const SESSION_PASSWORD_TTL_MS = 30 * 60 * 1000 // 30 minutes
    const timer = setTimeout(() => {
      walletLogger.info('Session password cleared — independent timeout reached (30 min)')
      setSessionPassword(null)
    }, SESSION_PASSWORD_TTL_MS)

    return () => clearTimeout(timer)
  }, [sessionPassword])

  // Get network state from NetworkContext
  const { networkInfo, syncing, usdPrice } = useNetwork()

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

  // Lock wallet when app is hidden for extended period (prevents leaving keys in memory)
  useEffect(() => {
    if (!wallet || isLocked) return

    const HIDDEN_LOCK_DELAY_MS = 60_000 // 60 seconds
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null

    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenTimer = setTimeout(() => {
          walletLogger.info('Locking wallet — app hidden for extended period')
          lockWallet()
        }, HIDDEN_LOCK_DELAY_MS)
      } else {
        if (hiddenTimer) {
          clearTimeout(hiddenTimer)
          hiddenTimer = null
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (hiddenTimer) clearTimeout(hiddenTimer)
    }
  }, [wallet, isLocked, lockWallet])

  // Unlock wallet with password (with rate limiting)
  // Uses constant-time padding to prevent timing side-channel attacks
  const UNLOCK_MIN_TIME_MS = 500
  const unlockWallet = useCallback(async (password: string): Promise<boolean> => {
    const startTime = performance.now()

    // Check rate limit before attempting unlock
    const rateLimit = await checkUnlockRateLimit()
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
            account = allAccounts[0]!
          }
        }
      }

      if (!account) {
        walletLogger.error('No account found to unlock')
        return false
      }

      const keys = await getKeysForAccount(account, password)
      if (keys) {
        await recordSuccessfulUnlock()
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
      const result = await recordFailedUnlockAttempt()
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
    } finally {
      // Pad response time to prevent timing side-channel
      const elapsed = performance.now() - startTime
      if (elapsed < UNLOCK_MIN_TIME_MS) {
        await new Promise(resolve => setTimeout(resolve, UNLOCK_MIN_TIME_MS - elapsed))
      }
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
        // Invalidate any in-flight fetchData callbacks from the previous account
        fetchVersionRef.current += 1
        // Clear stale state from previous account before setting new wallet
        setLocks([])
        resetSync()
        setWallet(keys)
        setIsLocked(false)

        // Preload locks from DB instantly so they appear before the full sync cycle
        // Use version guard to prevent stale data from overwriting if user switches accounts rapidly
        const preloadVersion = fetchVersionRef.current
        try {
          const dbLocks = await getLocksFromDB(0, accountId)
          // Check version hasn't changed during async DB call (rapid account switch)
          if (fetchVersionRef.current !== preloadVersion) {
            walletLogger.debug('Skipping lock preload — account switch detected during DB query')
          } else if (dbLocks.length > 0) {
            setLocks(dbLocks.map(lock => ({
              txid: lock.utxo.txid,
              vout: lock.utxo.vout,
              satoshis: lock.utxo.satoshis,
              lockingScript: lock.utxo.lockingScript,
              unlockBlock: lock.unlockBlock,
              publicKeyHex: keys.walletPubKey,
              createdAt: lock.createdAt,
              lockBlock: lock.lockBlock
            })))
          }
        } catch (_e) {
          // Best-effort: full sync will pick up locks anyway
        }

        // Preload ordinals from DB instantly (same pattern as locks)
        try {
          const dbOrdinals = await getOrdinalsFromDatabase(accountId)
          if (fetchVersionRef.current === preloadVersion && dbOrdinals.length > 0) {
            setOrdinals(dbOrdinals as Ordinal[])
          }
        } catch (_e) {
          // Best-effort: fetchData will load ordinals anyway
        }

        // Preload balance from DB
        try {
          const [defaultBal, derivedBal] = await Promise.all([
            getBalanceFromDatabase('default', accountId),
            getBalanceFromDatabase('derived', accountId)
          ])
          if (fetchVersionRef.current === preloadVersion) {
            setBalance(defaultBal + derivedBal)
          }
        } catch (_e) {
          // Best-effort
        }

        // Preload transaction history from DB
        try {
          const dbTxs = await getAllTransactions(30, accountId)
          if (fetchVersionRef.current === preloadVersion && dbTxs.length > 0) {
            setTxHistory(dbTxs.map((tx: Transaction) => ({
              tx_hash: tx.txid,
              height: tx.blockHeight || 0,
              amount: tx.amount,
              description: tx.description
            })))
          }
        } catch (_e) {
          // Best-effort
        }

        // Bump version again AFTER preload — invalidates any fetchData that was
        // triggered by setWallet() above (via App.tsx effect) so it can't overwrite
        // the locks we just preloaded. The next effect cycle (from activeAccountId
        // state propagating) will capture this new version and run correctly.
        fetchVersionRef.current += 1

        walletLogger.info('Account switched successfully', { accountId })
        return true
      }
      walletLogger.error('Failed to switch account - invalid password or account not found')
      return false
    } catch (e) {
      walletLogger.error('Error switching account', e)
      return false
    }
  }, [accountsSwitchAccount, setWallet, setLocks, setOrdinals, setBalance, setTxHistory, resetSync, sessionPassword])

  // Create a new account using session password (capped at 10 accounts)
  const createNewAccount = useCallback(async (name: string): Promise<boolean> => {
    if (!sessionPassword) {
      walletLogger.error('Cannot create account - no session password available')
      return false
    }
    if (accounts.length >= 10) {
      walletLogger.warn('Account creation blocked - maximum 10 accounts reached')
      return false
    }
    const keys = await accountsCreateNewAccount(name, sessionPassword)
    if (keys) {
      setWallet(keys)
      setIsLocked(false)
      return true
    }
    return false
  }, [accountsCreateNewAccount, setWallet, sessionPassword, accounts.length])

  // Import account from external mnemonic using session password
  const importAccount = useCallback(async (name: string, mnemonic: string): Promise<boolean> => {
    if (!sessionPassword) {
      walletLogger.error('Cannot import account - no session password available')
      return false
    }
    const keys = await accountsImportAccount(name, mnemonic, sessionPassword)
    if (keys) {
      setWallet(keys)
      setIsLocked(false)
      // Discover derivative accounts for this mnemonic (non-blocking)
      const active = await getActiveAccount()
      discoverAccounts(mnemonic, sessionPassword, active?.id)
        .then(async (found) => {
          if (found > 0) {
            await refreshAccounts()
            walletLogger.info(`Discovered ${found} derivative account(s) for imported wallet`)
          }
        })
        .catch((e) => {
          walletLogger.error('Account discovery failed', e)
        })
      return true
    }
    return false
  }, [accountsImportAccount, setWallet, sessionPassword, refreshAccounts])

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

        // One-time cleanup: delete corrupted transactions for non-account-1 accounts
        // The reassignAccountData bug (removed in e378674) moved account 1's transactions
        // to other accounts. Deleting those transactions lets sync rebuild correct data.
        try {
          const cleanupFlag = 'simply_sats_tx_cleanup_v1'
          if (!localStorage.getItem(cleanupFlag)) {
            const accounts = await getAllAccounts()
            for (const acc of accounts) {
              if (acc.id && acc.id !== 1) {
                await deleteTransactionsForAccount(acc.id)
                walletLogger.info('Cleaned corrupted transactions', { accountId: acc.id })
              }
            }
            localStorage.setItem(cleanupFlag, String(Date.now()))
            walletLogger.info('One-time transaction cleanup complete')
          }
        } catch (cleanupErr: unknown) {
          walletLogger.warn('Transaction cleanup failed (non-fatal)', cleanupErr as Record<string, unknown>)
        }
        if (!mounted) return

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
        if (mounted) setLoading(false)
        return // Do not attempt to load wallet from broken DB
      }

      if (!mounted) return

      // Try to load wallet (legacy support + new account system)
      if (await hasWallet()) {
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

  // Sync wallet with blockchain - delegates to SyncContext
  const performSync = useCallback(async (isRestore = false, forceReset = false) => {
    if (!wallet) return
    await syncPerformSync(wallet, activeAccountIdRef.current, isRestore, forceReset)
  }, [wallet, syncPerformSync])

  // Fetch data from database and API - delegates to SyncContext with lock detection callback
  const fetchData = useCallback(async () => {
    if (!wallet) return

    // Capture version before async work — if it changes, account was switched
    const version = fetchVersionRef.current
    // Use ref for always-current account ID (avoids stale closure after account switch)
    const currentAccountId = activeAccountIdRef.current
    // Guard: don't fetch data without a valid account ID (prevents cross-account data leaks)
    if (!currentAccountId) return

    await syncFetchData(
      wallet,
      currentAccountId,
      knownUnlockedLocks,
      async ({ utxos: fetchedUtxos, preloadedLocks }) => {
        // Guard: discard results if account was switched during this fetch
        if (fetchVersionRef.current !== version) return

        // Set preloaded locks from DB immediately (before slow blockchain detection)
        if (preloadedLocks && preloadedLocks.length > 0) {
          setLocks(preloadedLocks)
        }

        // Detect locks after UTXOs are fetched
        try {
          const detectedLocks = await detectLocks(wallet, fetchedUtxos)

          // Guard again after async lock detection
          if (fetchVersionRef.current !== version) return

          if (detectedLocks.length > 0) {
            // Merge preloaded DB data into detected locks (preserve lockBlock + earlier createdAt)
            const AVG_BLOCK_MS = 600_000
            const preloadMap = new Map(
              (preloadedLocks || []).map(l => [`${l.txid}:${l.vout}`, l])
            )
            const mergedLocks = detectedLocks.map(lock => {
              const preloaded = preloadMap.get(`${lock.txid}:${lock.vout}`)
              if (!preloaded) return lock
              const earlierCreatedAt = Math.min(lock.createdAt, preloaded.createdAt)
              // Prefer DB lockBlock (exact from creation or previous backfill) over detected (confirmation block)
              let estimatedLockBlock = preloaded.lockBlock || lock.lockBlock
              if (!estimatedLockBlock && lock.confirmationBlock && earlierCreatedAt < lock.createdAt) {
                // earlierCreatedAt = broadcast time, lock.createdAt = confirmation time
                const mempoolMs = lock.createdAt - earlierCreatedAt
                const mempoolBlocks = Math.round(mempoolMs / AVG_BLOCK_MS)
                estimatedLockBlock = lock.confirmationBlock - mempoolBlocks
              }
              // Backfill lockBlock to DB so we don't re-estimate next time
              if (estimatedLockBlock && !preloaded.lockBlock) {
                updateLockBlock(lock.txid, lock.vout, estimatedLockBlock).catch(() => {})
              }
              return {
                ...lock,
                lockBlock: estimatedLockBlock,
                createdAt: earlierCreatedAt
              }
            })
            setLocks(mergedLocks)

            // Persist detected locks to DB so they survive app restarts
            for (const lock of mergedLocks) {
              try {
                const utxoId = await addUTXO({
                  txid: lock.txid,
                  vout: lock.vout,
                  satoshis: lock.satoshis,
                  lockingScript: lock.lockingScript,
                  basket: 'locks',
                  spendable: false,
                  createdAt: lock.createdAt
                }, currentAccountId || undefined)
                await addLockIfNotExists({
                  utxoId,
                  unlockBlock: lock.unlockBlock,
                  lockBlock: lock.lockBlock,
                  createdAt: lock.createdAt
                }, currentAccountId || undefined)
              } catch (_e) {
                // Best-effort — sync already handles primary persistence
              }
            }

            // Auto-label and describe lock transactions (enables search + fee display after restore)
            const lockAccountId = currentAccountId || 1
            for (const lock of mergedLocks) {
              try {
                const existingLabels = await getTransactionLabels(lock.txid, lockAccountId)
                if (!existingLabels.includes('lock')) {
                  await updateTransactionLabels(lock.txid, [...existingLabels, 'lock'], lockAccountId)
                }
                const dbTx = await getTransactionByTxid(lock.txid, lockAccountId)
                if (dbTx) {
                  // After restore, calculateTxAmount may compute a wrong positive amount
                  // for lock txs (sees change as received, misses spent input).
                  // Correct to negative using lock data if the sign is wrong.
                  const needsAmountFix = dbTx.amount !== undefined && dbTx.amount > 0
                  const needsDescription = !dbTx.description

                  if (needsDescription || needsAmountFix) {
                    await upsertTransaction({
                      txid: dbTx.txid,
                      createdAt: dbTx.createdAt,
                      status: dbTx.status,
                      ...(needsDescription && {
                        description: `Locked ${lock.satoshis} sats until block ${lock.unlockBlock}`
                      }),
                      ...(needsAmountFix && {
                        amount: -lock.satoshis
                      })
                    }, lockAccountId)
                  }
                }
              } catch (_e) {
                // Best-effort: don't fail lock detection if labeling fails
              }
            }
          }
          // Note: when detectedLocks is empty, we keep whatever locks are
          // already in state (from DB preload). Locks are removed individually
          // by handleUnlock, not by bulk-clearing here. This prevents API
          // failures from wiping valid lock data.
        } catch (e) {
          walletLogger.error('Failed to detect locks', e)
          // Don't clear locks on detection failure — keep preloaded DB data
        }
      }
    )
  }, [wallet, knownUnlockedLocks, syncFetchData, detectLocks, setLocks])

  // Wallet actions
  const handleCreateWallet = useCallback(async (password: string): Promise<string | null> => {
    const validation = validatePassword(password)
    if (!validation.isValid) {
      throw new Error(validation.errors[0] || `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    }
    try {
      const keys = await createWallet()
      await saveWallet(keys, password)
      // Create account in database for persistence across app restarts
      // Use legacy password requirements since we've already validated length above
      await migrateToMultiAccount(keys, password)
      await refreshAccounts()
      setWallet({ ...keys })
      setSessionPassword(password) // Store password for session operations (account creation)
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
      const keys = await restoreWallet(mnemonic.trim())
      await saveWallet(keys, password)
      // Create account in database for persistence across app restarts
      await migrateToMultiAccount({ ...keys, mnemonic: mnemonic.trim() }, password)
      await refreshAccounts()
      setWallet({ ...keys, mnemonic: mnemonic.trim() })
      setSessionPassword(password) // Store password for session operations (account creation)
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

  const refreshContacts = useCallback(async () => {
    const loaded = await getContacts()
    setContacts(loaded)
  }, [])

  const handleDeleteWallet = useCallback(async () => {
    // 1. Stop auto-lock timer
    stopAutoLock()

    // 2. Reset ALL React state FIRST so UI immediately redirects to setup screen
    setWallet(null)
    setIsLocked(false)
    setSessionPassword(null)
    resetSync()
    setLocks([])
    setConnectedApps([])
    setTrustedOrigins([])
    setContacts([])
    setAutoLockMinutesState(10)
    setFeeRateKBState(50)
    resetTokens()
    resetAccounts()

    // 3. Clean up persistent storage (errors must not block UI reset)
    try {
      await clearWallet()
    } catch (err) {
      walletLogger.error('Failed to clear wallet storage during delete', err)
    }

    try {
      await clearDatabase()
    } catch (err) {
      walletLogger.error('Failed to clear database during delete', err)
    }

    try {
      clearAllSimplySatsStorage()
    } catch (err) {
      walletLogger.error('Failed to clear localStorage during delete', err)
    }

    walletLogger.info('Wallet deleted and all data cleared')
  }, [setWallet, resetSync, setLocks, resetTokens, resetAccounts])

  const handleSend = useCallback(async (address: string, amountSats: number, selectedUtxos?: DatabaseUTXO[]): Promise<{ success: boolean; txid?: string; error?: string }> => {
    if (!wallet) return { success: false, error: 'No wallet loaded' }

    try {
      // Use selected UTXOs if provided (from coin control), otherwise get from database
      const spendableUtxos = selectedUtxos || await getSpendableUtxosFromDatabase('default', activeAccountId ?? undefined)

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
      const derivedAddrs = await getDerivedAddresses(activeAccountId || undefined)
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

      const txid = await sendBSVMultiKey(wallet.walletWif, address, amountSats, deduplicatedUtxos, activeAccountId ?? undefined)
      await fetchData()
      // Audit log successful send
      audit.transactionSent(txid, amountSats, activeAccountId ?? undefined)
      return { success: true, txid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Send failed' }
    }
  }, [wallet, fetchData, activeAccountId])

  // Lock BSV - delegates to LocksContext
  const handleLock = useCallback(async (amountSats: number, blocks: number): Promise<{ success: boolean; txid?: string; error?: string }> => {
    if (!wallet) return { success: false, error: 'No wallet loaded' }
    return locksHandleLock(wallet, amountSats, blocks, activeAccountId, fetchData)
  }, [wallet, activeAccountId, locksHandleLock, fetchData])

  // Unlock BSV - delegates to LocksContext
  const handleUnlock = useCallback(async (lock: LockedUTXO): Promise<{ success: boolean; txid?: string; error?: string }> => {
    if (!wallet) return { success: false, error: 'No wallet loaded' }
    return locksHandleUnlock(wallet, lock, activeAccountId, fetchData)
  }, [wallet, activeAccountId, locksHandleUnlock, fetchData])

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

  const handleListOrdinal = useCallback(async (
    ordinal: Ordinal,
    priceSats: number
  ): Promise<{ success: boolean; txid?: string; error?: string }> => {
    if (!wallet) return { success: false, error: 'No wallet loaded' }

    try {
      const fundingUtxos = await getUTXOs(wallet.walletAddress)

      if (fundingUtxos.length === 0) {
        return { success: false, error: 'No funding UTXOs available for listing fee' }
      }

      const ordinalUtxo: UTXO = {
        txid: ordinal.txid,
        vout: ordinal.vout,
        satoshis: 1,
        script: ''
      }

      const txid = await listOrdinal(
        wallet.ordWif,
        ordinalUtxo,
        wallet.walletWif,
        fundingUtxos,
        wallet.walletAddress,
        wallet.ordAddress,
        priceSats
      )

      await fetchData()
      return { success: true, txid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Listing failed' }
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

  const value: WalletContextType = useMemo(() => ({
    // Wallet state
    wallet,
    setWallet,
    balance,
    ordBalance,
    usdPrice,
    utxos,
    ordinals,
    ordinalContentCache,
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
    importAccount,
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
    syncError,
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

    // Session
    sessionPassword,
    refreshContacts,

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
    handleListOrdinal,
    handleSendToken
  }), [
    wallet, setWallet, balance, ordBalance, usdPrice, utxos, ordinals, ordinalContentCache,
    locks, txHistory, basketBalances, contacts, accounts, activeAccount, activeAccountId,
    switchAccount, createNewAccount, importAccount, deleteAccount, renameAccount, refreshAccounts,
    tokenBalances, refreshTokens, tokensSyncing, isLocked, lockWallet, unlockWallet,
    autoLockMinutes, setAutoLockMinutes, networkInfo, syncing, syncError, loading,
    feeRateKB, setFeeRate, connectedApps, trustedOrigins, addTrustedOrigin, removeTrustedOrigin,
    disconnectApp, sessionPassword, refreshContacts, performSync, fetchData, handleCreateWallet,
    handleRestoreWallet, handleImportJSON, handleDeleteWallet, handleSend, handleLock,
    handleUnlock, handleTransferOrdinal, handleListOrdinal, handleSendToken
  ])

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}
