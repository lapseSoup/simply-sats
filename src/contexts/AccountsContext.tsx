import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { WalletKeys } from '../services/wallet'
import { restoreWallet } from '../services/wallet'
import { deriveWalletKeysForAccount } from '../domain/wallet'
import {
  type Account,
  getAllAccounts,
  getActiveAccount,
  getAccountKeys,
  switchAccount as switchAccountDb,
  createAccount,
  deleteAccount as deleteAccountDb,
  updateAccountName,
} from '../services/accounts'
import { accountLogger } from '../services/logger'

interface AccountsContextType {
  // Account state
  accounts: Account[]
  activeAccount: Account | null
  activeAccountId: number | null

  // Account actions
  switchAccount: (accountId: number, password: string) => Promise<WalletKeys | null>
  createNewAccount: (name: string, password: string) => Promise<WalletKeys | null>
  importAccount: (name: string, mnemonic: string, password: string) => Promise<WalletKeys | null>
  deleteAccount: (accountId: number) => Promise<boolean>
  renameAccount: (accountId: number, name: string) => Promise<void>
  refreshAccounts: () => Promise<void>

  // Reset all account state (for wallet deletion)
  resetAccounts: () => void

  // For WalletContext to set the active account after switch
  setActiveAccountState: (account: Account | null, accountId: number | null) => void

  // Get keys for unlock
  getKeysForAccount: (account: Account, password: string) => Promise<WalletKeys | null>
}

const AccountsContext = createContext<AccountsContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useAccounts() {
  const context = useContext(AccountsContext)
  if (!context) {
    throw new Error('useAccounts must be used within an AccountsProvider')
  }
  return context
}

interface AccountsProviderProps {
  children: ReactNode
}

export function AccountsProvider({ children }: AccountsProviderProps) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeAccount, setActiveAccount] = useState<Account | null>(null)
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null)

  const setActiveAccountState = useCallback((account: Account | null, accountId: number | null) => {
    setActiveAccount(account)
    setActiveAccountId(accountId)
  }, [])

  const resetAccounts = useCallback(() => {
    setAccounts([])
    setActiveAccount(null)
    setActiveAccountId(null)
  }, [])

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
      accountLogger.error('Failed to refresh accounts', e)
    }
  }, [])

  const getKeysForAccount = useCallback(async (account: Account, password: string): Promise<WalletKeys | null> => {
    try {
      return await getAccountKeys(account, password)
    } catch (e) {
      accountLogger.error('Failed to get account keys', e)
      return null
    }
  }, [])

  // Switch account - returns keys if successful, null if failed
  const switchAccount = useCallback(async (accountId: number, password: string): Promise<WalletKeys | null> => {
    try {
      const account = accounts.find(a => a.id === accountId)
      if (!account) {
        accountLogger.error('Account not found')
        return null
      }

      const keys = await getAccountKeys(account, password)
      if (!keys) {
        accountLogger.error('Invalid password')
        return null
      }

      const success = await switchAccountDb(accountId)
      if (!success) return null

      setActiveAccount(account)
      setActiveAccountId(accountId)
      await refreshAccounts()

      accountLogger.info(`Switched to account ${account.name}`)
      return keys
    } catch (e) {
      accountLogger.error('Failed to switch account', e)
      return null
    }
  }, [accounts, refreshAccounts])

  // Create new account - derives from the same mnemonic with new account index
  const createNewAccount = useCallback(async (name: string, password: string): Promise<WalletKeys | null> => {
    try {
      // Get all accounts sorted by ID to find the original (first created) account
      const allAccounts = await getAllAccounts()
      if (allAccounts.length === 0) {
        accountLogger.error('No existing account to derive from')
        return null
      }

      // Sort by ID to get the first account (lowest ID = first created = index 0)
      const sortedAccounts = [...allAccounts].sort((a, b) => (a.id || 0) - (b.id || 0))
      const firstAccount = sortedAccounts[0]

      accountLogger.debug('Getting keys from first account', {
        accountId: firstAccount!.id,
        name: firstAccount!.name,
        totalAccounts: allAccounts.length
      })

      const firstAccountKeys = await getAccountKeys(firstAccount!, password)
      if (!firstAccountKeys) {
        accountLogger.error('Invalid password or failed to get keys from first account')
        return null
      }

      // Derive keys for the new account using the next available index
      // Account indices: 0 (first), 1, 2, 3, etc.
      const newAccountIndex = allAccounts.length
      accountLogger.debug('Deriving keys for new account', { newAccountIndex })

      const keys = await deriveWalletKeysForAccount(firstAccountKeys.mnemonic, newAccountIndex)

      // Use legacy password requirements since we're reusing the session password
      // (which may have been created under older, less strict requirements)
      const accountId = await createAccount(name, keys, password, true)
      if (!accountId) {
        accountLogger.error('Failed to create account in database')
        return null
      }

      await refreshAccounts()
      accountLogger.info(`Created derived account: ${name} at index ${newAccountIndex}`)
      return keys
    } catch (e) {
      accountLogger.error('Failed to create account', e)
      return null
    }
  }, [refreshAccounts])

  // Import account from external mnemonic
  const importAccount = useCallback(async (name: string, mnemonic: string, password: string): Promise<WalletKeys | null> => {
    try {
      const keys = await restoreWallet(mnemonic)
      // Use legacy password requirements since we're reusing the session password
      const accountId = await createAccount(name, keys, password, true)
      if (!accountId) return null

      await refreshAccounts()
      accountLogger.info(`Imported account: ${name}`)
      return keys
    } catch (e) {
      accountLogger.error('Failed to import account', e)
      return null
    }
  }, [refreshAccounts])

  // Delete account
  const deleteAccount = useCallback(async (accountId: number): Promise<boolean> => {
    try {
      const success = await deleteAccountDb(accountId)
      if (success) {
        await refreshAccounts()
      }
      return success
    } catch (e) {
      accountLogger.error('Failed to delete account', e)
      return false
    }
  }, [refreshAccounts])

  // Rename account
  const renameAccount = useCallback(async (accountId: number, name: string): Promise<void> => {
    await updateAccountName(accountId, name)
    await refreshAccounts()
  }, [refreshAccounts])

  const value: AccountsContextType = useMemo(() => ({
    accounts,
    activeAccount,
    activeAccountId,
    switchAccount,
    createNewAccount,
    importAccount,
    deleteAccount,
    renameAccount,
    refreshAccounts,
    resetAccounts,
    setActiveAccountState,
    getKeysForAccount
  }), [accounts, activeAccount, activeAccountId, switchAccount, createNewAccount, importAccount, deleteAccount, renameAccount, refreshAccounts, resetAccounts, setActiveAccountState, getKeysForAccount])

  return (
    <AccountsContext.Provider value={value}>
      {children}
    </AccountsContext.Provider>
  )
}
