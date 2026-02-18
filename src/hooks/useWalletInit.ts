/**
 * Hook for wallet initialization: database setup, migration, and wallet loading.
 *
 * Extracted from WalletContext to reduce god-object complexity.
 */

import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react'
import type { WalletKeys, PublicWalletKeys } from '../services/wallet'
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
  getContacts
} from '../infrastructure/database'
import {
  getAllAccounts,
  getActiveAccount,
  migrateToMultiAccount
} from '../services/accounts'
import { invoke } from '@tauri-apps/api/core'
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
  storeKeysInRust: (mnemonic: string, accountIndex: number) => Promise<void>
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
  storeKeysInRust
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

        const repairResult = await repairUTXOs()
        if (!mounted) return
        if (repairResult.ok && repairResult.value > 0) {
          uiLogger.info('Repaired UTXOs', { count: repairResult.value })
        } else if (!repairResult.ok) {
          uiLogger.warn('Failed to repair UTXOs', { error: repairResult.error.message })
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
                // Populate Rust key store so operations like lockBSV/unlockBSV can get the WIF.
                // This is required for no-password wallets — the unlock flow (useWalletLock)
                // is skipped entirely, so we must store keys here on startup.
                if (keys.mnemonic) {
                  await storeKeysInRust(keys.mnemonic, keys.accountIndex ?? 0)
                }

                // CRITICAL: loadWallet always returns Account 1 keys (from secure storage).
                // If the active account in the DB is different (e.g. Account 7, derivation
                // index 1), we must derive the CORRECT keys so the wallet address, public
                // keys, and React state all match the active account.  Without this, the UI
                // shows Account 1's address but Account 7's balance/history (or vice-versa),
                // causing the cross-account data bleed.
                let walletKeys = keys
                try {
                  const activeAccount = await getActiveAccount()
                  if (!mounted) return
                  if (activeAccount) {
                    const targetIndex = activeAccount.derivationIndex ?? ((activeAccount.id ?? 1) - 1)
                    const loadedIndex = keys.accountIndex ?? 0
                    if (targetIndex !== loadedIndex) {
                      walletLogger.info('Active account differs from loaded keys — deriving correct account keys', {
                        activeAccountId: activeAccount.id,
                        targetIndex,
                        loadedIndex
                      })
                      try {
                        const pubKeys = await invoke<PublicWalletKeys>('switch_account_from_store', { accountIndex: targetIndex })
                        walletKeys = {
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
                          accountIndex: targetIndex
                        }
                        walletLogger.info('Derived correct active account keys on startup', {
                          accountId: activeAccount.id, targetIndex, address: walletKeys.walletAddress?.substring(0, 12)
                        })
                      } catch (rustErr) {
                        walletLogger.warn('Failed to derive active account keys from Rust — falling back to stored keys', { error: String(rustErr) })
                        // Fall back to the stored keys (Account 1) — less ideal but better than crash
                      }
                    }
                  }
                } catch (activeAccErr) {
                  walletLogger.warn('Failed to determine active account on startup — using stored keys', { error: String(activeAccErr) })
                }

                setWallet({ ...walletKeys, mnemonic: '' })
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
  }, [setWallet, setIsLocked, setSessionPassword, refreshAccounts, storeKeysInRust])

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
