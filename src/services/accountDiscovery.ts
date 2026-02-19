/**
 * BIP-44 Account Discovery
 *
 * After restoring a wallet from mnemonic, discovers additional accounts
 * that have on-chain activity by incrementally deriving account keys and
 * checking addresses for transaction history.
 *
 * Uses two-phase approach: lightweight discovery first (just address checks),
 * then heavy sync after. This prevents syncWallet API calls from rate-limiting
 * subsequent discovery checks.
 */

import { deriveWalletKeysForAccount } from '../domain/wallet'
import type { WalletKeys } from '../domain/types'
import { createWocClient } from '../infrastructure/api/wocClient'
import { createAccount, switchAccount, getAccountByIdentity } from './accounts'
import { syncWallet } from './sync'
import { accountLogger } from './logger'

/** True when running inside the Tauri desktop shell. */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Check address balance via the Rust backend (bypasses WKWebView fetch).
 * Returns balance in satoshis, or null on error.
 *
 * The WKWebView CDN cache can serve stale [] for /history and 0 for /balance
 * even when the address has on-chain activity. Routing through Rust's reqwest
 * client completely avoids this issue.
 */
async function checkBalanceViaRust(address: string): Promise<number | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const balance = await invoke<number>('check_address_balance', { address })
    return balance >= 0 ? balance : null // -1 signals error
  } catch {
    return null
  }
}

/**
 * Maximum derivation indices to scan (1..N) when restoring from mnemonic.
 *
 * Keep this comfortably above expected usage because historical bugs could
 * place accounts on unexpectedly high indices.
 */
const MAX_ACCOUNT_DISCOVERY = 200

/**
 * Once at least one account is discovered, stop after this many consecutive
 * successfully-confirmed-empty checks. API failures do not count toward this.
 */
const DISCOVERY_GAP_LIMIT_AFTER_FIRST_HIT = 20

/**
 * Delay between each address check within an account (ms).
 * WoC allows roughly 3 req/sec. With 3 addresses per account, we need
 * at least ~340ms between requests to stay under the limit. Use 400ms
 * to give a comfortable margin.
 */
const DISCOVERY_INTER_ADDRESS_DELAY_MS = 400

/**
 * Delay between each account index check (ms) to avoid WoC rate limiting.
 * This is additional breathing room added after all 3 address checks complete.
 */
const DISCOVERY_INTER_ACCOUNT_DELAY_MS = 200

/**
 * Number of retries per account on API failure, with exponential backoff.
 */
const DISCOVERY_MAX_RETRIES = 3

/**
 * Discover additional accounts with on-chain activity.
 *
 * Starting from account index 1, derives keys and checks wallet, ordinals,
 * AND identity addresses for transaction history.
 *
 * @param mnemonic - The BIP-39 mnemonic used to derive accounts
 * @param password - Password for encrypting discovered account keys
 * @param restoreActiveAccountId - If provided, re-activates this account after discovery
 * @returns Number of additional accounts discovered and created
 */
export async function discoverAccounts(
  mnemonic: string,
  password: string | null,
  restoreActiveAccountId?: number
): Promise<number> {
  const wocClient = createWocClient()
  const startTime = Date.now()

  accountLogger.info('Discovery Phase 1: scanning for accounts with on-chain activity', {
    maxIndex: MAX_ACCOUNT_DISCOVERY,
    gapLimit: DISCOVERY_GAP_LIMIT_AFTER_FIRST_HIT,
    restoreActiveAccountId
  })

  // Phase 1: Lightweight discovery (just check addresses for activity)
  // Requests are serialized (not parallel) to stay under WoC rate limits.
  const discovered: { index: number; keys: WalletKeys }[] = []
  let foundAny = false
  let consecutiveEmptyAfterHit = 0
  let totalChecked = 0
  let totalApiErrors = 0
  for (let i = 1; i <= MAX_ACCOUNT_DISCOVERY; i++) {
    const keys = await deriveWalletKeysForAccount(mnemonic, i)
    accountLogger.info('Checking account for activity', {
      accountIndex: i,
      walletAddress: keys.walletAddress,
      ordAddress: keys.ordAddress,
      identityAddress: keys.identityAddress
    })

    // Check all 3 addresses serially to avoid burst rate limiting.
    // In Tauri: uses Rust's reqwest client via check_address_balance command,
    // which bypasses WKWebView's CDN cache that serves stale data for some addresses.
    // In browser/tests: falls back to wocClient.getBalanceSafe (webview fetch).
    // Returns true if any address has a non-zero balance (account is active).
    // Returns false if all addresses confirmed at zero balance.
    // Returns null if any check failed (API error — inconclusive).
    const useTauri = isTauri()
    const checkActivity = async (): Promise<boolean | null> => {
      const addresses = [keys.walletAddress, keys.ordAddress, keys.identityAddress]
      const addrLabels = ['wallet', 'ordinals', 'identity']
      let allOk = true
      for (let addrIdx = 0; addrIdx < addresses.length; addrIdx++) {
        const addr = addresses[addrIdx]!
        // Delay between each address request to stay under WoC rate limit
        if (addrIdx > 0) {
          await new Promise(resolve => setTimeout(resolve, DISCOVERY_INTER_ADDRESS_DELAY_MS))
        }

        let balance: number | null = null
        if (useTauri) {
          // Route through Rust to bypass WKWebView CDN caching
          balance = await checkBalanceViaRust(addr)
          if (balance === null) {
            accountLogger.warn('Rust address check failed', { accountIndex: i, addrType: addrLabels[addrIdx], addr })
            allOk = false
            continue
          }
        } else {
          const result = await wocClient.getBalanceSafe(addr)
          if (!result.ok) {
            accountLogger.warn('Address check failed', {
              accountIndex: i,
              addrType: addrLabels[addrIdx],
              addr,
              error: result.error.message,
              code: result.error.code,
              status: result.error.status
            })
            allOk = false
            continue
          }
          balance = result.value
        }

        accountLogger.info('Address check ok', {
          accountIndex: i,
          addrType: addrLabels[addrIdx],
          addr,
          balance,
          via: useTauri ? 'rust' : 'fetch'
        })
        if (balance > 0) return true  // has balance — account is active
      }
      return allOk ? false : null  // false=confirmed empty, null=API error
    }

    let result = await checkActivity()

    // Retry with exponential backoff on API failures
    if (result === null) {
      for (let attempt = 1; attempt <= DISCOVERY_MAX_RETRIES && result === null; attempt++) {
        const waitMs = 2000 * Math.pow(2, attempt - 1) // 2s, 4s, 8s
        accountLogger.warn('API failure during discovery, retrying', { accountIndex: i, attempt, waitMs })
        await new Promise(resolve => setTimeout(resolve, waitMs))
        result = await checkActivity()
      }
    }

    accountLogger.info('Activity check result', {
      accountIndex: i,
      result: result === true ? 'active' : result === false ? 'empty' : 'api-error'
    })

    totalChecked++
    if (result === true) {
      discovered.push({ index: i, keys })
      foundAny = true
      consecutiveEmptyAfterHit = 0
    } else if (result === false) {
      // Confirmed empty — count toward gap limit only after first active account found
      if (foundAny) {
        consecutiveEmptyAfterHit++
        if (consecutiveEmptyAfterHit >= DISCOVERY_GAP_LIMIT_AFTER_FIRST_HIT) {
          accountLogger.info('Gap limit reached; stopping discovery', {
            accountIndex: i,
            consecutiveEmptyAfterHit,
            gapLimit: DISCOVERY_GAP_LIMIT_AFTER_FIRST_HIT
          })
          break
        }
      }
    } else {
      // result === null: API still failing after all retries — skip without counting as empty
      totalApiErrors++
    }

    // Inter-account delay to stay well under rate limits
    await new Promise(resolve => setTimeout(resolve, DISCOVERY_INTER_ACCOUNT_DELAY_MS))
  }

  const phase1DurationMs = Date.now() - startTime
  accountLogger.info('Discovery Phase 1 complete', {
    totalChecked,
    discovered: discovered.length,
    discoveredIndices: discovered.map(d => d.index),
    totalApiErrors,
    phase1DurationMs,
    stoppedReason: !foundAny && totalChecked >= MAX_ACCOUNT_DISCOVERY ? 'max-index'
      : consecutiveEmptyAfterHit >= DISCOVERY_GAP_LIMIT_AFTER_FIRST_HIT ? 'gap-limit'
      : !foundAny ? 'no-activity-found' : 'scan-complete'
  })

  // Phase 2: Create accounts and attempt sync.
  // Wait briefly to ensure the initial restore sync has released its DB lock
  // before we start writing new account rows.
  await new Promise(resolve => setTimeout(resolve, 2000))

  // Account creation is authoritative for discovery; sync is best-effort.
  let created = 0
  let synced = 0
  for (const { index, keys } of discovered) {
    // Retry createAccount up to 3 times on DB lock (code 5) — the restore sync
    // may still briefly hold the lock even after our wait above.
    let accountId: number | null = null
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      }
      try {
        const createResult = await createAccount(`Account ${index + 1}`, keys, password, true, index)
        if (!createResult.ok) {
          const errMsg = String((createResult.error as { message?: string })?.message ?? createResult.error)
          // DB lock — retry
          if (errMsg.includes('database is locked') || errMsg.includes('code: 5')) {
            accountLogger.warn('DB locked on createAccount, will retry', { accountIndex: index, attempt })
            lastErr = createResult.error
            continue
          }
          // Already exists from a previous partial restore — count as discovered
          const existing = await getAccountByIdentity(keys.identityAddress)
          if (existing?.id) {
            accountLogger.info('Account already exists, counting as discovered', { accountIndex: index, accountId: existing.id })
            accountId = existing.id
            break
          }
          lastErr = createResult.error
          break
        }
        accountId = createResult.value
        break
      } catch (e) {
        lastErr = e
        const msg = String(e)
        if (msg.includes('database is locked') || msg.includes('code: 5')) {
          accountLogger.warn('DB locked on createAccount (exception), will retry', { accountIndex: index, attempt })
          continue
        }
        break
      }
    }

    if (accountId === null) {
      accountLogger.error('Failed to create discovered account', lastErr, { accountIndex: index })
      break // Unexpected error — stop processing
    }

    created++
    try {
      await syncWallet(keys.walletAddress, keys.ordAddress, keys.identityAddress, accountId, keys.walletPubKey)
      synced++
    } catch (syncErr) {
      accountLogger.warn('Discovered account created but initial sync failed', {
        accountIndex: index,
        accountId,
        error: String(syncErr)
      })
    }
    accountLogger.info('Discovered account', {
      accountIndex: index,
      accountId,
      name: `Account ${index + 1}`,
      syncSuccessful: synced === created
    })
  }

  // Restore the originally active account (createAccount deactivates all others)
  if (created > 0 && restoreActiveAccountId) {
    await switchAccount(restoreActiveAccountId)
    accountLogger.info('Restored active account after discovery', { restoreActiveAccountId })
  }

  const totalDurationMs = Date.now() - startTime
  accountLogger.info('Account discovery complete', {
    created,
    synced,
    totalDurationMs,
    phase1DurationMs
  })

  return created
}
