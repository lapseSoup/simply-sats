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

const MAX_ACCOUNT_DISCOVERY = 20

/**
 * Gap limit for account discovery.
 * BIP-44 recommends 20 for address gaps, but for accounts we use a smaller
 * value. We use 2 (not 1) so that a single empty or failed account doesn't
 * prematurely stop discovery when Account 5 exists but Account 4 has no activity.
 */
const DISCOVERY_GAP_LIMIT = 2

/**
 * Discover additional accounts with on-chain activity.
 *
 * Starting from account index 1, derives keys and checks wallet, ordinals,
 * AND identity addresses for transaction history. Stops after DISCOVERY_GAP_LIMIT
 * consecutive empty accounts (not on the first gap).
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
  // No syncing here — avoids rate limiting between checks
  const discovered: { index: number; keys: WalletKeys }[] = []
  let consecutiveEmpty = 0

  for (let i = 1; i <= MAX_ACCOUNT_DISCOVERY; i++) {
    const keys = await deriveWalletKeysForAccount(mnemonic, i)

    // Check ALL 3 addresses for activity (wallet, ordinals, AND identity)
    const [walletResult, ordResult, idResult] = await Promise.all([
      wocClient.getTransactionHistorySafe(keys.walletAddress),
      wocClient.getTransactionHistorySafe(keys.ordAddress),
      wocClient.getTransactionHistorySafe(keys.identityAddress)
    ])

    const walletHasActivity = walletResult.ok && walletResult.value.length > 0
    const ordHasActivity = ordResult.ok && ordResult.value.length > 0
    const idHasActivity = idResult.ok && idResult.value.length > 0

    if (walletHasActivity || ordHasActivity || idHasActivity) {
      discovered.push({ index: i, keys })
      consecutiveEmpty = 0 // Reset gap counter on activity found
      continue
    }

    // Only count toward gap on successful empty responses, not API failures
    const allSucceeded = walletResult.ok && ordResult.ok && idResult.ok
    if (allSucceeded) {
      consecutiveEmpty++
      accountLogger.debug('Empty account found', { accountIndex: i, consecutiveEmpty, gapLimit: DISCOVERY_GAP_LIMIT })
      if (consecutiveEmpty >= DISCOVERY_GAP_LIMIT) {
        accountLogger.info('Gap limit reached, stopping discovery', { consecutiveEmpty })
        break
      }
      continue
    }

    // API failure (likely rate limiting) — wait and retry once
    accountLogger.warn('API failure during discovery, retrying after delay', { accountIndex: i })
    await new Promise(resolve => setTimeout(resolve, 2000))
    const [retryW, retryO, retryI] = await Promise.all([
      wocClient.getTransactionHistorySafe(keys.walletAddress),
      wocClient.getTransactionHistorySafe(keys.ordAddress),
      wocClient.getTransactionHistorySafe(keys.identityAddress)
    ])

    if (
      (retryW.ok && retryW.value.length > 0) ||
      (retryO.ok && retryO.value.length > 0) ||
      (retryI.ok && retryI.value.length > 0)
    ) {
      discovered.push({ index: i, keys })
      consecutiveEmpty = 0
    } else if (retryW.ok && retryO.ok && retryI.ok) {
      // Retry succeeded but all empty — count toward gap
      consecutiveEmpty++
      if (consecutiveEmpty >= DISCOVERY_GAP_LIMIT) {
        accountLogger.info('Gap limit reached after retry, stopping discovery', { consecutiveEmpty })
        break
      }
    }
    // If retry also fails (API error), don't count toward gap — just continue to next account
  }

  // Phase 2: Create accounts and sync (heavy API calls isolated from discovery)
  let found = 0
  for (const { index, keys } of discovered) {
    try {
      const createResult = await createAccount(`Account ${index + 1}`, keys, password, true)
      if (!createResult.ok) {
        throw createResult.error
      }
      const accountId = createResult.value
      await syncWallet(keys.walletAddress, keys.ordAddress, keys.identityAddress, accountId, keys.walletPubKey)
      found++
      accountLogger.info('Discovered and synced account', { accountIndex: index, accountId, name: `Account ${index + 1}` })
    } catch (err) {
      accountLogger.error('Failed to create discovered account', err, { accountIndex: index })
      break // Don't continue if DB write fails
    }
  }

  // Restore the originally active account (createAccount deactivates all others)
  if (found > 0 && restoreActiveAccountId) {
    await switchAccount(restoreActiveAccountId)
    accountLogger.info('Restored active account after discovery', { restoreActiveAccountId })
  }

  if (found > 0) {
    accountLogger.info('Account discovery complete', { found })
  }

  return found
}
