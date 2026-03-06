import { useCallback, useEffect, useState } from 'react'
import type { ToastType } from '../contexts/UIContext'
import type { ActiveWallet } from '../domain/types'
import { getPrivateKeyForDisplay } from '../services/wallet'

interface UseWalletPrivateKeyDisplayOptions {
  wallet: ActiveWallet | null
  copyToClipboard: (text: string, successMessage?: string) => Promise<void> | void
  showToast: (message: string, type?: ToastType) => void
}

export function useWalletPrivateKeyDisplay({
  wallet,
  copyToClipboard,
  showToast
}: UseWalletPrivateKeyDisplayOptions) {
  const [showWif, setShowWif] = useState(false)
  const [displayWif, setDisplayWif] = useState('')
  const [loadingWif, setLoadingWif] = useState(false)

  const clearDisplayWif = useCallback(() => {
    setDisplayWif(prev => (prev ? '0'.repeat(prev.length) : prev))
    setDisplayWif('')
  }, [])

  useEffect(() => {
    return () => {
      clearDisplayWif()
    }
  }, [clearDisplayWif])

  useEffect(() => {
    setShowWif(false)
    clearDisplayWif()
  }, [clearDisplayWif, wallet?.walletAddress])

  const handleToggleWif = useCallback(async () => {
    if (showWif) {
      setShowWif(false)
      clearDisplayWif()
      return
    }

    try {
      setLoadingWif(true)
      const wif = await getPrivateKeyForDisplay('wallet', wallet ?? undefined)
      setDisplayWif(wif)
      setShowWif(true)
    } catch (err) {
      showToast(
        `Failed to load private key: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error'
      )
    } finally {
      setLoadingWif(false)
    }
  }, [clearDisplayWif, showToast, showWif, wallet])

  const handleCopyWif = useCallback(() => {
    if (!displayWif) return
    void copyToClipboard(displayWif, 'Private key copied!')
  }, [copyToClipboard, displayWif])

  return {
    showWif,
    displayWif,
    loadingWif,
    handleToggleWif,
    handleCopyWif
  }
}
