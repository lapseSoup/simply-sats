/**
 * Hook for account switching with DB preloading.
 *
 * Extracted from WalletContext to reduce god-object complexity.
 *
 * Account switching now derives keys directly from the Rust key store's mnemonic,
 * bypassing the need for a session password entirely. This eliminates an entire
 * class of React state/closure bugs that caused "Please unlock wallet to switch
 * accounts" errors.
 */

import { useCallback, useRef, type MutableRefObject, type Dispatch, type SetStateAction } from 'react'
import type { WalletKeys, LockedUTXO, PublicWalletKeys } from '../services/wallet'
import type { Account } from '../services/accounts'
import { getActiveAccount, getAccountById, switchAccount as switchAccountDb } from '../services/accounts'
import { discoverAccounts } from '../services/accountDiscovery'
import {
  cancelSync
} from '../services/sync'
import { walletLogger } from '../services/logger'
import { tauriInvoke } from '../utils/tauri'
import { getSessionPassword, clearSessionPassword, NO_PASSWORD } from '../services/sessionPasswordStore'

// Diagnostic: last failure reason (visible to UI for debugging)
let _lastSwitchDiag = ''
export function getLastSwitchDiag(): string { return _lastSwitchDiag }

// Module-level flag — true while an account switch is actively in progress.
// Prevents App.tsx checkSync from running fetchDataFromDB with stale wallet keys
// (the "one behind" bug: activeAccountId updates before wallet, so checkSync
// would load data using the old wallet keys for the new account ID).
let switchInProgress = false
export function isAccountSwitchInProgress(): boolean { return switchInProgress }

// Timestamp of the last switch completion. checkSync uses this to detect that
// a switch just happened (even though switchInProgress is already false by the
// time the effect fires). If the effect fires within 2s of switch completion,
// it skips the blocking DB preload / initial sync — the switch already handled it.
let lastSwitchCompletedAt = 0
export function switchJustCompleted(): boolean { return (Date.now() - lastSwitchCompletedAt) < 2000 }

interface UseAccountSwitchingOptions {
  fetchVersionRef: MutableRefObject<number>
  accountsSwitchAccount: (accountId: number, password: string | null) => Promise<WalletKeys | null>
  accountsCreateNewAccount: (name: string, password: string | null) => Promise<{ keys: WalletKeys; accountId: number } | null>
  accountsImportAccount: (name: string, mnemonic: string, password: string | null) => Promise<{ keys: WalletKeys; accountId: number } | null>
  accountsDeleteAccount: (accountId: number) => Promise<boolean>
  getKeysForAccount: (account: Account, password: string | null) => Promise<WalletKeys | null>
  setWallet: (wallet: WalletKeys | null) => void
  setIsLocked: Dispatch<SetStateAction<boolean>>
  setLocks: (locks: LockedUTXO[]) => void
  resetSync: (initialBalance?: number) => void
  /** Clear knownUnlockedLocks on account switch to prevent cross-account lock contamination */
  resetKnownUnlockedLocks: () => void
  storeKeysInRust: (mnemonic: string, accountIndex: number) => Promise<void>
  refreshAccounts: () => Promise<void>
  setActiveAccountState: (account: Account | null, accountId: number | null) => void
  /** Apply a hot in-memory snapshot for recently used accounts, if available. */
  applyCachedAccountSnapshot: (accountId: number) => boolean
  /** DB-only data loader from SyncContext — loads all cached data without API calls */
  fetchDataFromDB: (
    wallet: WalletKeys,
    activeAccountId: number | null,
    onLocksLoaded: (locks: LockedUTXO[]) => void,
    isCancelled?: () => boolean
  ) => Promise<void>
  wallet: WalletKeys | null
  accounts: Account[]
}

interface UseAccountSwitchingReturn {
  switchAccount: (accountId: number) => Promise<boolean>
  createNewAccount: (name: string) => Promise<boolean>
  importAccount: (name: string, mnemonic: string) => Promise<boolean>
  deleteAccount: (accountId: number) => Promise<boolean>
}

/**
 * Map PublicWalletKeys (from Rust) to WalletKeys (for React state).
 * WIFs are left empty — all signing goes through Rust _from_store commands.
 */
function pubKeysToWalletKeys(pubKeys: PublicWalletKeys, accountIndex: number): WalletKeys {
  return {
    mnemonic: '',
    walletType: pubKeys.walletType as 'yours',
    walletWif: '',
    walletAddress: pubKeys.walletAddress,
    walletPubKey: pubKeys.walletPubKey,
    ordWif: '',
    ordAddress: pubKeys.ordAddress,
    ordPubKey: pubKeys.ordPubKey,
    identityWif: '',
    identityAddress: pubKeys.identityAddress,
    identityPubKey: pubKeys.identityPubKey,
    accountIndex
  }
}

/**
 * Switch account keys entirely in Rust — mnemonic never leaves native memory.
 * Returns null if mnemonic is not available (wallet locked or cleared).
 */
async function deriveKeysFromRust(account: Account): Promise<WalletKeys | null> {
  try {
    const accountIndex = account.derivationIndex ?? ((account.id ?? 1) - 1)
    _lastSwitchDiag = `Rust: calling switch_account_from_store idx=${accountIndex}...`

    const pubKeys = await tauriInvoke<PublicWalletKeys>('switch_account_from_store', { accountIndex })
    const keys = pubKeysToWalletKeys(pubKeys, accountIndex)

    _lastSwitchDiag = `Rust: OK addr=${keys.walletAddress?.substring(0, 8)}`
    return keys
  } catch (e) {
    _lastSwitchDiag = `Rust: THREW ${String(e).substring(0, 80)}`
    walletLogger.warn('Failed to switch account via Rust key store', { error: String(e) })
    return null
  }
}

export function useAccountSwitching({
  fetchVersionRef,
  accountsSwitchAccount,
  accountsCreateNewAccount,
  accountsImportAccount,
  accountsDeleteAccount,
  getKeysForAccount,
  setWallet,
  setIsLocked,
  setLocks,
  resetSync,
  resetKnownUnlockedLocks,
  storeKeysInRust,
  refreshAccounts,
  setActiveAccountState,
  applyCachedAccountSnapshot,
  fetchDataFromDB,
  wallet: _wallet,
  accounts
}: UseAccountSwitchingOptions): UseAccountSwitchingReturn {

  // Mutex to prevent concurrent account switches
  const switchingRef = useRef(false)
  // Queue the latest switch request when one is already in progress
  const pendingSwitchRef = useRef<number | null>(null)

  const loadAccountDataFromDB = useCallback(async (
    keys: WalletKeys,
    accountId: number,
    clearOnFailure: boolean
  ): Promise<boolean> => {
    const preloadVersion = fetchVersionRef.current

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await fetchDataFromDB(
          keys,
          accountId,
          (loadedLocks) => {
            if (fetchVersionRef.current !== preloadVersion) return
            setLocks(loadedLocks)
          },
          () => fetchVersionRef.current !== preloadVersion
        )
        return true
      } catch (e) {
        walletLogger.warn('Account switch DB preload failed', {
          accountId,
          attempt,
          error: String(e),
          clearOnFailure
        })
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 75))
        }
      }
    }

    if (clearOnFailure) {
      resetSync()
      setLocks([])
    }

    return false
  }, [fetchDataFromDB, fetchVersionRef, resetSync, setLocks])

  const switchAccount = useCallback(async (accountId: number): Promise<boolean> => {
    if (switchingRef.current) {
      // Queue the latest request instead of silently dropping it
      pendingSwitchRef.current = accountId
      walletLogger.warn('Account switch already in progress — queued', { accountId })
      return false
    }
    switchingRef.current = true
    switchInProgress = true
    _lastSwitchDiag = `START id=${accountId} accts=${accounts.length}`
    try {
      // Cancel any in-flight sync for the previous account before switching
      cancelSync()

      // Find the target account
      const account = accounts.find(a => a.id === accountId)
      if (!account) {
        _lastSwitchDiag = `FAIL: account ${accountId} not in [${accounts.map(a => a.id).join(',')}]`
        walletLogger.error('Cannot switch — account not found', { accountId })
        return false
      }
      _lastSwitchDiag = `Found: id=${account.id} derivIdx=${account.derivationIndex}`

      // Invalidate stale async callbacks. Do NOT call resetSync() here —
      // it clears utxos/ordinals/txHistory to empty arrays, causing a visible
      // flash of blank data before fetchDataFromDB repopulates from the DB.
      // Instead, let the old account's data remain visible until fetchDataFromDB
      // atomically replaces it with the new account's data (~50ms).
      fetchVersionRef.current += 1
      resetKnownUnlockedLocks()

      // PRIMARY PATH: switch_account_from_store derives + stores keys entirely in Rust.
      // The mnemonic never leaves native memory.
      let keys = await deriveKeysFromRust(account)
      let keysFromRust = !!keys

      if (keys) {
        // Rust-derived keys — update DB active account
        _lastSwitchDiag += ' | keys OK, updating DB...'
        const dbSuccess = await switchAccountDb(accountId)
        if (!dbSuccess) {
          _lastSwitchDiag += ' | DB update FAILED'
          walletLogger.error('Failed to update active account in database')
          return false
        }
        _lastSwitchDiag += ' | DB OK'
      } else {
        // FALLBACK: If Rust has no mnemonic (shouldn't happen while wallet is unlocked),
        // try the password-based approach via the module-level session password store.
        // Read current password before clearing to prevent destroying the credential we need.
        const currentPassword = getSessionPassword()
        // Do NOT clear session password before the switch — if switch throws, wallet stays accessible.
        _lastSwitchDiag += ` | FALLBACK hasPwd=${!!currentPassword}`
        walletLogger.debug('Rust derivation unavailable, trying password fallback', {
          accountId,
          hasSessionPassword: !!currentPassword
        })
        if (currentPassword === null) {
          _lastSwitchDiag += ' | NO PWD → FAIL'
          walletLogger.error('Cannot switch account — no mnemonic in Rust and no session password.')
          return false
        }
        try {
          keys = await accountsSwitchAccount(accountId, currentPassword)
          keysFromRust = false
          _lastSwitchDiag += keys ? ' | pwd-keys OK' : ' | pwd-keys NULL'
          // Only clear session password after successful switch
          clearSessionPassword()
        } catch (switchErr) {
          // Leave session password intact so wallet remains accessible
          _lastSwitchDiag += ' | pwd-switch THREW'
          walletLogger.error('Account switch failed, session password preserved', switchErr)
          throw switchErr
        }
      }

      if (keys) {
        // Only store keys in Rust for fallback path — Rust path already stored them
        if (!keysFromRust) {
          await storeKeysInRust(keys.mnemonic, keys.accountIndex ?? ((accountId ?? 1) - 1))
        }

        // CRITICAL ORDER: Set wallet BEFORE activeAccountId to prevent "one behind" bug.
        // App.tsx checkSync depends on [wallet, activeAccountId]. If activeAccountId
        // changes first (via setActiveAccountState), checkSync fires with stale wallet
        // keys from the old account, loading wrong data. By setting wallet first,
        // checkSync won't fire until activeAccountId also changes — at which point
        // both values are correct.
        setWallet({ ...keys, mnemonic: '' })
        setIsLocked(false)

        const hydratedFromCache = applyCachedAccountSnapshot(accountId)
        _lastSwitchDiag += hydratedFromCache ? ' | cache HIT' : ' | cache MISS'

        if (hydratedFromCache) {
          // Recent-account switches should feel instant. Refresh from the DB in
          // the background so the in-memory snapshot stays honest.
          void loadAccountDataFromDB(keys, accountId, false)
        } else {
          // Cold account: fall back to the DB preload path before exposing the
          // new active account, so the UI never mixes accounts.
          const preloadSucceeded = await loadAccountDataFromDB(keys, accountId, true)
          if (!preloadSucceeded) {
            _lastSwitchDiag += ' | preload failed'
          }
        }

        // Rotate session token for new account in the background.
        // This must not block preload/render during account switches.
        void tauriInvoke('rotate_session_for_account', { accountId }, 5000)
          .catch((e) => {
            walletLogger.warn('Failed to rotate session for account', { accountId, error: String(e) })
          })

        // Clear the switch-in-progress flag and record completion time BEFORE
        // setting active account state. setActiveAccountState triggers the App.tsx
        // checkSync effect. switchJustCompleted() tells checkSync to skip the
        // blocking DB preload / initial sync since the switch already handled it.
        switchInProgress = false
        lastSwitchCompletedAt = Date.now()
        setActiveAccountState(account, accountId)
        // Refresh accounts list in background (updates dropdown + balance display)
        refreshAccounts().catch(e => walletLogger.warn('Background account refresh failed', e))
        _lastSwitchDiag += ' | switch complete'

        walletLogger.info('Account switched successfully', { accountId })
        return true
      }
      _lastSwitchDiag += ' | FINAL: keys null after all paths'
      walletLogger.error('Failed to switch account - could not derive or decrypt keys')
      return false
    } catch (e) {
      _lastSwitchDiag = `EXCEPTION: ${String(e).substring(0, 100)}`
      walletLogger.error('Error switching account', e)
      return false
    } finally {
      switchingRef.current = false
      switchInProgress = false
      // If another switch was requested while this one was running, execute the latest one.
      // This ensures rapid A→B→C clicking lands on C, not A.
      const pendingId = pendingSwitchRef.current
      pendingSwitchRef.current = null
      if (pendingId !== null && pendingId !== accountId) {
        walletLogger.info('Executing queued account switch', { from: accountId, to: pendingId })
        // Note: recursive call uses current closure's accounts snapshot (B-84).
        // This is safe because accountsSwitchAccount performs its own DB lookup,
        // so stale accounts in the closure don't affect correctness.
        // Fire-and-forget — the next switch will set switchingRef itself
        switchAccount(pendingId).catch(e => walletLogger.error('Queued switch failed', e))
      }
    }
  }, [accounts, accountsSwitchAccount, refreshAccounts, setActiveAccountState, setWallet, resetKnownUnlockedLocks, storeKeysInRust, setIsLocked, applyCachedAccountSnapshot, loadAccountDataFromDB])

  const createNewAccount = useCallback(async (name: string): Promise<boolean> => {
    if (switchingRef.current) {
      walletLogger.warn('Account operation already in progress — create blocked')
      return false
    }

    switchingRef.current = true
    switchInProgress = true
    try {
      const currentPassword = getSessionPassword()
      if (currentPassword === null) {
        walletLogger.error('Cannot create account - no session password available')
        return false
      }
      const accountPassword = currentPassword === NO_PASSWORD ? null : currentPassword
      if (accounts.length >= 10) {
        walletLogger.warn('Account creation blocked - maximum 10 accounts reached')
        return false
      }

      // Invalidate stale async callbacks and stop in-flight sync before the account changes.
      cancelSync()
      fetchVersionRef.current += 1
      resetKnownUnlockedLocks()

      const created = await accountsCreateNewAccount(name, accountPassword)
      if (!created) return false

      const { keys, accountId } = created
      const accountIndex = keys.accountIndex ?? accounts.length
      if (keys.accountIndex == null) {
        walletLogger.warn('keys.accountIndex was null, using fallback accounts.length', { fallback: accounts.length })
      }
      await storeKeysInRust(keys.mnemonic, accountIndex)

      // Ensure we have the full account row for state updates and telemetry.
      const createdAccount = await getAccountById(accountId)
      if (!createdAccount || !createdAccount.id) {
        walletLogger.error('Created account row not found after create', { accountId })
        return false
      }

      // CRITICAL ORDER: set wallet first, then activeAccountId, to prevent one-behind sync writes.
      setWallet({ ...keys, mnemonic: '' })
      setIsLocked(false)

      // Preload DB-scoped data before exposing the new active account in UI.
      const preloadVersion = fetchVersionRef.current
      let preloadSucceeded = false
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await fetchDataFromDB(
            keys,
            createdAccount.id,
            (loadedLocks) => {
              if (fetchVersionRef.current !== preloadVersion) return
              setLocks(loadedLocks)
            },
            () => fetchVersionRef.current !== preloadVersion
          )
          preloadSucceeded = true
          break
        } catch (e) {
          walletLogger.warn('Create-account DB preload failed', {
            accountId: createdAccount.id,
            attempt,
            error: String(e)
          })
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 75))
          }
        }
      }

      if (!preloadSucceeded) {
        resetSync()
        setLocks([])
      }

      switchInProgress = false
      lastSwitchCompletedAt = Date.now()
      setActiveAccountState(createdAccount, createdAccount.id)
      refreshAccounts().catch(e => walletLogger.warn('Background account refresh failed after create', e))
      walletLogger.info('Created account and switched successfully', { accountId: createdAccount.id })
      return true
    } catch (e) {
      walletLogger.error('Error creating account', e)
      return false
    } finally {
      switchingRef.current = false
      switchInProgress = false
    }
  }, [accounts, accountsCreateNewAccount, fetchDataFromDB, fetchVersionRef, refreshAccounts, resetKnownUnlockedLocks, resetSync, setActiveAccountState, setIsLocked, setLocks, setWallet, storeKeysInRust])

  const importAccount = useCallback(async (name: string, mnemonic: string): Promise<boolean> => {
    if (switchingRef.current) {
      walletLogger.warn('Account operation already in progress — import blocked')
      return false
    }

    switchingRef.current = true
    switchInProgress = true
    try {
      const currentPassword = getSessionPassword()
      if (currentPassword === null) {
        walletLogger.error('Cannot import account - no session password available')
        return false
      }
      const accountPassword = currentPassword === NO_PASSWORD ? null : currentPassword

      // Invalidate stale async callbacks and stop in-flight sync before the account changes.
      cancelSync()
      fetchVersionRef.current += 1
      resetKnownUnlockedLocks()

      const imported = await accountsImportAccount(name, mnemonic, accountPassword)
      if (!imported) return false

      const { keys, accountId } = imported
      const accountIndex = keys.accountIndex ?? accounts.length
      if (keys.accountIndex == null) {
        walletLogger.warn('keys.accountIndex was null, using fallback accounts.length', { fallback: accounts.length })
      }
      await storeKeysInRust(keys.mnemonic, accountIndex)

      const importedAccount = await getAccountById(accountId)
      if (!importedAccount || !importedAccount.id) {
        walletLogger.error('Imported account row not found after import', { accountId })
        return false
      }

      // CRITICAL ORDER: set wallet first, then activeAccountId, to prevent one-behind sync writes.
      setWallet({ ...keys, mnemonic: '' })
      setIsLocked(false)

      // Preload DB-scoped data before exposing the new active account in UI.
      const preloadVersion = fetchVersionRef.current
      let preloadSucceeded = false
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await fetchDataFromDB(
            keys,
            importedAccount.id,
            (loadedLocks) => {
              if (fetchVersionRef.current !== preloadVersion) return
              setLocks(loadedLocks)
            },
            () => fetchVersionRef.current !== preloadVersion
          )
          preloadSucceeded = true
          break
        } catch (e) {
          walletLogger.warn('Import-account DB preload failed', {
            accountId: importedAccount.id,
            attempt,
            error: String(e)
          })
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 75))
          }
        }
      }

      if (!preloadSucceeded) {
        resetSync()
        setLocks([])
      }

      switchInProgress = false
      lastSwitchCompletedAt = Date.now()
      setActiveAccountState(importedAccount, importedAccount.id)
      refreshAccounts().catch(e => walletLogger.warn('Background account refresh failed after import', e))

      // Discover derivative accounts for this mnemonic (non-blocking)
      discoverAccounts(mnemonic, accountPassword, importedAccount.id)
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
    } catch (e) {
      walletLogger.error('Error importing account', e)
      return false
    } finally {
      switchingRef.current = false
      switchInProgress = false
    }
  }, [accounts, accountsImportAccount, fetchDataFromDB, fetchVersionRef, refreshAccounts, resetKnownUnlockedLocks, resetSync, setActiveAccountState, setIsLocked, setLocks, setWallet, storeKeysInRust])

  const deleteAccount = useCallback(async (accountId: number): Promise<boolean> => {
    const success = await accountsDeleteAccount(accountId)
    if (success) {
      const active = await getActiveAccount()
      // B-103: Removed `wallet === null` check — it used a stale closure capture
      if (active) {
        // Try Rust derivation first, fall back to password
        let keys = await deriveKeysFromRust(active)
        if (!keys) {
          const currentPassword = getSessionPassword()
          if (currentPassword !== null) {
            keys = await getKeysForAccount(active, currentPassword)
          }
        }
        if (keys) {
          // Strip mnemonic from React state (mnemonic lives in Rust key store)
          setWallet({ ...keys, mnemonic: '' })
          await refreshAccounts()
          setActiveAccountState(active, active.id ?? null)
        } else {
          walletLogger.error('Cannot switch to remaining account after deletion — no keys available.')
        }
      }
    }
    return success
  }, [accountsDeleteAccount, setWallet, getKeysForAccount, refreshAccounts, setActiveAccountState])

  return {
    switchAccount,
    createNewAccount,
    importAccount,
    deleteAccount
  }
}
