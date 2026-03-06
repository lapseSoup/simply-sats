/**
 * Hook for wallet initialization: database setup, migration, and wallet loading.
 *
 * Extracted from WalletContext to reduce god-object complexity.
 */

import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react'
import type { ActiveWallet, PublicWalletKeys } from '../services/wallet'
import type { Contact } from '../infrastructure/database'
import {
  toSessionWallet,
  loadWallet,
  hasWallet
} from '../services/wallet'
import {
  initDatabase,
  repairUTXOs,
  ensureDerivedAddressesTable,
  ensureContactsTable,
  getContacts
} from '../infrastructure/database'
import {
  getAllAccounts,
  getActiveAccount,
  migrateToMultiAccount
} from '../services/accounts'
import { tauriInvoke } from '../utils/tauri'
import {
  migrateToSecureStorage
} from '../services/secureStorage'
import { walletLogger, uiLogger } from '../services/logger'
import { STORAGE_KEYS } from '../infrastructure/storage/localStorage'
import { setSessionPassword as setModuleSessionPassword } from '../services/sessionPasswordStore'
import { hasPassword } from '../services/wallet/storage'

interface UseWalletInitOptions {
  setWallet: (wallet: ActiveWallet | null) => void
  setIsLocked: Dispatch<SetStateAction<boolean>>
  setSessionPassword: (password: string | null) => void
  refreshAccounts: () => Promise<void>
  storeKeysInRust: (mnemonic: string, accountIndex: number) => Promise<void>
  /** Pre-load cached DB data (balance, txs, ordinals, etc.) so it's visible the moment the loading spinner disappears. */
  preloadDataFromDB: (wallet: ActiveWallet, accountId: number) => Promise<void>
}

interface UseWalletInitReturn {
  loading: boolean
  contacts: Contact[]
  setContacts: Dispatch<SetStateAction<Contact[]>>
  refreshContacts: () => Promise<void>
}

export function useWalletInit({
  setWallet,
  setIsLocked,
  setSessionPassword,
  refreshAccounts,
  storeKeysInRust,
  preloadDataFromDB
}: UseWalletInitOptions): UseWalletInitReturn {
  const [loading, setLoading] = useState(true)
  const [contacts, setContacts] = useState<Contact[]>([])

  // Initialize database and load wallet on mount
  useEffect(() => {
    let mounted = true

    const init = async () => {
      const t0 = performance.now()
      const timings: string[] = []
      const lap = (label: string) => {
        const elapsed = Math.round(performance.now() - t0)
        walletLogger.info(`⏱ INIT ${label}`, { elapsedMs: elapsed })
        timings.push(`${elapsed}ms — ${label}`)
      }
      // Store timings so they're readable even if devtools opens after init
      // S-74: Only expose timing data in dev builds — production timing reveals
      // wallet security posture (passwordless vs encrypted) to malicious extensions.
      const flushTimings = () => {
        if (!import.meta.env.DEV) return
        sessionStorage.setItem('__init_timings', JSON.stringify(timings))
        const logTimings = () => {
          console.log('%c── INIT TIMING BREAKDOWN ──', 'font-weight:bold;color:#f90')
          for (const t of timings) console.log(`  ⏱ ${t}`)
          console.log('%c───────────────────────────', 'font-weight:bold;color:#f90')
        }
        logTimings()
        // Re-log every 3s for 15s so it's visible even if devtools opens late
        let count = 0
        const iv = setInterval(() => { count++; logTimings(); if (count >= 5) clearInterval(iv) }, 3000)
      }

      // ── CRITICAL PATH: Only what's needed to show data ──────────────
      // Everything else is deferred to after setLoading(false).

      try {
        // Step 1: Init DB + migrate secure storage in parallel.
        // Both are independent — running them together saves ~50-200ms.
        await Promise.all([
          migrateToSecureStorage(),
          (async () => {
            let initAttempts = 0
            const MAX_INIT_ATTEMPTS = 3
            while (initAttempts < MAX_INIT_ATTEMPTS) {
              try {
                await initDatabase()
                return
              } catch (dbErr) {
                initAttempts++
                uiLogger.error(`Database init failed (attempt ${initAttempts}/${MAX_INIT_ATTEMPTS})`, dbErr)
                if (initAttempts >= MAX_INIT_ATTEMPTS) throw dbErr
                if (!mounted) return
                await new Promise(resolve => setTimeout(resolve, 500 * initAttempts))
              }
            }
          })()
        ])
        if (!mounted) return
        lap('initDatabase + migrateToSecureStorage')

        // Step 2: Check wallet existence, load accounts + active account in parallel.
        // These are 3 independent DB reads — parallelizing saves ~20-40ms.
        const [walletExists, allAccounts, activeAccount] = await Promise.all([
          hasWallet(),
          getAllAccounts(),
          getActiveAccount()
        ])
        if (!mounted) return
        lap('hasWallet + getAllAccounts + getActiveAccount')

        if (!walletExists) {
          // No wallet — show onboarding
          lap('TOTAL — setLoading(false) [no wallet]')
          flushTimings()
          setLoading(false)
          // Background: run deferred maintenance
          deferMaintenance(() => mounted, refreshAccounts, setContacts)
          return
        }

        if (allAccounts.length > 0) {
          if (hasPassword()) {
            // Password-protected wallet — show lock screen immediately
            walletLogger.info('Found encrypted wallet with accounts, showing lock screen')
            setIsLocked(true)
            lap('TOTAL — setLoading(false) [lock screen]')
            flushTimings()
            setLoading(false)
            // Background: run deferred maintenance
            deferMaintenance(() => mounted, refreshAccounts, setContacts)
            return
          }

          // ── Passwordless wallet — load keys + data, then show UI ──
          walletLogger.info('Found unprotected wallet, loading directly')
          try {
            const loadResult = await loadWallet(null)
            lap('loadWallet')
            if (!mounted) return
            if (!loadResult.ok) {
              walletLogger.error('Failed to load unprotected wallet', loadResult.error)
              setIsLocked(true)
              flushTimings()
              setLoading(false)
              return
            }
            const keys = loadResult.value
            if (keys) {
              // Determine if we need to switch to a different account's keys.
              // loadWallet always returns Account 1 keys from secure storage.
              let walletKeys: ActiveWallet = keys
              const accountId = activeAccount?.id ?? 1
              let needsAccountSwitch = false

              if (activeAccount) {
                const targetIndex = activeAccount.derivationIndex ?? ((activeAccount.id ?? 1) - 1)
                const loadedIndex = keys.accountIndex ?? 0
                needsAccountSwitch = targetIndex !== loadedIndex
                if (needsAccountSwitch) {
                  walletLogger.info('Active account differs from loaded keys — deriving correct keys', {
                    activeAccountId: activeAccount.id, targetIndex, loadedIndex
                  })
                  // Must store mnemonic in Rust first, then derive the active account's keys
                  await storeKeysInRust(keys.mnemonic, keys.accountIndex ?? 0)
                  lap('storeKeysInRust (for account switch)')
                  try {
                    const pubKeys = await tauriInvoke<PublicWalletKeys>('switch_account_from_store', { accountIndex: targetIndex })
                    walletKeys = toSessionWallet(pubKeys, targetIndex)
                    lap('switch_account_from_store')
                  } catch (rustErr) {
                    walletLogger.warn('Failed to derive active account keys — falling back to stored keys', { error: String(rustErr) })
                  }
                }
              }

              // Pre-load ALL cached data BEFORE the spinner disappears.
              try {
                await preloadDataFromDB(walletKeys, accountId)
                lap('preloadDataFromDB')
              } catch (e) {
                walletLogger.warn('Pre-load from DB failed (non-critical)', { error: String(e) })
              }

              // Set wallet state — data is already loaded, so when the spinner
              // disappears the wallet UI has data from the very first frame.
              setWallet(walletKeys)
              // S-73: Empty string is the NO_PASSWORD sentinel — intentionally falsy.
              // sessionPasswordStore uses `=== null` checks, not truthiness.
              // getAccountKeys() handles '' correctly for passwordless wallets.
              setSessionPassword('')
              setModuleSessionPassword('')

              lap('TOTAL — setLoading(false) [data ready]')
              flushTimings()
              if (!mounted) return
              setLoading(false)

              // ── DEFERRED: Non-critical operations (fire-and-forget) ──
              // These run AFTER the UI is visible. The user sees data instantly
              // while maintenance, contacts, and Rust key store populate in the background.
              ;(async () => {
                try {
                  // Store keys in Rust if not done during account switch
                  if (!needsAccountSwitch && keys.mnemonic) {
                    await storeKeysInRust(keys.mnemonic, keys.accountIndex ?? 0)
                  }
                } catch (e) { walletLogger.warn('Deferred storeKeysInRust failed', { error: String(e) }) }
                deferMaintenance(() => mounted, refreshAccounts, setContacts)
              })()
              return
            } else {
              walletLogger.error('Failed to load unprotected wallet')
              setIsLocked(true)
            }
          } catch (e) {
            walletLogger.error('Error loading unprotected wallet', e)
            setIsLocked(true)
          }
        } else {
          // No accounts yet — try loading with empty password (legacy unencrypted support)
          try {
            const legacyResult = await loadWallet('')
            if (!mounted) return
            const keys = legacyResult.ok ? legacyResult.value : null
            if (keys) {
              setWallet(keys)
              setSessionPassword('')
              setModuleSessionPassword('')
              walletLogger.info('Migrating to multi-account system')
              await migrateToMultiAccount(keys, '')
              if (!mounted) return
              await refreshAccounts()
            }
          } catch (_err) {
            if (!mounted) return
            walletLogger.info('Wallet is encrypted, showing lock screen')
            setIsLocked(true)
          }
        }
      } catch (err) {
        uiLogger.error('Failed to initialize', err)
      }

      if (!mounted) return
      lap('TOTAL — setLoading(false)')
      flushTimings()
      setLoading(false)
    }
    init()

    return () => {
      mounted = false
    }
  }, [setWallet, setIsLocked, setSessionPassword, refreshAccounts, storeKeysInRust, preloadDataFromDB])

  // Migration: remove old localStorage locks (database is source of truth)
  useEffect(() => {
    localStorage.removeItem(STORAGE_KEYS.LOCKS)
  }, [])

  const refreshContacts = useCallback(async () => {
    const result = await getContacts()
    if (result.ok) {
      setContacts(result.value)
    } else {
      uiLogger.error('Failed to refresh contacts', result.error)
    }
  }, [])

  return {
    loading,
    contacts,
    setContacts,
    refreshContacts
  }
}

/**
 * Run non-critical maintenance operations in the background.
 * Called fire-and-forget AFTER setLoading(false) so the UI is already visible.
 */
function deferMaintenance(
  isMounted: () => boolean, // B-64: callback instead of captured boolean value
  refreshAccounts: () => Promise<void>,
  setContacts: Dispatch<SetStateAction<Contact[]>>
) {
  ;(async () => {
    try {
      if (!isMounted()) return
      // These 3 are independent — run in parallel
      const [repairResult, , contactsResult] = await Promise.all([
        repairUTXOs(),
        ensureDerivedAddressesTable(),
        ensureContactsTable().then(() => getContacts())
      ])

      if (repairResult.ok && repairResult.value > 0) {
        uiLogger.info('Repaired UTXOs', { count: repairResult.value })
      }
      if (contactsResult.ok) {
        setContacts(contactsResult.value)
      }

      if (!isMounted()) return
      await refreshAccounts()
    } catch (e) {
      uiLogger.warn('Deferred maintenance failed (non-critical)', { error: String(e) })
    }
  })()
}
