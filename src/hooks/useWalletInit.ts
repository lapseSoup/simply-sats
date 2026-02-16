/**
 * Hook for wallet initialization: database setup, migration, and wallet loading.
 *
 * Extracted from WalletContext to reduce god-object complexity.
 */

import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react'
import type { WalletKeys } from '../services/wallet'
import type { Contact } from '../services/database'
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
} from '../services/database'
import {
  getAllAccounts,
  migrateToMultiAccount
} from '../services/accounts'
import {
  migrateToSecureStorage
} from '../services/secureStorage'
import { walletLogger, uiLogger } from '../services/logger'

interface UseWalletInitOptions {
  setWallet: (wallet: WalletKeys | null) => void
  setIsLocked: Dispatch<SetStateAction<boolean>>
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

        await initDatabase()
        if (!mounted) return
        uiLogger.info('Database initialized successfully')

        const repaired = await repairUTXOs()
        if (!mounted) return
        if (repaired > 0) {
          uiLogger.info('Repaired UTXOs', { count: repaired })
        }

        // One-time cleanup: delete corrupted transactions for non-account-1 accounts
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
          walletLogger.info('Found encrypted wallet with accounts, showing lock screen')
          setIsLocked(true)
        } else {
          // No accounts yet - try loading with empty password (legacy unencrypted support)
          try {
            const keys = await loadWallet('')
            if (!mounted) return
            if (keys) {
              setWallet(keys)
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
  }, [setWallet, setIsLocked, refreshAccounts])

  // Migration: remove old localStorage locks (database is source of truth)
  useEffect(() => {
    localStorage.removeItem('simply_sats_locks')
  }, [])

  const refreshContacts = useCallback(async () => {
    const loaded = await getContacts()
    setContacts(loaded)
  }, [])

  return {
    loading,
    contacts,
    setContacts,
    refreshContacts
  }
}
