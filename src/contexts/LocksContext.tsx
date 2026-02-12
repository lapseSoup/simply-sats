/**
 * LocksContext - Handles time-locked UTXO state and operations
 *
 * Extracted from WalletContext to improve maintainability.
 * Provides lock/unlock functionality for BSV timelocks.
 */

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { WalletKeys, LockedUTXO, UTXO } from '../services/wallet'
import { getUTXOs, lockBSV, unlockBSV, detectLockedUtxos } from '../services/wallet'
import { useNetwork } from './NetworkContext'
import { walletLogger } from '../services/logger'
import { audit } from '../services/auditLog'

interface LocksContextType {
  // State
  locks: LockedUTXO[]
  knownUnlockedLocks: Set<string>

  // State setters
  setLocks: (locks: LockedUTXO[]) => void
  addKnownUnlockedLock: (key: string) => void

  // Actions
  handleLock: (
    wallet: WalletKeys,
    amountSats: number,
    blocks: number,
    activeAccountId: number | null,
    onComplete: () => Promise<void>
  ) => Promise<{ success: boolean; txid?: string; error?: string }>

  handleUnlock: (
    wallet: WalletKeys,
    lock: LockedUTXO,
    activeAccountId: number | null,
    onComplete: () => Promise<void>
  ) => Promise<{ success: boolean; txid?: string; error?: string }>

  // Detection helper (called from SyncContext)
  detectLocks: (
    wallet: WalletKeys,
    utxos?: UTXO[]
  ) => Promise<LockedUTXO[]>
}

const LocksContext = createContext<LocksContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useLocksContext() {
  const context = useContext(LocksContext)
  if (!context) {
    throw new Error('useLocksContext must be used within a LocksProvider')
  }
  return context
}

interface LocksProviderProps {
  children: ReactNode
}

export function LocksProvider({ children }: LocksProviderProps) {
  const { networkInfo } = useNetwork()

  // Lock state
  const [locks, setLocks] = useState<LockedUTXO[]>([])
  const [knownUnlockedLocks, setKnownUnlockedLocks] = useState<Set<string>>(new Set())

  // Add a lock key to known unlocked set
  const addKnownUnlockedLock = useCallback((key: string) => {
    setKnownUnlockedLocks(prev => new Set([...prev, key]))
  }, [])

  // Detect locked UTXOs
  const detectLocks = useCallback(async (
    wallet: WalletKeys,
    _providedUtxos?: UTXO[]
  ): Promise<LockedUTXO[]> => {
    try {
      // Note: providedUtxos is passed but detectLockedUtxos fetches its own UTXOs
      // Keeping the parameter for potential future optimization
      const detectedLocks = await detectLockedUtxos(
        wallet.walletAddress,
        wallet.walletPubKey,
        knownUnlockedLocks
      )
      return detectedLocks
    } catch (e) {
      walletLogger.error('Failed to detect locks', e)
      return []
    }
  }, [knownUnlockedLocks])

  // Lock BSV for a number of blocks
  const handleLock = useCallback(async (
    wallet: WalletKeys,
    amountSats: number,
    blocks: number,
    activeAccountId: number | null,
    onComplete: () => Promise<void>
  ): Promise<{ success: boolean; txid?: string; error?: string }> => {
    const currentHeight = networkInfo?.blockHeight
    if (!currentHeight) return { success: false, error: 'Could not get block height' }

    try {
      const unlockBlock = currentHeight + blocks
      const walletUtxos = await getUTXOs(wallet.walletAddress)

      const result = await lockBSV(wallet.walletWif, amountSats, unlockBlock, walletUtxos, undefined, currentHeight, activeAccountId ?? undefined)

      // Add the locked UTXO to our list (functional updater to avoid stale closure)
      setLocks(prev => [...prev, result.lockedUtxo])

      await onComplete()
      // Audit log lock creation
      audit.lockCreated(result.txid, amountSats, unlockBlock, activeAccountId ?? undefined)
      return { success: true, txid: result.txid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Lock failed' }
    }
  }, [networkInfo])

  // Unlock a time-locked UTXO
  const handleUnlock = useCallback(async (
    wallet: WalletKeys,
    lock: LockedUTXO,
    activeAccountId: number | null,
    onComplete: () => Promise<void>
  ): Promise<{ success: boolean; txid?: string; error?: string }> => {
    const currentHeight = networkInfo?.blockHeight
    if (!currentHeight) return { success: false, error: 'Could not get block height' }

    try {
      const txid = await unlockBSV(wallet.walletWif, lock, currentHeight, activeAccountId ?? undefined)

      // Add to known-unlocked set BEFORE removing from state and fetching data
      // This prevents the race condition where detectLockedUtxos re-adds the lock
      const lockKey = `${lock.txid}:${lock.vout}`
      addKnownUnlockedLock(lockKey)

      // Functional updater to avoid stale closure
      setLocks(prev => prev.filter(l => l.txid !== lock.txid || l.vout !== lock.vout))

      await onComplete()
      // Audit log lock release
      audit.lockReleased(txid, lock.satoshis, activeAccountId ?? undefined)
      return { success: true, txid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unlock failed' }
    }
  }, [networkInfo, addKnownUnlockedLock])

  const value: LocksContextType = useMemo(() => ({
    locks,
    knownUnlockedLocks,
    setLocks,
    addKnownUnlockedLock,
    handleLock,
    handleUnlock,
    detectLocks
  }), [locks, knownUnlockedLocks, setLocks, addKnownUnlockedLock, handleLock, handleUnlock, detectLocks])

  return (
    <LocksContext.Provider value={value}>
      {children}
    </LocksContext.Provider>
  )
}
