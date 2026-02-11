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
 * Discover additional accounts with on-chain activity.
 *
 * Starting from account index 1, derives keys and checks wallet + ordinals
 * addresses for transaction history. Stops at the first account with no
 * activity (gap detection per BIP-44).
 *
 * @param mnemonic - The BIP-39 mnemonic used to derive accounts
 * @param password - Password for encrypting discovered account keys
 * @param restoreActiveAccountId - If provided, re-activates this account after discovery
 * @returns Number of additional accounts discovered and created
 */
export async function discoverAccounts(
  mnemonic: string,
  password: string,
  restoreActiveAccountId?: number
): Promise<number> {
  const wocClient = createWocClient()

  // Phase 1: Lightweight discovery (just check addresses for activity)
  // No syncing here — avoids rate limiting between checks
  const discovered: { index: number; keys: WalletKeys }[] = []

  for (let i = 1; i <= MAX_ACCOUNT_DISCOVERY; i++) {
    const keys = await deriveWalletKeysForAccount(mnemonic, i)

    // Check both wallet and ordinals addresses for activity
    const [walletResult, ordResult] = await Promise.all([
      wocClient.getTransactionHistorySafe(keys.walletAddress),
      wocClient.getTransactionHistorySafe(keys.ordAddress)
    ])

    const walletHasActivity = walletResult.success && walletResult.data.length > 0
    const ordHasActivity = ordResult.success && ordResult.data.length > 0

    if (walletHasActivity || ordHasActivity) {
      discovered.push({ index: i, keys })
      continue
    }

    // Only gap-detect on successful empty responses, not API failures
    if (walletResult.success && ordResult.success) {
      break // True gap — both checked successfully with no activity
    }

    // API failure (likely rate limiting) — wait and retry once
    accountLogger.warn('API failure during discovery, retrying after delay', { accountIndex: i })
    await new Promise(resolve => setTimeout(resolve, 2000))
    const [retryW, retryO] = await Promise.all([
      wocClient.getTransactionHistorySafe(keys.walletAddress),
      wocClient.getTransactionHistorySafe(keys.ordAddress)
    ])

    if ((retryW.success && retryW.data.length > 0) || (retryO.success && retryO.data.length > 0)) {
      discovered.push({ index: i, keys })
    } else {
      break
    }
  }

  // Phase 2: Create accounts and sync (heavy API calls isolated from discovery)
  let found = 0
  for (const { index, keys } of discovered) {
    try {
      const accountId = await createAccount(`Account ${index + 1}`, keys, password, true)
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
