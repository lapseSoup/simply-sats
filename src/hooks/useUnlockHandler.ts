/**
 * Hook for lock/unlock confirmation logic.
 *
 * Extracted from App.tsx to reduce the monolith.
 * Manages the confirm-unlock flow for individual and bulk lock unlocking.
 */

import { useCallback, useMemo } from 'react'
import type { LockedUTXO } from '../services/wallet'
import type { NetworkInfo } from '../contexts/NetworkContext'
import type { WalletResult } from '../domain/types'
import { isOk } from '../domain/types'
import type { ToastType } from '../contexts/UIContext'

interface UseUnlockHandlerOptions {
  locks: LockedUTXO[]
  networkInfo: NetworkInfo | null
  unlockConfirm: LockedUTXO | 'all' | null
  handleUnlock: (lock: LockedUTXO) => Promise<WalletResult>
  showToast: (message: string, type?: ToastType) => void
  setUnlocking: (txid: string | null) => void
  cancelUnlock: () => void
}

interface UseUnlockHandlerReturn {
  unlockableLocks: LockedUTXO[]
  handleConfirmUnlock: () => Promise<void>
}

/**
 * Computes unlockable locks (based on current block height) and provides
 * the confirm-unlock handler that processes individual or batch unlocks.
 */
export function useUnlockHandler({
  locks,
  networkInfo,
  unlockConfirm,
  handleUnlock,
  showToast,
  setUnlocking,
  cancelUnlock,
}: UseUnlockHandlerOptions): UseUnlockHandlerReturn {

  const unlockableLocks = useMemo(() => {
    const currentHeight = networkInfo?.blockHeight || 0
    return locks.filter(lock => currentHeight >= lock.unlockBlock)
  }, [networkInfo?.blockHeight, locks])

  const getUnlockableLocks = useCallback(() => unlockableLocks, [unlockableLocks])

  const handleConfirmUnlock = useCallback(async () => {
    if (!unlockConfirm) return

    const locksToUnlock = unlockConfirm === 'all' ? getUnlockableLocks() : [unlockConfirm]
    let succeeded = 0
    let failed = 0

    for (const lock of locksToUnlock) {
      setUnlocking(lock.txid)
      const result = await handleUnlock(lock)
      if (isOk(result)) {
        succeeded++
        showToast(`Unlocked ${lock.satoshis.toLocaleString()} sats!`)
      } else {
        failed++
        showToast(result.error || 'Unlock failed', 'error')
        // B-45: Short-circuit on first network error to avoid wasting time
        if (locksToUnlock.length > 1) break
      }
    }

    setUnlocking(null)
    // B-45: Only close modal if at least one unlock succeeded
    if (succeeded > 0 || failed === 0) {
      cancelUnlock()
    }
  }, [unlockConfirm, getUnlockableLocks, handleUnlock, showToast, setUnlocking, cancelUnlock])

  return { unlockableLocks, handleConfirmUnlock }
}
