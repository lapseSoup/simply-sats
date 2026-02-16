/**
 * Hook for account switching with DB preloading.
 *
 * Extracted from WalletContext to reduce god-object complexity.
 */

import { useCallback, useRef, useEffect, type MutableRefObject, type Dispatch, type SetStateAction } from 'react'
import type { WalletKeys, LockedUTXO, Ordinal } from '../services/wallet'
import type { Account } from '../services/accounts'
import type { TxHistoryItem } from '../contexts/SyncContext'
import { getActiveAccount } from '../services/accounts'
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

interface UseAccountSwitchingOptions {
  sessionPassword: string | null
  fetchVersionRef: MutableRefObject<number>
  accountsSwitchAccount: (accountId: number, password: string) => Promise<WalletKeys | null>
  accountsCreateNewAccount: (name: string, password: string) => Promise<WalletKeys | null>
  accountsImportAccount: (name: string, mnemonic: string, password: string) => Promise<WalletKeys | null>
  accountsDeleteAccount: (accountId: number) => Promise<boolean>
  getKeysForAccount: (account: Account, password: string) => Promise<WalletKeys | null>
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

export function useAccountSwitching({
  sessionPassword,
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
  // Use ref to avoid stale closure — sessionPassword may update after callback creation
  const sessionPasswordRef = useRef(sessionPassword)
  useEffect(() => {
    sessionPasswordRef.current = sessionPassword
  }, [sessionPassword])

  const switchAccount = useCallback(async (accountId: number): Promise<boolean> => {
    const currentPassword = sessionPasswordRef.current
    walletLogger.debug('switchAccount called', { accountId, hasSessionPassword: !!currentPassword })
    if (!currentPassword) {
      walletLogger.error('Cannot switch account - no session password available. User must re-unlock wallet.')
      return false
    }
    try {
      // Cancel any in-flight sync for the previous account before switching
      cancelSync()

      const keys = await accountsSwitchAccount(accountId, currentPassword)
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
      walletLogger.error('Failed to switch account - invalid password or account not found')
      return false
    } catch (e) {
      walletLogger.error('Error switching account', e)
      return false
    }
  }, [accountsSwitchAccount, setWallet, setLocks, setOrdinals, setBalance, setTxHistory, resetSync, storeKeysInRust, fetchVersionRef, setIsLocked])

  const createNewAccount = useCallback(async (name: string): Promise<boolean> => {
    const currentPassword = sessionPasswordRef.current
    if (!currentPassword) {
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
    const currentPassword = sessionPasswordRef.current
    if (!currentPassword) {
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
        const currentPassword = sessionPasswordRef.current
        if (!currentPassword) {
          walletLogger.error('Cannot switch to remaining account after deletion — no session password. User must re-unlock.')
          return success
        }
        const keys = await getKeysForAccount(active, currentPassword)
        if (keys) {
          setWallet(keys)
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
