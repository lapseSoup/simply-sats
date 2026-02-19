/**
 * LocksContext - Handles time-locked UTXO state and operations
 *
 * Extracted from WalletContext to improve maintainability.
 * Provides lock/unlock functionality for BSV timelocks.
 */

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, type ReactNode, type SetStateAction, type MutableRefObject } from 'react'
import type { WalletKeys, LockedUTXO, UTXO } from '../services/wallet'
import { getUTXOsFromDB, lockBSV, unlockBSV, detectLockedUtxos } from '../services/wallet'
import { ok, err, type WalletResult } from '../domain/types'
import { useNetwork } from './NetworkContext'
import { walletLogger } from '../services/logger'
import { audit } from '../services/auditLog'

interface LocksContextType {
  // State
  locks: LockedUTXO[]
  knownUnlockedLocks: Set<string>
  /** Ref to knownUnlockedLocks — always current, safe to read inside stale closures */
  knownUnlockedLocksRef: Readonly<MutableRefObject<Set<string>>>

  // State setters
  setLocks: (locks: SetStateAction<LockedUTXO[]>) => void
  addKnownUnlockedLock: (key: string) => void

  // Actions
  handleLock: (
    wallet: WalletKeys,
    amountSats: number,
    blocks: number,
    activeAccountId: number | null,
    onComplete: () => Promise<void>
  ) => Promise<WalletResult>

  handleUnlock: (
    wallet: WalletKeys,
    lock: LockedUTXO,
    activeAccountId: number | null,
    onComplete: () => Promise<void>
  ) => Promise<WalletResult>

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
  const locksRef = useRef(locks)
  useEffect(() => { locksRef.current = locks }, [locks])
  const [knownUnlockedLocks, setKnownUnlockedLocks] = useState<Set<string>>(new Set())
  const knownUnlockedLocksRef = useRef(knownUnlockedLocks)

  // Keep ref in sync with state
  useEffect(() => {
    knownUnlockedLocksRef.current = knownUnlockedLocks
  }, [knownUnlockedLocks])

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
        knownUnlockedLocksRef.current
      )
      return detectedLocks
    } catch (e) {
      walletLogger.error('Failed to detect locks', e)
      return []
    }
  }, [])

  // Lock BSV for a number of blocks
  const handleLock = useCallback(async (
    wallet: WalletKeys,
    amountSats: number,
    blocks: number,
    activeAccountId: number | null,
    onComplete: () => Promise<void>
  ): Promise<WalletResult> => {
    const currentHeight = networkInfo?.blockHeight
    if (!currentHeight) return err('Could not get block height')

    try {
      const unlockBlock = currentHeight + blocks

      // Guard: prevent duplicate lock if same amount + unlockBlock was created recently
      const DEDUP_WINDOW_MS = 30_000 // 30 seconds
      const now = Date.now()
      const recentDuplicate = locksRef.current.find(l =>
        l.satoshis === amountSats &&
        l.unlockBlock === unlockBlock &&
        (now - l.createdAt) < DEDUP_WINDOW_MS
      )
      if (recentDuplicate) {
        walletLogger.warn('Duplicate lock prevented', { amountSats, unlockBlock, existingTxid: recentDuplicate.txid })
        return err('A lock with this amount and duration was just created')
      }

      const walletUtxos = await getUTXOsFromDB(undefined, activeAccountId ?? undefined)

      const lockResult = await lockBSV(amountSats, unlockBlock, walletUtxos, undefined, currentHeight, activeAccountId ?? undefined)
      if (!lockResult.ok) {
        return err(lockResult.error.message)
      }

      // Add the locked UTXO to our list (functional updater to avoid stale closure)
      setLocks(prev => [...prev, lockResult.value.lockedUtxo])

      await onComplete()
      // Audit log lock creation
      audit.lockCreated(lockResult.value.txid, amountSats, unlockBlock, activeAccountId ?? undefined)
      return ok({ txid: lockResult.value.txid, warning: lockResult.value.warning })
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Lock failed')
    }
  }, [networkInfo])

  // Unlock a time-locked UTXO
  const handleUnlock = useCallback(async (
    _wallet: WalletKeys,
    lock: LockedUTXO,
    activeAccountId: number | null,
    onComplete: () => Promise<void>
  ): Promise<WalletResult> => {
    const currentHeight = networkInfo?.blockHeight
    if (!currentHeight) return err('Could not get block height')

    try {
      const unlockResult = await unlockBSV(lock, currentHeight, activeAccountId ?? undefined)
      if (!unlockResult.ok) {
        return err(unlockResult.error.message)
      }
      const txid = unlockResult.value

      // Add to known-unlocked set BEFORE removing from state and fetching data
      // This prevents the race condition where detectLockedUtxos re-adds the lock
      const lockKey = `${lock.txid}:${lock.vout}`
      addKnownUnlockedLock(lockKey)

      await onComplete()

      // Remove from state only AFTER onComplete succeeds — if it throws,
      // the lock stays in state so the UI remains consistent
      setLocks(prev => prev.filter(l => l.txid !== lock.txid || l.vout !== lock.vout))

      // Audit log lock release
      audit.lockReleased(txid, lock.satoshis, activeAccountId ?? undefined)
      return ok({ txid })
    } catch (e) {
      const errorMsg = e instanceof Error
        ? e.message
        : (typeof e === 'string' ? e : JSON.stringify(e))
      walletLogger.error('Unlock threw unexpected exception', { error: String(e), type: typeof e })
      return err(errorMsg || 'Unlock failed')
    }
  }, [networkInfo, addKnownUnlockedLock])

  const value: LocksContextType = useMemo(() => ({
    locks,
    knownUnlockedLocks,
    knownUnlockedLocksRef,
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
