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
import { createAccount, switchAccount } from './accounts'
import { syncWallet } from './sync'
import { accountLogger } from './logger'

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

  // Phase 1: Lightweight discovery (just check addresses for activity)
  // Requests are serialized (not parallel) to stay under WoC rate limits.
  const discovered: { index: number; keys: WalletKeys }[] = []
  let foundAny = false
  let consecutiveEmptyAfterHit = 0
  for (let i = 1; i <= MAX_ACCOUNT_DISCOVERY; i++) {
    const keys = await deriveWalletKeysForAccount(mnemonic, i)
    accountLogger.info('Checking account for activity', {
      accountIndex: i,
      walletAddress: keys.walletAddress,
      ordAddress: keys.ordAddress,
      identityAddress: keys.identityAddress
    })

    // Check all 3 addresses serially to avoid burst rate limiting.
    // Returns true if we got a definitive "has activity" answer.
    // Returns false if definitely empty (all 3 returned ok + empty).
    // Returns null if any check failed (API error — inconclusive).
    const checkActivity = async (): Promise<boolean | null> => {
      const addresses = [keys.walletAddress, keys.ordAddress, keys.identityAddress]
      let allOk = true
      for (let addrIdx = 0; addrIdx < addresses.length; addrIdx++) {
        const addr = addresses[addrIdx]!
        // Delay between each address request to stay under WoC rate limit
        if (addrIdx > 0) {
          await new Promise(resolve => setTimeout(resolve, DISCOVERY_INTER_ADDRESS_DELAY_MS))
        }
        const result = await wocClient.getTransactionHistorySafe(addr)
        if (!result.ok) { allOk = false; continue }
        if (result.value.length > 0) return true  // has activity — done
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
    }
    // result === null: API still failing after all retries — skip without counting as empty

    // Inter-account delay to stay well under rate limits
    await new Promise(resolve => setTimeout(resolve, DISCOVERY_INTER_ACCOUNT_DELAY_MS))
  }

  // Phase 2: Create accounts and attempt sync.
  // Account creation is authoritative for discovery; sync is best-effort.
  let created = 0
  let synced = 0
  for (const { index, keys } of discovered) {
    try {
      const createResult = await createAccount(`Account ${index + 1}`, keys, password, true, index)
      if (!createResult.ok) {
        throw createResult.error
      }
      const accountId = createResult.value
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
    } catch (err) {
      accountLogger.error('Failed to create discovered account', err, { accountIndex: index })
      break // Don't continue if DB write fails
    }
  }

  // Restore the originally active account (createAccount deactivates all others)
  if (created > 0 && restoreActiveAccountId) {
    await switchAccount(restoreActiveAccountId)
    accountLogger.info('Restored active account after discovery', { restoreActiveAccountId })
  }

  if (created > 0) {
    accountLogger.info('Account discovery complete', { created, synced })
  }

  return created
}
