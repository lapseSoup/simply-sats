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
  clearWallet
} from '../services/wallet'
import {
  getActiveAccount,
  migrateToMultiAccount
} from '../services/accounts'
import {
  clearDatabase
} from '../services/database'
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
  resetSync: () => void
  setLocks: (locks: []) => void
  resetTokens: () => void
  resetAccounts: () => void
  setAutoLockMinutesState: (minutes: number) => void
}

interface UseWalletActionsReturn {
  handleCreateWallet: (password: string) => Promise<string | null>
  handleRestoreWallet: (mnemonic: string, password: string) => Promise<boolean>
  handleImportJSON: (json: string, password: string) => Promise<boolean>
  handleDeleteWallet: () => Promise<void>
  pendingDiscoveryRef: MutableRefObject<{ mnemonic: string; password: string; excludeAccountId?: number } | null>
  consumePendingDiscovery: () => { mnemonic: string; password: string; excludeAccountId?: number } | null
}

export function useWalletActions({
  setWallet,
  setIsLocked,
  setSessionPassword,
  setContacts,
  setFeeRateKBState,
  refreshAccounts,
  resetSync,
  setLocks,
  resetTokens,
  resetAccounts,
  setAutoLockMinutesState
}: UseWalletActionsOptions): UseWalletActionsReturn {
  // Stores pending account discovery params — consumed by App.tsx after initial sync completes
  const pendingDiscoveryRef = useRef<{ mnemonic: string; password: string; excludeAccountId?: number } | null>(null)

  const handleCreateWallet = useCallback(async (password: string): Promise<string | null> => {
    const validation = validatePassword(password)
    if (!validation.isValid) {
      throw new Error(validation.errors[0] || `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    }
    try {
      const keys = await createWallet()
      await saveWallet(keys, password)
      await migrateToMultiAccount(keys, password)
      await refreshAccounts()
      // Store keys in React state WITHOUT mnemonic (mnemonic lives in Rust key store)
      setWallet({ ...keys, mnemonic: '' })
      setSessionPassword(password)
      setModuleSessionPassword(password)
      audit.walletCreated()
      // Return mnemonic for display during onboarding
      return keys.mnemonic || null
    } catch (err) {
      walletLogger.error('Failed to create wallet', err)
      return null
    }
  }, [setWallet, setSessionPassword, refreshAccounts])

  const handleRestoreWallet = useCallback(async (mnemonic: string, password: string): Promise<boolean> => {
    const validation = validatePassword(password)
    if (!validation.isValid) {
      throw new Error(validation.errors[0] || `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    }
    try {
      const keys = await restoreWallet(mnemonic.trim())
      await saveWallet(keys, password)
      await migrateToMultiAccount({ ...keys, mnemonic: mnemonic.trim() }, password)
      await refreshAccounts()
      // Store keys in React state WITHOUT mnemonic (mnemonic lives in Rust key store)
      setWallet({ ...keys, mnemonic: '' })
      setSessionPassword(password)
      setModuleSessionPassword(password)
      // Queue account discovery for after initial sync completes
      const activeAcc = await getActiveAccount()
      pendingDiscoveryRef.current = { mnemonic: mnemonic.trim(), password, excludeAccountId: activeAcc?.id }
      audit.walletRestored()
      return true
    } catch (err) {
      walletLogger.error('Failed to restore wallet', err)
      return false
    }
  }, [setWallet, setSessionPassword, refreshAccounts])

  const handleImportJSON = useCallback(async (json: string, password: string): Promise<boolean> => {
    const validation = validatePassword(password)
    if (!validation.isValid) {
      throw new Error(validation.errors[0] || `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    }
    try {
      const keys = await importFromJSON(json)
      await saveWallet(keys, password)
      await migrateToMultiAccount(keys, password)
      await refreshAccounts()
      setWallet(keys)
      setSessionPassword(password)
      setModuleSessionPassword(password)
      return true
    } catch (err) {
      walletLogger.error('Failed to import JSON', err)
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
