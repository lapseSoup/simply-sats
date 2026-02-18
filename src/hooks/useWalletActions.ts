/**
 * Hook for wallet lifecycle actions: create, restore, import, delete.
 *
 * Extracted from WalletContext to reduce god-object complexity.
 */

import { useCallback, useRef, type MutableRefObject } from 'react'
import type { WalletKeys } from '../services/wallet'
import {
  createWallet,
  restoreWallet,
  importFromJSON,
  saveWallet,
  saveWalletUnprotected,
  clearWallet
} from '../services/wallet'
import type { Account } from '../services/accounts'
import {
  getActiveAccount,
  migrateToMultiAccount
} from '../services/accounts'
import {
  clearDatabase
} from '../infrastructure/database'
import {
  clearAllSimplySatsStorage
} from '../services/secureStorage'
import { stopAutoLock } from '../services/autoLock'
import { validatePassword, MIN_PASSWORD_LENGTH } from '../utils/passwordValidation'
import { walletLogger } from '../services/logger'
import { audit } from '../services/auditLog'
import { setSessionPassword as setModuleSessionPassword, clearSessionPassword } from '../services/sessionPasswordStore'

interface UseWalletActionsOptions {
  setWallet: (wallet: WalletKeys | null) => void
  setIsLocked: (locked: boolean) => void
  setSessionPassword: (password: string | null) => void
  setContacts: (contacts: []) => void
  setFeeRateKBState: (rate: number) => void
  refreshAccounts: () => Promise<void>
  setActiveAccountState: (account: Account | null, accountId: number | null) => void
  resetSync: () => void
  setLocks: (locks: []) => void
  resetTokens: () => void
  resetAccounts: () => void
  setAutoLockMinutesState: (minutes: number) => void
}

interface UseWalletActionsReturn {
  handleCreateWallet: (password: string | null, wordCount?: 12 | 24) => Promise<string | null>
  handleRestoreWallet: (mnemonic: string, password: string | null) => Promise<boolean>
  handleImportJSON: (json: string, password: string | null) => Promise<boolean>
  handleDeleteWallet: () => Promise<void>
  pendingDiscoveryRef: MutableRefObject<{ mnemonic: string; password: string | null; excludeAccountId?: number } | null>
  consumePendingDiscovery: () => { mnemonic: string; password: string | null; excludeAccountId?: number } | null
}

export function useWalletActions({
  setWallet,
  setIsLocked,
  setSessionPassword,
  setContacts,
  setFeeRateKBState,
  refreshAccounts,
  setActiveAccountState,
  resetSync,
  setLocks,
  resetTokens,
  resetAccounts,
  setAutoLockMinutesState
}: UseWalletActionsOptions): UseWalletActionsReturn {
  // Stores pending account discovery params — consumed by App.tsx after initial sync completes
  const pendingDiscoveryRef = useRef<{ mnemonic: string; password: string | null; excludeAccountId?: number } | null>(null)

  const handleCreateWallet = useCallback(async (password: string | null, wordCount: 12 | 24 = 12): Promise<string | null> => {
    if (password !== null) {
      const validation = validatePassword(password)
      if (!validation.isValid) {
        throw new Error(validation.errors[0] || `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      }
    }
    try {
      const result = await createWallet(wordCount)
      if (!result.ok) {
        walletLogger.error('Failed to create wallet', result.error)
        return null
      }
      const keys = result.value
      if (password !== null) {
        await saveWallet(keys, password)
      } else {
        await saveWalletUnprotected(keys)
      }
      await migrateToMultiAccount(keys, password)
      await refreshAccounts()
      const activeAccForCreate = await getActiveAccount()
      if (activeAccForCreate) {
        setActiveAccountState(activeAccForCreate, activeAccForCreate.id ?? null)
      }
      // Store keys in React state WITHOUT mnemonic (mnemonic lives in Rust key store)
      setWallet({ ...keys, mnemonic: '' })
      const sessionPwd = password ?? ''
      setSessionPassword(sessionPwd)
      setModuleSessionPassword(sessionPwd)
      audit.walletCreated()
      // Return mnemonic for display during onboarding
      return keys.mnemonic || null
    } catch (e) {
      walletLogger.error('Failed to create wallet', e)
      return null
    }
  }, [setWallet, setSessionPassword, refreshAccounts, setActiveAccountState])

  const handleRestoreWallet = useCallback(async (mnemonic: string, password: string | null): Promise<boolean> => {
    if (password !== null) {
      const validation = validatePassword(password)
      if (!validation.isValid) {
        throw new Error(validation.errors[0] || `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      }
    }
    try {
      const result = await restoreWallet(mnemonic.trim())
      if (!result.ok) {
        walletLogger.error('Failed to restore wallet', result.error)
        return false
      }
      const keys = result.value
      if (password !== null) {
        await saveWallet(keys, password)
      } else {
        await saveWalletUnprotected(keys)
      }
      await migrateToMultiAccount({ ...keys, mnemonic: mnemonic.trim() }, password)
      await refreshAccounts()
      // Ensure activeAccountId is set immediately so App.tsx auto-sync fires correctly.
      // refreshAccounts() sets state in AccountsContext asynchronously, but React may not
      // have propagated it before onSuccess() closes the modal. Explicitly setting it here
      // avoids a race where wallet is set but activeAccountId is still null.
      const activeAcc = await getActiveAccount()
      // Queue account discovery BEFORE any React state setters fire.
      // setActiveAccountState + setWallet trigger App.tsx's checkSync effect.
      // pendingDiscoveryRef must be populated before that effect runs, otherwise
      // consumePendingDiscovery() returns null and discovery is silently skipped.
      pendingDiscoveryRef.current = { mnemonic: mnemonic.trim(), password, excludeAccountId: activeAcc?.id }
      if (activeAcc) {
        setActiveAccountState(activeAcc, activeAcc.id ?? null)
      }
      // Store keys in React state WITHOUT mnemonic (mnemonic lives in Rust key store)
      setWallet({ ...keys, mnemonic: '' })
      const sessionPwd = password ?? ''
      setSessionPassword(sessionPwd)
      setModuleSessionPassword(sessionPwd)
      audit.walletRestored()
      return true
    } catch (e) {
      walletLogger.error('Failed to restore wallet', e)
      return false
    }
  }, [setWallet, setSessionPassword, refreshAccounts, setActiveAccountState])

  const handleImportJSON = useCallback(async (json: string, password: string | null): Promise<boolean> => {
    if (password !== null) {
      const validation = validatePassword(password)
      if (!validation.isValid) {
        throw new Error(validation.errors[0] || `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      }
    }
    try {
      const result = await importFromJSON(json)
      if (!result.ok) {
        walletLogger.error('Failed to import JSON', result.error)
        return false
      }
      const keys = result.value
      if (password !== null) {
        await saveWallet(keys, password)
      } else {
        await saveWalletUnprotected(keys)
      }
      await migrateToMultiAccount(keys, password)
      await refreshAccounts()
      setWallet(keys)
      const sessionPwd = password ?? ''
      setSessionPassword(sessionPwd)
      setModuleSessionPassword(sessionPwd)
      return true
    } catch (e) {
      walletLogger.error('Failed to import JSON', e)
      return false
    }
  }, [setWallet, setSessionPassword, refreshAccounts])

  const handleDeleteWallet = useCallback(async () => {
    // 1. Stop auto-lock timer
    stopAutoLock()

    // 2. Reset ALL React state FIRST so UI immediately redirects to setup screen
    setWallet(null)
    setIsLocked(false)
    setSessionPassword(null)
    clearSessionPassword()
    resetSync()
    setLocks([])
    setContacts([])
    setAutoLockMinutesState(10)
    setFeeRateKBState(50)
    resetTokens()
    resetAccounts()

    // 3. Clean up persistent storage (errors must not block UI reset)
    try {
      await clearWallet()
    } catch (e) {
      walletLogger.error('Failed to clear wallet storage during delete', e)
    }

    try {
      await clearDatabase()
    } catch (e) {
      walletLogger.error('Failed to clear database during delete', e)
    }

    try {
      clearAllSimplySatsStorage()
    } catch (e) {
      walletLogger.error('Failed to clear localStorage during delete', e)
    }

    walletLogger.info('Wallet deleted and all data cleared')
  }, [setWallet, setIsLocked, setSessionPassword, setContacts, setFeeRateKBState, resetSync, setLocks, resetTokens, resetAccounts, setAutoLockMinutesState])

  // Account discovery (deferred until after initial sync completes)
  const consumePendingDiscovery = useCallback(() => {
    const params = pendingDiscoveryRef.current
    pendingDiscoveryRef.current = null
    return params
  }, [])

  return {
    handleCreateWallet,
    handleRestoreWallet,
    handleImportJSON,
    handleDeleteWallet,
    pendingDiscoveryRef,
    consumePendingDiscovery
  }
}
