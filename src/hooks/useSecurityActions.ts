import { useCallback } from 'react'
import { hasPassword } from '../services/wallet'
import { encryptAllAccounts } from '../services/accounts'
import { exportKeysToFile } from '../services/keyExport'
import { NO_PASSWORD, setSessionPassword as setModuleSessionPassword } from '../services/sessionPasswordStore'
import type { ActiveWallet } from '../domain/types'
import type { ToastType } from '../contexts/UIContext'

type SecurityResult =
  | { ok: true }
  | { ok: false; error: string }

export function useSecurityActions() {
  const isPasswordlessWallet = useCallback(() => {
    return !hasPassword()
  }, [])

  const sessionNeedsExportPassword = useCallback((sessionPassword: string | null) => {
    return sessionPassword === null || sessionPassword === NO_PASSWORD
  }, [])

  const exportPrivateKeys = useCallback(async (
    wallet: ActiveWallet,
    password: string,
    showToast: (msg: string, type?: ToastType) => void
  ) => {
    await exportKeysToFile(wallet, password, showToast)
  }, [])

  const enableWalletPassword = useCallback(async (
    newPassword: string,
    setSessionPassword: (password: string) => void,
    setAutoLockMinutes: (minutes: number) => void
  ): Promise<SecurityResult> => {
    const result = await encryptAllAccounts(newPassword)
    if (!result.ok) {
      return { ok: false, error: result.error.message }
    }

    setModuleSessionPassword(newPassword)
    setSessionPassword(newPassword)
    setAutoLockMinutes(10)
    return { ok: true }
  }, [])

  return {
    isPasswordlessWallet,
    sessionNeedsExportPassword,
    exportPrivateKeys,
    enableWalletPassword,
  }
}
