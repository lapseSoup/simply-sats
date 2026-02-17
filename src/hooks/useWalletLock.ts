/**
 * Hook for wallet lock/unlock screen logic, auto-lock, and visibility-based locking.
 *
 * Extracted from WalletContext to reduce god-object complexity.
 */

import { useState, useRef, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react'
import type { WalletKeys } from '../services/wallet'
import type { Account } from '../services/accounts'
import { getAllAccounts, getActiveAccount } from '../services/accounts'
import {
  initAutoLock,
  stopAutoLock,
  resetInactivityTimer,
  setInactivityLimit,
  minutesToMs
} from '../services/autoLock'
import {
  checkUnlockRateLimit,
  recordFailedUnlockAttempt,
  recordSuccessfulUnlock,
  formatLockoutTime
} from '../services/rateLimiter'
import { setWalletKeys } from '../services/brc100'
import { walletLogger } from '../services/logger'
import { audit } from '../services/auditLog'
import { invoke } from '@tauri-apps/api/core'
import { STORAGE_KEYS } from '../infrastructure/storage/localStorage'
import { setSessionPassword as setModuleSessionPassword, clearSessionPassword, NO_PASSWORD } from '../services/sessionPasswordStore'
import { hasPassword } from '../services/wallet/storage'
import { clearSessionKey } from '../services/secureStorage'

interface UseWalletLockOptions {
  activeAccount: Account | null
  activeAccountId: number | null
  getKeysForAccount: (account: Account, password: string | null) => Promise<WalletKeys | null>
  refreshAccounts: () => Promise<void>
  storeKeysInRust: (mnemonic: string, accountIndex: number) => Promise<void>
  setWalletState: Dispatch<SetStateAction<WalletKeys | null>>
}

interface UseWalletLockReturn {
  isLocked: boolean
  setIsLocked: Dispatch<SetStateAction<boolean>>
  sessionPassword: string | null
  setSessionPassword: Dispatch<SetStateAction<string | null>>
  autoLockMinutes: number
  lockWallet: () => Promise<void>
  unlockWallet: (password: string) => Promise<boolean>
  setAutoLockMinutes: (minutes: number) => void
}

export function useWalletLock({
  activeAccount,
  activeAccountId,
  getKeysForAccount,
  refreshAccounts,
  storeKeysInRust,
  setWalletState
}: UseWalletLockOptions): UseWalletLockReturn {
  const [isLocked, setIsLocked] = useState(false)
  const [autoLockMinutes, setAutoLockMinutesState] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.AUTO_LOCK_MINUTES)
    return saved ? parseInt(saved, 10) : 10
  })

  // Session password — ref holds the actual value (invisible to React DevTools),
  // counter state triggers re-renders when password changes so consumers update.
  const sessionPasswordRef = useRef<string | null>(null)
  const [_passwordVersion, setPasswordVersion] = useState(0)

  const setSessionPassword = useCallback((value: SetStateAction<string | null>) => {
    const newValue = typeof value === 'function' ? value(sessionPasswordRef.current) : value
    sessionPasswordRef.current = newValue
    setPasswordVersion(v => v + 1) // trigger re-render
  }, [])

  // Expose the actual password from the ref (not React state)
  const sessionPassword = sessionPasswordRef.current

  useEffect(() => {
    walletLogger.debug('Session password state changed', { hasPassword: sessionPasswordRef.current !== null })
  }, [_passwordVersion])

  // Session password lifetime is governed by the auto-lock timer (which resets on user activity).
  // No independent timeout needed — password is cleared when lockWallet() fires.

  // Lock wallet (clear keys from memory)
  const lockWallet = useCallback(async () => {
    if (!hasPassword()) {
      walletLogger.debug('lockWallet no-op: no password set')
      return
    }
    walletLogger.info('Locking wallet')
    setIsLocked(true)
    setWalletState(null)
    setWalletKeys(null)
    setSessionPassword(null)
    clearSessionPassword()
    clearSessionKey()
    try {
      await invoke('clear_keys')
    } catch (e) {
      walletLogger.warn('Failed to clear Rust key store', { error: String(e) })
    }
    audit.walletLocked(activeAccountId ?? undefined)
  }, [activeAccountId, setWalletState, setSessionPassword])

  // Lock wallet when app is hidden for extended period
  useEffect(() => {
    // We can't check `wallet` here (it's not in our scope), so we rely on
    // isLocked as a proxy. When isLocked is true, there's nothing to lock.
    if (isLocked || !hasPassword()) return

    const HIDDEN_LOCK_DELAY_MS = 60_000 // 60 seconds
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null

    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenTimer = setTimeout(() => {
          walletLogger.info('Locking wallet — app hidden for extended period')
          lockWallet().catch(e => {
            walletLogger.error('Failed to lock wallet on visibility change', { error: String(e) })
          })
        }, HIDDEN_LOCK_DELAY_MS)
      } else {
        if (hiddenTimer) {
          clearTimeout(hiddenTimer)
          hiddenTimer = null
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (hiddenTimer) clearTimeout(hiddenTimer)
    }
  }, [isLocked, lockWallet])

  // Unlock wallet with password (with rate limiting)
  const UNLOCK_MIN_TIME_MS = 500
  const unlockWallet = useCallback(async (password: string): Promise<boolean> => {
    const startTime = performance.now()

    try {
      const rateLimit = await checkUnlockRateLimit()
      if (rateLimit.isLimited) {
        const timeStr = formatLockoutTime(rateLimit.remainingMs)
        walletLogger.warn('Unlock blocked by rate limit', { remainingMs: rateLimit.remainingMs })
        throw new Error(`Too many failed attempts. Please wait ${timeStr} before trying again.`)
      }

      let account = activeAccount
      if (!account) {
        walletLogger.debug('No active account in state, fetching from database...')
        account = await getActiveAccount()
        if (!account) {
          const allAccounts = await getAllAccounts()
          if (allAccounts.length > 0) {
            account = allAccounts[0]!
          }
        }
      }

      if (!account) {
        walletLogger.error('No account found to unlock')
        return false
      }

      // Unprotected path — no PBKDF2, no rate limiting
      if (!hasPassword()) {
        const keys = await getKeysForAccount(account, null)
        if (keys) {
          setWalletState(keys)
          setWalletKeys(keys)
          setIsLocked(false)
          setSessionPassword(NO_PASSWORD)
          setModuleSessionPassword(NO_PASSWORD)
          resetInactivityTimer()
          await storeKeysInRust(keys.mnemonic, keys.accountIndex ?? 0)
          await refreshAccounts()
          walletLogger.info('Wallet unlocked (unprotected mode)')
          return true
        }
        return false
      }

      const keys = await getKeysForAccount(account, password)
      if (keys) {
        await recordSuccessfulUnlock()
        setWalletState(keys)
        setWalletKeys(keys)
        setIsLocked(false)
        setSessionPassword(password)
        setModuleSessionPassword(password)
        walletLogger.debug('Session password stored for account switching')
        resetInactivityTimer()
        await storeKeysInRust(keys.mnemonic, keys.accountIndex ?? 0)
        try {
          await Promise.race([
            invoke('rotate_session_for_account', { accountId: account.id }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('rotate_session timed out')), 5000))
          ])
        } catch (e) {
          walletLogger.warn('Failed to rotate session on unlock', { error: String(e) })
        }
        await refreshAccounts()
        walletLogger.info('Wallet unlocked successfully')
        audit.walletUnlocked(account.id)
        return true
      }

      const result = await recordFailedUnlockAttempt()
      audit.unlockFailed(account.id, 'incorrect_password')
      if (result.isLocked) {
        const timeStr = formatLockoutTime(result.lockoutMs)
        throw new Error(`Too many failed attempts. Please wait ${timeStr} before trying again.`)
      } else if (result.attemptsRemaining <= 2) {
        walletLogger.warn('Few unlock attempts remaining', { remaining: result.attemptsRemaining })
      }

      walletLogger.warn('Failed to decrypt keys - incorrect password')
      return false
    } catch (e) {
      if (e instanceof Error && e.message.includes('Too many failed attempts')) {
        throw e
      }
      walletLogger.error('Failed to unlock', e)
      return false
    } finally {
      const elapsed = performance.now() - startTime
      if (elapsed < UNLOCK_MIN_TIME_MS) {
        await new Promise(resolve => setTimeout(resolve, UNLOCK_MIN_TIME_MS - elapsed))
      }
    }
  }, [activeAccount, getKeysForAccount, refreshAccounts, storeKeysInRust, setWalletState, setSessionPassword])

  // Set auto-lock timeout
  const setAutoLockMinutes = useCallback((minutes: number) => {
    setAutoLockMinutesState(minutes)
    localStorage.setItem(STORAGE_KEYS.AUTO_LOCK_MINUTES, String(minutes))
    if (minutes > 0) {
      setInactivityLimit(minutesToMs(minutes))
    } else {
      stopAutoLock()
    }
  }, [])

  return {
    isLocked,
    setIsLocked,
    sessionPassword,
    setSessionPassword,
    autoLockMinutes,
    lockWallet,
    unlockWallet,
    setAutoLockMinutes
  }
}

// Re-export for WalletContext auto-lock initialization
export { initAutoLock, minutesToMs }
