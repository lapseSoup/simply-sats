import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { WalletKeys } from '../services/wallet'
import { createWallet, restoreWallet } from '../services/wallet'
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

  // Create new account - returns keys if successful
  const createNewAccount = useCallback(async (name: string, password: string): Promise<WalletKeys | null> => {
    try {
      const keys = createWallet()
      const accountId = await createAccount(name, keys, password)
      if (!accountId) return null

      await refreshAccounts()
      accountLogger.info(`Created new account: ${name}`)
      return keys
    } catch (e) {
      accountLogger.error('Failed to create account', e)
      return null
    }
  }, [refreshAccounts])

  // Import account from external mnemonic
  const importAccount = useCallback(async (name: string, mnemonic: string, password: string): Promise<WalletKeys | null> => {
    try {
      const keys = restoreWallet(mnemonic)
      const accountId = await createAccount(name, keys, password)
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

  const value: AccountsContextType = {
    accounts,
    activeAccount,
    activeAccountId,
    switchAccount,
    createNewAccount,
    importAccount,
    deleteAccount,
    renameAccount,
    refreshAccounts,
    setActiveAccountState,
    getKeysForAccount
  }

  return (
    <AccountsContext.Provider value={value}>
      {children}
    </AccountsContext.Provider>
  )
}
