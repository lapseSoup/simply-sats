/**
 * Hook for wallet initialization: database setup, migration, and wallet loading.
 *
 * Extracted from WalletContext to reduce god-object complexity.
 */

import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react'
import type { WalletKeys } from '../services/wallet'
import type { Contact } from '../infrastructure/database'
import {
  loadWallet,
  hasWallet
} from '../services/wallet'
import {
  initDatabase,
  repairUTXOs,
  ensureDerivedAddressesTable,
  ensureContactsTable,
  getContacts,
  deleteTransactionsForAccount
} from '../infrastructure/database'
import {
  getAllAccounts,
  migrateToMultiAccount
} from '../services/accounts'
import {
  migrateToSecureStorage
} from '../services/secureStorage'
import { walletLogger, uiLogger } from '../services/logger'
import { STORAGE_KEYS } from '../infrastructure/storage/localStorage'
import { setSessionPassword as setModuleSessionPassword } from '../services/sessionPasswordStore'
import { hasPassword } from '../services/wallet/storage'

interface UseWalletInitOptions {
  setWallet: (wallet: WalletKeys | null) => void
  setIsLocked: Dispatch<SetStateAction<boolean>>
  setSessionPassword: (password: string | null) => void
  refreshAccounts: () => Promise<void>
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
  refreshAccounts
}: UseWalletInitOptions): UseWalletInitReturn {
  const [loading, setLoading] = useState(true)
  const [contacts, setContacts] = useState<Contact[]>([])

  // Initialize database and load wallet on mount
  useEffect(() => {
    let mounted = true

    const init = async () => {
      try {
        await migrateToSecureStorage()
        if (!mounted) return

        // Retry DB init up to 3 times with backoff (ARCH-3: graceful degradation)
        let initAttempts = 0
        const MAX_INIT_ATTEMPTS = 3
        while (initAttempts < MAX_INIT_ATTEMPTS) {
          try {
            await initDatabase()
            break
          } catch (dbErr) {
            initAttempts++
            uiLogger.error(`Database init failed (attempt ${initAttempts}/${MAX_INIT_ATTEMPTS})`, dbErr)
            if (initAttempts >= MAX_INIT_ATTEMPTS) throw dbErr
            if (!mounted) return
            await new Promise(resolve => setTimeout(resolve, 500 * initAttempts))
          }
        }
        if (!mounted) return
        uiLogger.info('Database initialized successfully')

        const repaired = await repairUTXOs()
        if (!mounted) return
        if (repaired > 0) {
          uiLogger.info('Repaired UTXOs', { count: repaired })
        }

        // One-time cleanup: delete corrupted transactions for non-account-1 accounts
        try {
          const cleanupFlag = STORAGE_KEYS.TX_CLEANUP_V1
          if (!localStorage.getItem(cleanupFlag)) {
            const accounts = await getAllAccounts()
            for (const acc of accounts) {
              if (acc.id && acc.id !== 1) {
                const result = await deleteTransactionsForAccount(acc.id)
                if (!result.ok) {
                  walletLogger.warn('Failed to clean transactions for account', { accountId: acc.id, error: result.error.message })
                } else {
                  walletLogger.info('Cleaned corrupted transactions', { accountId: acc.id })
                }
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
        const contactsResult = await getContacts()
        if (!mounted) return
        if (contactsResult.ok) {
          setContacts(contactsResult.value)
          uiLogger.info('Loaded contacts', { count: contactsResult.value.length })
        } else {
          uiLogger.error('Failed to load contacts from DB', contactsResult.error)
        }

        await refreshAccounts()
        if (!mounted) return
      } catch (err) {
        uiLogger.error('Failed to initialize database', err)
        if (mounted) setLoading(false)
        return
      }

      if (!mounted) return

      // Try to load wallet (legacy support + new account system)
      if (await hasWallet()) {
        const allAccounts = await getAllAccounts()
        if (!mounted) return

        if (allAccounts.length > 0) {
          if (hasPassword()) {
            walletLogger.info('Found encrypted wallet with accounts, showing lock screen')
            setIsLocked(true)
          } else {
            // Passwordless wallet — load directly, no lock screen
            walletLogger.info('Found unprotected wallet, loading directly')
            try {
              const keys = await loadWallet(null)
              if (!mounted) return
              if (keys) {
                setWallet({ ...keys, mnemonic: '' })
                setSessionPassword('')
                setModuleSessionPassword('')
              } else {
                walletLogger.error('Failed to load unprotected wallet')
                setIsLocked(true) // Fallback to lock screen
              }
            } catch (e) {
              walletLogger.error('Error loading unprotected wallet', e)
              setIsLocked(true) // Fallback
            }
          }
        } else {
          // No accounts yet - try loading with empty password (legacy unencrypted support)
          try {
            const keys = await loadWallet('')
            if (!mounted) return
            if (keys) {
              // Set wallet WITHOUT mnemonic in React state (mnemonic lives in Rust key store)
              setWallet({ ...keys, mnemonic: '' })
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
      }
      if (!mounted) return
      setLoading(false)
    }
    init()

    return () => {
      mounted = false
    }
  }, [setWallet, setIsLocked, setSessionPassword, refreshAccounts])

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
