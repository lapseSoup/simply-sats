/**
 * Hook for the App.tsx auto-sync pipeline.
 *
 * Extracted from App.tsx to reduce the 782-line monolith.
 * Contains the `checkSync` function, all ref mirrors for stable closures,
 * and the useEffect that fires on [activeAccountId, hasWallet].
 *
 * This hook orchestrates:
 * 1. Initial sync (blocking) for never-synced accounts
 * 2. Background sync for stale accounts
 * 3. Token refresh
 * 4. Background sync of inactive accounts
 * 5. Account discovery (post-restore)
 */

import { useEffect, useRef } from 'react'
import type { WalletKeys } from '../services/wallet'
import type { Account } from '../services/accounts'
import type { SyncPhase } from '../contexts/NetworkContext'
import type { ToastType } from '../contexts/UIContext'
import { logger } from '../services/logger'
import { needsInitialSync, syncWallet, getLastSyncTimeForAccount } from '../services/sync'
import { discoverAccounts } from '../services/accountDiscovery'
import { getAccountKeys } from '../services/accounts'
import { getSessionPassword } from '../services/sessionPasswordStore'
import { switchJustCompleted } from './useAccountSwitching'

interface DiscoveryParams {
  mnemonic: string
  password: string | null
  excludeAccountId?: number
}

interface UseCheckSyncOptions {
  wallet: WalletKeys | null
  activeAccountId: number | null
  accounts: Account[]

  // Functions that change identity on wallet/account changes (ref-mirrored to avoid infinite loops)
  fetchDataFromDB: () => Promise<void>
  fetchData: () => Promise<void>
  performSync: (isRestore?: boolean, forceReset?: boolean, silent?: boolean) => Promise<void>
  refreshTokens: () => Promise<void>
  consumePendingDiscovery: () => DiscoveryParams | null
  peekPendingDiscovery: () => DiscoveryParams | null
  clearPendingDiscovery: () => void
  refreshAccounts: () => Promise<void>
  setSyncPhase: (phase: SyncPhase) => void
  showToast: (message: string, type?: ToastType) => void
}

/**
 * Runs the auto-sync pipeline when the wallet loads or the active account changes.
 *
 * All callback dependencies are ref-mirrored to avoid infinite re-render loops.
 * See the original App.tsx comments for detailed rationale on each ref.
 */
export function useCheckSync({
  wallet,
  activeAccountId,
  accounts,
  fetchDataFromDB,
  fetchData,
  performSync,
  refreshTokens,
  consumePendingDiscovery,
  peekPendingDiscovery,
  clearPendingDiscovery,
  refreshAccounts,
  setSyncPhase,
  showToast,
}: UseCheckSyncOptions): void {

  // ── Ref mirrors ──────────────────────────────────────────────────────
  // Keep refs for all callbacks used inside checkSync so the effect itself only
  // depends on [hasWallet, activeAccountId] -- the two values that actually signal
  // "a new account is ready to sync". Every other function either:
  //   (a) has a dep on wallet/activeAccountId and therefore gets a new identity
  //       on every restore/switch, or
  //   (b) arrives through a useMemo that recreates whenever performSync/fetchData
  //       change, giving consumePendingDiscovery and refreshAccounts new object
  //       references even though their underlying logic is stable.
  // Putting any of these in the dep array caused an infinite sync loop.

  const fetchDataFromDBRef = useRef(fetchDataFromDB)
  useEffect(() => { fetchDataFromDBRef.current = fetchDataFromDB }, [fetchDataFromDB])

  const fetchDataRef = useRef(fetchData)
  useEffect(() => { fetchDataRef.current = fetchData }, [fetchData])

  const performSyncRef = useRef(performSync)
  useEffect(() => { performSyncRef.current = performSync }, [performSync])

  const refreshTokensRef = useRef(refreshTokens)
  useEffect(() => { refreshTokensRef.current = refreshTokens }, [refreshTokens])

  const consumePendingDiscoveryRef = useRef(consumePendingDiscovery)
  useEffect(() => { consumePendingDiscoveryRef.current = consumePendingDiscovery }, [consumePendingDiscovery])

  const peekPendingDiscoveryRef = useRef(peekPendingDiscovery)
  useEffect(() => { peekPendingDiscoveryRef.current = peekPendingDiscovery }, [peekPendingDiscovery])

  const clearPendingDiscoveryRef = useRef(clearPendingDiscovery)
  useEffect(() => { clearPendingDiscoveryRef.current = clearPendingDiscovery }, [clearPendingDiscovery])

  const refreshAccountsRef = useRef(refreshAccounts)
  useEffect(() => { refreshAccountsRef.current = refreshAccounts }, [refreshAccounts])

  const setSyncPhaseRef = useRef(setSyncPhase)
  useEffect(() => { setSyncPhaseRef.current = setSyncPhase }, [setSyncPhase])

  const showToastRef = useRef(showToast)
  useEffect(() => { showToastRef.current = showToast }, [showToast])

  const walletRef = useRef(wallet)
  useEffect(() => { walletRef.current = wallet }, [wallet])

  const accountsRef = useRef(accounts)
  useEffect(() => { accountsRef.current = accounts }, [accounts])

  // ── hasWallet flag ───────────────────────────────────────────────────
  // Coerce wallet to boolean: true when loaded, false when null.
  // Using this in deps instead of `wallet` directly prevents the effect from firing
  // on every account switch (where wallet identity changes but stays non-null).
  // It DOES fire on restore/create (null -> non-null) and delete (non-null -> null).
  const hasWallet = !!wallet

  // ── Auto-sync effect ─────────────────────────────────────────────────
  // Depends on [activeAccountId, hasWallet] -- NOT the wallet object itself.
  // - hasWallet fires the effect on initial restore/create (wallet null -> non-null)
  // - activeAccountId fires on account switches
  useEffect(() => {
    const currentWallet = walletRef.current
    if (!currentWallet || activeAccountId === null) return

    let cancelled = false

    const checkSync = async () => {
      const w = walletRef.current
      if (!w) return

      const discoveryParams = peekPendingDiscoveryRef.current()
      const isPostSwitch = switchJustCompleted()
      logger.info('checkSync starting', {
        hasDiscoveryParams: !!discoveryParams,
        walletAddress: w.walletAddress?.substring(0, 12),
        activeAccountId,
        isPostSwitch,
        accountCount: accountsRef.current.length
      })

      let needsSync = false

      try {
        // If a switch just completed, useAccountSwitching already loaded all DB
        // data with the correct keys+accountId. Skip the DB preload here.
        if (!isPostSwitch) {
          await fetchDataFromDBRef.current()
        }

        needsSync = await needsInitialSync([
          w.walletAddress,
          w.ordAddress,
          w.identityAddress
        ], activeAccountId ?? undefined)

        if (needsSync && !isPostSwitch) {
          // First-ever sync for this account: must block -- no cached data to show
          logger.info('Initial sync needed, starting...', { accountId: activeAccountId })
          setSyncPhaseRef.current('syncing')
          await performSyncRef.current(true)
          setSyncPhaseRef.current('loading')
          await fetchDataRef.current()
          showToastRef.current('Wallet ready \u2713', 'success')
        } else if (needsSync && isPostSwitch) {
          // Account was just switched to but has never been synced (e.g. discovered
          // account). Do a background sync -- DB data was already loaded by the switch.
          logger.info('Post-switch initial sync (background)', { accountId: activeAccountId })
          ;(async () => {
            try {
              if (cancelled) return
              await performSyncRef.current(false, false, true)
              if (cancelled) return
              await fetchDataRef.current()
            } catch (e) {
              logger.warn('Post-switch background sync failed', { error: String(e) })
            } finally {
              setSyncPhaseRef.current(null)
            }
          })()
        } else {
          // Already-synced account -- always fetch API data (ordinals, balances),
          // and background-sync from blockchain if data is stale.
          const SYNC_COOLDOWN_MS = 5 * 60 * 1000
          const lastSyncTime = await getLastSyncTimeForAccount(activeAccountId!)
          const isStale = (Date.now() - lastSyncTime) > SYNC_COOLDOWN_MS

          if (isStale) {
            logger.info('Account data stale, background-syncing', { accountId: activeAccountId, lastSyncTime })
            ;(async () => {
              try {
                if (cancelled) return
                await performSyncRef.current(false, false, true)
                if (cancelled) return
                await fetchDataRef.current()
              } catch (e) {
                logger.warn('Background sync after switch failed', { error: String(e) })
              } finally {
                setSyncPhaseRef.current(null)
              }
            })()
          } else {
            // Data is fresh from blockchain perspective, but still need to load API
            // data (ordinals, ord balance) that isn't cached in the DB.
            logger.info('Account data fresh, loading API data', { accountId: activeAccountId, lastSyncTime })
            ;(async () => {
              try {
                if (cancelled) return
                await fetchDataRef.current()
              } catch (e) {
                logger.warn('Fresh account API fetch failed', { error: String(e) })
              }
            })()
          }
        }
      } catch (e) {
        logger.error('Auto-sync pipeline failed', e)
        setSyncPhaseRef.current(null) // B-40: Clear sync phase on error
      } finally {
        // Clear sync phase for the initial-sync (blocking) path.
        // Background sync manages its own phase in its own finally block.
        if (needsSync) {
          setSyncPhaseRef.current(null)
        }
      }

      // Bail out if this invocation was superseded by a newer one
      if (cancelled) {
        logger.info('checkSync cancelled after sync pipeline (superseded by newer invocation)')
        return
      }

      // Sync token balances as part of initial load
      try {
        await refreshTokensRef.current()
      } catch (e) {
        logger.error('Token refresh during auto-sync failed', e)
      }

      // Background-sync all inactive accounts so their data is fresh when switched to.
      // Skip when discovery is pending -- background sync holds the DB lock and would
      // race with discoverAccounts' createAccount calls, causing "database is locked" errors.
      // Fire-and-forget: failures are logged but don't affect the active account.
      // Delay start by 10s to let the active account's sync finish first and avoid
      // overwhelming WoC with concurrent requests from multiple accounts.
      const otherAccounts = accountsRef.current.filter(a => a.id !== activeAccountId)
      if (otherAccounts.length > 0 && !discoveryParams) {
        ;(async () => {
          // Wait for active account sync to settle before syncing other accounts
          await new Promise(resolve => setTimeout(resolve, 10_000))
          if (cancelled) return // B-68: Check after initial delay
          // B-96: Re-read session password after delay -- it may have been cleared by lockWallet()
          const sessionPwd = getSessionPassword()
          if (sessionPwd === null) {
            logger.info('Background sync skipped -- wallet was locked during delay')
            return
          }
          for (const account of otherAccounts) {
            if (cancelled) break  // B-41: Stop syncing inactive accounts if superseded
            try {
              const keys = await getAccountKeys(account, sessionPwd)
              if (!keys) continue
              logger.info('Background-syncing account', { accountId: account.id, name: account.name })
              await syncWallet(
                keys.walletAddress,
                keys.ordAddress,
                keys.identityAddress,
                account.id ?? undefined,
                keys.walletPubKey
              )
              // Refresh accounts after EACH account sync so Header picks up
              // the new balance immediately (instead of waiting for all accounts).
              try { await refreshAccountsRef.current() } catch { /* non-critical */ }
            } catch (e) {
              logger.warn('Background sync failed for account', { accountId: account.id, error: String(e) })
            }
            // Inter-account cooldown -- give WoC rate limits time to recover
            if (!cancelled) await new Promise(resolve => setTimeout(resolve, 3_000))
          }
        })()
      }

      // Bail out if this invocation was superseded by a newer one
      if (cancelled) {
        logger.info('checkSync cancelled before discovery (superseded by newer invocation)')
        return
      }

      // Run account discovery AFTER primary sync to avoid race conditions
      // (discoverAccounts changes activeAccountId which would discard fetchData results if concurrent)
      //
      // NOTE: Discovery is NOT gated on needsSync -- these are orthogonal concerns.
      // pendingDiscoveryRef is a one-shot signal set only during handleRestoreWallet.
      // If Account 1 was previously synced (needsSync = false), additional accounts on
      // the blockchain still need to be discovered.
      //
      // We peek first, then clear only when we're about to run discovery.
      // This ensures a cancelled invocation doesn't destroy the params.
      if (discoveryParams) {
        // B-47: Check cancellation before clearing params to prevent data loss
        await new Promise(resolve => setTimeout(resolve, 1000))
        if (cancelled) {
          logger.info('checkSync cancelled during pre-discovery cooldown')
          return
        }
        // Now safe to clear -- we're committed to running discovery
        clearPendingDiscoveryRef.current()
        logger.info('Account discovery starting', {
          excludeAccountId: discoveryParams.excludeAccountId
        })
        showToastRef.current('Scanning for additional accounts...')
        try {
          const found = await discoverAccounts(
            discoveryParams.mnemonic,
            discoveryParams.password,
            discoveryParams.excludeAccountId
          )
          logger.info('Account discovery complete', { found })
          if (found > 0) {
            await refreshAccountsRef.current()
            showToastRef.current(`Discovered ${found} additional account${found > 1 ? 's' : ''}`, 'success')

            // Background-sync discovered accounts so their balances appear in the
            // account switcher. Discovery creates accounts with deferred sync, so
            // they have 0 UTXOs until explicitly synced. Fire-and-forget.
            const sessionPwd = getSessionPassword()
            const { getAllAccounts: fetchAllAccounts } = await import('../services/accounts')
            const allAccounts = await fetchAllAccounts()
            const capturedAccountId = activeAccountId // B-49: Capture before async loop
            const newAccounts = allAccounts.filter(a => a.id !== capturedAccountId)
            ;(async () => {
              for (const account of newAccounts) {
                if (cancelled) break  // B-82: Stop syncing discovered accounts if superseded
                try {
                  const keys = await getAccountKeys(account, sessionPwd)
                  if (!keys) continue
                  logger.info('Post-discovery sync for account', { accountId: account.id, name: account.name })
                  await syncWallet(
                    keys.walletAddress,
                    keys.ordAddress,
                    keys.identityAddress,
                    account.id ?? undefined,
                    keys.walletPubKey
                  )
                  // Refresh after each so balances appear incrementally in switcher
                  try { await refreshAccountsRef.current() } catch { /* non-critical */ }
                } catch (e) {
                  logger.warn('Post-discovery sync failed for account', { accountId: account.id, error: String(e) })
                }
              }
            })()
          } else {
            showToastRef.current('No additional accounts found')
          }
        } catch (e) {
          logger.error('Account discovery failed', e)
          showToastRef.current('Account discovery failed', 'error')
        }
      }
    }

    checkSync().catch(err => logger.error('Auto-sync check failed', err))

    return () => { cancelled = true }
  }, [activeAccountId, hasWallet])
}
