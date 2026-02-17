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
import type { WalletKeys, LockedUTXO, Ordinal } from '../services/wallet'
import type { Account } from '../services/accounts'
import type { TxHistoryItem } from '../contexts/SyncContext'
import { getActiveAccount, switchAccount as switchAccountDb } from '../services/accounts'
import { discoverAccounts } from '../services/accountDiscovery'
import {
  getLocks as getLocksFromDB,
  getAllTransactions,
  type Transaction
} from '../services/database'
import {
  getOrdinalsFromDatabase,
  getBalanceFromDatabase,
  mapDbLocksToLockedUtxos,
  cancelSync
} from '../services/sync'
import { walletLogger } from '../services/logger'
import { invoke } from '@tauri-apps/api/core'
import { getSessionPassword, clearSessionPassword } from '../services/sessionPasswordStore'
import { deriveWalletKeysForAccount } from '../domain/wallet'

// Diagnostic: last failure reason (visible to UI for debugging)
let _lastSwitchDiag = ''
export function getLastSwitchDiag(): string { return _lastSwitchDiag }

interface UseAccountSwitchingOptions {
  fetchVersionRef: MutableRefObject<number>
  accountsSwitchAccount: (accountId: number, password: string | null) => Promise<WalletKeys | null>
  accountsCreateNewAccount: (name: string, password: string | null) => Promise<WalletKeys | null>
  accountsImportAccount: (name: string, mnemonic: string, password: string | null) => Promise<WalletKeys | null>
  accountsDeleteAccount: (accountId: number) => Promise<boolean>
  getKeysForAccount: (account: Account, password: string | null) => Promise<WalletKeys | null>
  setWallet: (wallet: WalletKeys | null) => void
  setIsLocked: Dispatch<SetStateAction<boolean>>
  setLocks: (locks: LockedUTXO[]) => void
  setOrdinals: (ordinals: Ordinal[]) => void
  setBalance: (balance: number) => void
  setTxHistory: (history: TxHistoryItem[]) => void
  resetSync: () => void
  storeKeysInRust: (mnemonic: string, accountIndex: number) => Promise<void>
  refreshAccounts: () => Promise<void>
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
 * Derive keys for an account from the Rust key store's mnemonic.
 * Returns null if mnemonic is not available (wallet locked or cleared).
 */
async function deriveKeysFromRust(account: Account): Promise<WalletKeys | null> {
  try {
    _lastSwitchDiag = 'Rust: calling get_mnemonic...'
    const mnemonic = await invoke<string | null>('get_mnemonic')
    if (!mnemonic) {
      _lastSwitchDiag = 'Rust: get_mnemonic returned NULL'
      return null
    }
    _lastSwitchDiag = `Rust: got mnemonic (${mnemonic.split(' ').length} words), deriving...`

    const accountIndex = account.derivationIndex ?? ((account.id ?? 1) - 1)
    const keys = await deriveWalletKeysForAccount(mnemonic, accountIndex)
    if (!keys) {
      _lastSwitchDiag = `Rust: derivation returned null for idx=${accountIndex}`
      return null
    }
    _lastSwitchDiag = `Rust: OK addr=${keys.walletAddress?.substring(0, 8)}`
    return keys
  } catch (e) {
    _lastSwitchDiag = `Rust: THREW ${String(e).substring(0, 80)}`
    walletLogger.warn('Failed to derive keys from Rust key store', { error: String(e) })
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
  setOrdinals,
  setBalance,
  setTxHistory,
  resetSync,
  storeKeysInRust,
  refreshAccounts,
  wallet,
  accounts
}: UseAccountSwitchingOptions): UseAccountSwitchingReturn {

  // Mutex to prevent concurrent account switches
  const switchingRef = useRef(false)

  const switchAccount = useCallback(async (accountId: number): Promise<boolean> => {
    if (switchingRef.current) {
      walletLogger.warn('Account switch already in progress — ignoring concurrent request', { accountId })
      return false
    }
    switchingRef.current = true
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

      // PRIMARY PATH: Derive keys from Rust key store's mnemonic (no password needed).
      // This bypasses all React state / closure issues with sessionPassword.
      let keys = await deriveKeysFromRust(account)

      if (keys) {
        // Rust-derived keys — update DB active account
        _lastSwitchDiag += ' | keys OK, updating DB...'
        const dbSuccess = await switchAccountDb(accountId)
        if (!dbSuccess) {
          _lastSwitchDiag += ' | DB update FAILED'
          walletLogger.error('Failed to update active account in database')
          return false
        }
        await refreshAccounts()
        _lastSwitchDiag += ' | DB+refresh OK'
      } else {
        // FALLBACK: If Rust has no mnemonic (shouldn't happen while wallet is unlocked),
        // try the password-based approach via the module-level session password store.
        // Read current password before clearing to prevent destroying the credential we need.
        const currentPassword = getSessionPassword()
        clearSessionPassword()
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
        keys = await accountsSwitchAccount(accountId, currentPassword)
        _lastSwitchDiag += keys ? ' | pwd-keys OK' : ' | pwd-keys NULL'
      }

      if (keys) {
        // Invalidate any in-flight fetchData callbacks from the previous account
        fetchVersionRef.current += 1
        // Clear stale state from previous account before setting new wallet
        setLocks([])
        resetSync()

        // Store mnemonic in Rust key store before clearing from React state
        await storeKeysInRust(keys.mnemonic, keys.accountIndex ?? ((accountId ?? 1) - 1))

        // Set wallet WITHOUT mnemonic in React state (mnemonic lives in Rust key store)
        setWallet({ ...keys, mnemonic: '' })
        setIsLocked(false)

        // Rotate session token for new account
        try {
          await Promise.race([
            invoke('rotate_session_for_account', { accountId }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('rotate_session timed out')), 5000))
          ])
        } catch (e) {
          walletLogger.warn('Failed to rotate session for account', { accountId, error: String(e) })
        }

        // Preload locks from DB instantly
        const preloadVersion = fetchVersionRef.current
        try {
          const dbLocks = await getLocksFromDB(0, accountId)
          if (fetchVersionRef.current !== preloadVersion) {
            walletLogger.debug('Skipping lock preload — account switch detected during DB query')
          } else if (dbLocks.length > 0) {
            setLocks(mapDbLocksToLockedUtxos(dbLocks, keys.walletPubKey))
          }
        } catch (_e) {
          // Best-effort: full sync will pick up locks anyway
        }

        // Preload ordinals from DB
        try {
          const dbOrdinals = await getOrdinalsFromDatabase(accountId)
          if (fetchVersionRef.current === preloadVersion && dbOrdinals.length > 0) {
            setOrdinals(dbOrdinals)
          }
        } catch (_e) {
          // Best-effort
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

        // Bump version again AFTER preload
        fetchVersionRef.current += 1

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
    }
  }, [accounts, accountsSwitchAccount, refreshAccounts, setWallet, setLocks, setOrdinals, setBalance, setTxHistory, resetSync, storeKeysInRust, fetchVersionRef, setIsLocked])

  const createNewAccount = useCallback(async (name: string): Promise<boolean> => {
    const currentPassword = getSessionPassword()
    if (currentPassword === null) {
      walletLogger.error('Cannot create account - no session password available')
      return false
    }
    if (accounts.length >= 10) {
      walletLogger.warn('Account creation blocked - maximum 10 accounts reached')
      return false
    }
    const keys = await accountsCreateNewAccount(name, currentPassword)
    if (keys) {
      // Store mnemonic in Rust key store before clearing from React state
      await storeKeysInRust(keys.mnemonic, keys.accountIndex ?? (accounts.length))
      // Set wallet WITHOUT mnemonic in React state (mnemonic lives in Rust key store)
      setWallet({ ...keys, mnemonic: '' })
      setIsLocked(false)
      return true
    }
    return false
  }, [accountsCreateNewAccount, setWallet, setIsLocked, accounts.length, storeKeysInRust])

  const importAccount = useCallback(async (name: string, mnemonic: string): Promise<boolean> => {
    const currentPassword = getSessionPassword()
    if (currentPassword === null) {
      walletLogger.error('Cannot import account - no session password available')
      return false
    }
    const keys = await accountsImportAccount(name, mnemonic, currentPassword)
    if (keys) {
      // Store mnemonic in Rust key store before clearing from React state
      await storeKeysInRust(keys.mnemonic, keys.accountIndex ?? (accounts.length))
      // Set wallet WITHOUT mnemonic in React state (mnemonic lives in Rust key store)
      setWallet({ ...keys, mnemonic: '' })
      setIsLocked(false)
      // Discover derivative accounts for this mnemonic (non-blocking)
      const active = await getActiveAccount()
      discoverAccounts(mnemonic, currentPassword, active?.id)
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
  }, [accountsImportAccount, setWallet, setIsLocked, refreshAccounts, accounts.length, storeKeysInRust])

  const deleteAccount = useCallback(async (accountId: number): Promise<boolean> => {
    const success = await accountsDeleteAccount(accountId)
    if (success) {
      const active = await getActiveAccount()
      if (active && wallet === null) {
        // Try Rust derivation first, fall back to password
        let keys = await deriveKeysFromRust(active)
        if (!keys) {
          const currentPassword = getSessionPassword()
          if (currentPassword !== null) {
            keys = await getKeysForAccount(active, currentPassword)
          }
        }
        if (keys) {
          setWallet(keys)
        } else {
          walletLogger.error('Cannot switch to remaining account after deletion — no keys available.')
        }
      }
    }
    return success
  }, [accountsDeleteAccount, wallet, setWallet, getKeysForAccount])

  return {
    switchAccount,
    createNewAccount,
    importAccount,
    deleteAccount
  }
}
