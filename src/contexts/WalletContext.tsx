import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react'
import type { WalletKeys, LockedUTXO } from '../services/wallet'
import {
  getFeeRatePerKB,
  setFeeRateFromKB
} from '../services/wallet'
import { setWalletKeys } from '../services/brc100'
import { useNetwork } from './NetworkContext'
import { useAccounts } from './AccountsContext'
import { useSyncContext } from './SyncContext'
import { useLocksContext } from './LocksContext'
import {
  getTransactionLabels,
  updateTransactionLabels,
  getTransactionByTxid,
  upsertTransaction,
  updateLockBlock,
  addUTXO,
  addLockIfNotExists
} from '../services/database'
import type { WalletResult } from '../domain/types'
import { useTokens } from './TokensContext'
import { walletLogger } from '../services/logger'
import { invoke } from '@tauri-apps/api/core'

// Extracted hooks
import { useWalletLock, initAutoLock, minutesToMs } from '../hooks/useWalletLock'
import { useWalletInit } from '../hooks/useWalletInit'
import { useWalletActions as useWalletActionsHook } from '../hooks/useWalletActions'
import { useWalletSend } from '../hooks/useWalletSend'
import { useAccountSwitching } from '../hooks/useAccountSwitching'

// Split context objects
import { WalletStateContext, useWalletState, type WalletStateContextType } from './WalletStateContext'
import { WalletActionsContext, useWalletActions, type WalletActionsContextType } from './WalletActionsContext'

// Re-export types for backward compatibility
export type { TxHistoryItem, BasketBalances } from './SyncContext'

// Backward-compatible merged type — useWallet() returns this
type WalletContextType = WalletStateContextType & WalletActionsContextType

// eslint-disable-next-line react-refresh/only-export-components
export function useWallet(): WalletContextType {
  const state = useWalletState()
  const actions = useWalletActions()
  return useMemo(() => ({ ...state, ...actions }), [state, actions])
}

interface WalletProviderProps {
  children: ReactNode
}

export function WalletProvider({ children }: WalletProviderProps) {
  // Core wallet state
  const [wallet, setWalletState] = useState<WalletKeys | null>(null)
  // Incremented on account switch to invalidate stale async callbacks
  const fetchVersionRef = useRef(0)

  // Get sync state from SyncContext
  const {
    utxos,
    ordinals,
    ordinalContentCache,
    txHistory,
    basketBalances,
    balance,
    ordBalance,
    syncError,
    setOrdinals,
    setBalance,
    setTxHistory,
    resetSync,
    performSync: syncPerformSync,
    fetchData: syncFetchData
  } = useSyncContext()

  // Get lock state from LocksContext
  const {
    locks,
    knownUnlockedLocks,
    setLocks,
    handleLock: locksHandleLock,
    handleUnlock: locksHandleUnlock,
    detectLocks
  } = useLocksContext()

  // Get multi-account state from AccountsContext
  const {
    accounts,
    activeAccount,
    activeAccountId,
    switchAccount: accountsSwitchAccount,
    createNewAccount: accountsCreateNewAccount,
    importAccount: accountsImportAccount,
    deleteAccount: accountsDeleteAccount,
    renameAccount,
    refreshAccounts,
    resetAccounts,
    getKeysForAccount
  } = useAccounts()

  // Always-current account ID ref — avoids stale closure in fetchData after account switch
  const activeAccountIdRef = useRef(activeAccountId)
  useEffect(() => {
    activeAccountIdRef.current = activeAccountId
  }, [activeAccountId])

  // Token state from TokensContext
  const {
    tokenBalances,
    tokensSyncing,
    resetTokens,
    refreshTokens: tokensRefresh,
    sendTokenAction
  } = useTokens()

  // Store keys in Rust key store (mnemonic + index only — no WIFs cross IPC)
  const storeKeysInRust = useCallback(async (mnemonic: string, accountIndex: number) => {
    try {
      await Promise.race([
        invoke('store_keys', { mnemonic, accountIndex }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('store_keys timed out after 10s')), 10000))
      ])
    } catch (e) {
      walletLogger.warn('Failed to store keys in Rust key store', { error: String(e) })
    }
  }, [])

  // Get network state from NetworkContext
  const { networkInfo, syncing, usdPrice } = useNetwork()

  // Settings
  const [feeRateKB, setFeeRateKBState] = useState<number>(() => getFeeRatePerKB())

  // Set wallet and update BRC-100 service
  const setWallet = useCallback((newWallet: WalletKeys | null) => {
    setWalletState(newWallet)
    setWalletKeys(newWallet)
  }, [])

  // --- Extracted hooks ---

  const {
    isLocked, setIsLocked,
    sessionPassword, setSessionPassword,
    autoLockMinutes,
    lockWallet, unlockWallet, setAutoLockMinutes
  } = useWalletLock({
    activeAccount,
    activeAccountId,
    getKeysForAccount,
    refreshAccounts,
    storeKeysInRust,
    setWalletState
  })

  const {
    loading,
    contacts, setContacts,
    refreshContacts
  } = useWalletInit({
    setWallet,
    setIsLocked,
    refreshAccounts
  })

  const {
    handleCreateWallet,
    handleRestoreWallet,
    handleImportJSON,
    handleDeleteWallet,
    consumePendingDiscovery
  } = useWalletActionsHook({
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
    setAutoLockMinutesState: (() => {}) as (minutes: number) => void // Auto-lock state is managed by useWalletLock
  })

  const {
    switchAccount,
    createNewAccount,
    importAccount,
    deleteAccount
  } = useAccountSwitching({
    sessionPassword,
    fetchVersionRef,
    accountsSwitchAccount,
    accountsCreateNewAccount,
    accountsImportAccount,
    accountsDeleteAccount,
    getKeysForAccount,
    setWallet,
    setIsLocked,
    setLocks,
    setOrdinals,
    setBalance,
    setTxHistory,
    resetSync,
    storeKeysInRust,
    refreshAccounts,
    wallet,
    accounts
  })

  // Initialize auto-lock when wallet is loaded
  useEffect(() => {
    if (wallet && autoLockMinutes > 0) {
      walletLogger.debug('AutoLock initializing', { timeoutMinutes: autoLockMinutes })
      const cleanup = initAutoLock(lockWallet, minutesToMs(autoLockMinutes))
      return cleanup
    }
  }, [wallet, autoLockMinutes, lockWallet])

  // Refresh token balances - wraps TokensContext to pass wallet
  const refreshTokens = useCallback(async () => {
    if (!wallet || !activeAccountId) return
    await tokensRefresh(wallet, activeAccountId)
  }, [wallet, activeAccountId, tokensRefresh])

  // Sync wallet with blockchain - delegates to SyncContext
  const performSync = useCallback(async (isRestore = false, forceReset = false) => {
    if (!wallet) return
    await syncPerformSync(wallet, activeAccountIdRef.current, isRestore, forceReset)
  }, [wallet, syncPerformSync])

  // Fetch data from database and API - delegates to SyncContext with lock detection callback
  const fetchData = useCallback(async () => {
    if (!wallet) return

    const version = fetchVersionRef.current
    const currentAccountId = activeAccountIdRef.current
    if (!currentAccountId) return

    await syncFetchData(
      wallet,
      currentAccountId,
      knownUnlockedLocks,
      async ({ utxos: fetchedUtxos, preloadedLocks }) => {
        if (fetchVersionRef.current !== version) return

        if (preloadedLocks && preloadedLocks.length > 0) {
          // Merge DB locks with existing state (preserves optimistically-added locks)
          setLocks(prev => {
            const merged = new Map(prev.map(l => [`${l.txid}:${l.vout}`, l]))
            for (const lock of preloadedLocks) {
              merged.set(`${lock.txid}:${lock.vout}`, lock)
            }
            return Array.from(merged.values())
          })
        }

        try {
          const detectedLocks = await detectLocks(wallet, fetchedUtxos)
          if (fetchVersionRef.current !== version) return

          if (detectedLocks.length > 0) {
            const AVG_BLOCK_MS = 600_000
            const preloadMap = new Map(
              (preloadedLocks || []).map(l => [`${l.txid}:${l.vout}`, l])
            )
            const mergedLocks = detectedLocks.map(lock => {
              const preloaded = preloadMap.get(`${lock.txid}:${lock.vout}`)
              if (!preloaded) return lock
              const earlierCreatedAt = Math.min(lock.createdAt, preloaded.createdAt)
              let estimatedLockBlock = preloaded.lockBlock || lock.lockBlock
              if (!estimatedLockBlock && lock.confirmationBlock && earlierCreatedAt < lock.createdAt) {
                const mempoolMs = lock.createdAt - earlierCreatedAt
                const mempoolBlocks = Math.round(mempoolMs / AVG_BLOCK_MS)
                estimatedLockBlock = lock.confirmationBlock - mempoolBlocks
              }
              if (estimatedLockBlock && !preloaded.lockBlock) {
                updateLockBlock(lock.txid, lock.vout, estimatedLockBlock).catch(e => {
                  walletLogger.warn('Failed to backfill lock_block', { txid: lock.txid, vout: lock.vout, error: String(e) })
                })
              }
              return {
                ...lock,
                lockBlock: estimatedLockBlock,
                createdAt: earlierCreatedAt
              }
            })
            // Merge detected locks with existing state (preserves optimistic locks not yet on-chain)
            setLocks(prev => {
              const detectedMap = new Map(mergedLocks.map(l => [`${l.txid}:${l.vout}`, l]))
              for (const existing of prev) {
                const key = `${existing.txid}:${existing.vout}`
                if (!detectedMap.has(key)) {
                  detectedMap.set(key, existing)
                }
              }
              return Array.from(detectedMap.values())
            })

            // Persist detected locks to DB
            for (const lock of mergedLocks) {
              try {
                const utxoId = await addUTXO({
                  txid: lock.txid,
                  vout: lock.vout,
                  satoshis: lock.satoshis,
                  lockingScript: lock.lockingScript,
                  basket: 'locks',
                  spendable: false,
                  createdAt: lock.createdAt
                }, currentAccountId || undefined)
                await addLockIfNotExists({
                  utxoId,
                  unlockBlock: lock.unlockBlock,
                  lockBlock: lock.lockBlock,
                  createdAt: lock.createdAt
                }, currentAccountId || undefined)
              } catch (_e) {
                // Best-effort
              }
            }

            // Auto-label lock transactions
            const lockAccountId = currentAccountId || 1
            for (const lock of mergedLocks) {
              try {
                const existingLabels = await getTransactionLabels(lock.txid, lockAccountId)
                if (!existingLabels.includes('lock')) {
                  await updateTransactionLabels(lock.txid, [...existingLabels, 'lock'], lockAccountId)
                }
                const dbTx = await getTransactionByTxid(lock.txid, lockAccountId)
                if (dbTx) {
                  const needsAmountFix = dbTx.amount !== undefined && dbTx.amount > 0
                  const needsDescription = !dbTx.description

                  if (needsDescription || needsAmountFix) {
                    await upsertTransaction({
                      txid: dbTx.txid,
                      createdAt: dbTx.createdAt,
                      status: dbTx.status,
                      ...(needsDescription && {
                        description: `Locked ${lock.satoshis} sats until block ${lock.unlockBlock}`
                      }),
                      ...(needsAmountFix && {
                        amount: -lock.satoshis
                      })
                    }, lockAccountId)
                  }
                }
              } catch (_e) {
                // Best-effort
              }
            }
          }
        } catch (e) {
          walletLogger.error('Failed to detect locks', e)
        }
      },
      () => fetchVersionRef.current !== version
    )
  }, [wallet, knownUnlockedLocks, syncFetchData, detectLocks, setLocks])

  // Lock/unlock BSV - delegates to LocksContext
  const handleLock = useCallback(async (amountSats: number, blocks: number): Promise<WalletResult> => {
    if (!wallet) return { ok: false, error: 'No wallet loaded' }
    return locksHandleLock(wallet, amountSats, blocks, activeAccountId, fetchData)
  }, [wallet, activeAccountId, locksHandleLock, fetchData])

  const handleUnlock = useCallback(async (lock: LockedUTXO): Promise<WalletResult> => {
    if (!wallet) return { ok: false, error: 'No wallet loaded' }
    return locksHandleUnlock(wallet, lock, activeAccountId, fetchData)
  }, [wallet, activeAccountId, locksHandleUnlock, fetchData])

  // Send operations - from useWalletSend
  const {
    handleSend,
    handleTransferOrdinal,
    handleListOrdinal,
    handleSendToken
  } = useWalletSend({
    wallet,
    activeAccountId,
    fetchData,
    refreshTokens,
    sendTokenAction
  })

  // Settings
  const setFeeRate = useCallback((rate: number) => {
    setFeeRateKBState(rate)
    setFeeRateFromKB(rate)
  }, [])

  // Split into state (read-only) and actions (write operations)
  const stateValue: WalletStateContextType = useMemo(() => ({
    wallet,
    balance,
    ordBalance,
    usdPrice,
    utxos,
    ordinals,
    ordinalContentCache,
    locks,
    txHistory,
    basketBalances,
    contacts,
    accounts,
    activeAccount,
    activeAccountId,
    tokenBalances,
    tokensSyncing,
    isLocked,
    autoLockMinutes,
    networkInfo,
    syncing,
    syncError,
    loading,
    feeRateKB,
    sessionPassword
  }), [
    wallet, balance, ordBalance, usdPrice, utxos, ordinals, ordinalContentCache,
    locks, txHistory, basketBalances, contacts, accounts, activeAccount, activeAccountId,
    tokenBalances, tokensSyncing, isLocked, autoLockMinutes, networkInfo, syncing,
    syncError, loading, feeRateKB, sessionPassword
  ])

  const actionsValue: WalletActionsContextType = useMemo(() => ({
    setWallet,
    switchAccount,
    createNewAccount,
    importAccount,
    deleteAccount,
    renameAccount,
    refreshAccounts,
    refreshTokens,
    lockWallet,
    unlockWallet,
    setAutoLockMinutes,
    setFeeRate,
    refreshContacts,
    performSync,
    fetchData,
    handleCreateWallet,
    handleRestoreWallet,
    handleImportJSON,
    handleDeleteWallet,
    handleSend,
    handleLock,
    handleUnlock,
    handleTransferOrdinal,
    handleListOrdinal,
    handleSendToken,
    consumePendingDiscovery
  }), [
    setWallet, switchAccount, createNewAccount, importAccount, deleteAccount,
    renameAccount, refreshAccounts, refreshTokens, lockWallet, unlockWallet,
    setAutoLockMinutes, setFeeRate, refreshContacts, performSync, fetchData,
    handleCreateWallet, handleRestoreWallet, handleImportJSON, handleDeleteWallet,
    handleSend, handleLock, handleUnlock, handleTransferOrdinal, handleListOrdinal,
    handleSendToken, consumePendingDiscovery
  ])

  return (
    <WalletStateContext.Provider value={stateValue}>
      <WalletActionsContext.Provider value={actionsValue}>
        {children}
      </WalletActionsContext.Provider>
    </WalletStateContext.Provider>
  )
}
