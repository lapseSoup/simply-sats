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
 * successful empty checks.
 */
const DISCOVERY_GAP_LIMIT_AFTER_FIRST_HIT = 20

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
  // No syncing here — avoids rate limiting between checks
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

    // Check ALL 3 addresses for activity (wallet, ordinals, AND identity)
    const [walletResult, ordResult, idResult] = await Promise.all([
      wocClient.getTransactionHistorySafe(keys.walletAddress),
      wocClient.getTransactionHistorySafe(keys.ordAddress),
      wocClient.getTransactionHistorySafe(keys.identityAddress)
    ])

    const walletHasActivity = walletResult.ok && walletResult.value.length > 0
    const ordHasActivity = ordResult.ok && ordResult.value.length > 0
    const idHasActivity = idResult.ok && idResult.value.length > 0

    accountLogger.info('Activity check result', {
      accountIndex: i,
      walletTxCount: walletResult.ok ? walletResult.value.length : 'err',
      ordTxCount: ordResult.ok ? ordResult.value.length : 'err',
      idTxCount: idResult.ok ? idResult.value.length : 'err',
      hasActivity: walletHasActivity || ordHasActivity || idHasActivity
    })

    if (walletHasActivity || ordHasActivity || idHasActivity) {
      discovered.push({ index: i, keys })
      foundAny = true
      consecutiveEmptyAfterHit = 0
      continue
    }

    // Successful empty account.
    const allSucceeded = walletResult.ok && ordResult.ok && idResult.ok
    if (allSucceeded) {
      accountLogger.debug('Empty account found', { accountIndex: i })
      if (foundAny) {
        consecutiveEmptyAfterHit++
        if (consecutiveEmptyAfterHit >= DISCOVERY_GAP_LIMIT_AFTER_FIRST_HIT) {
          accountLogger.info('Gap limit reached after first discovered account; stopping', {
            accountIndex: i,
            consecutiveEmptyAfterHit,
            gapLimit: DISCOVERY_GAP_LIMIT_AFTER_FIRST_HIT
          })
          break
        }
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
      foundAny = true
      consecutiveEmptyAfterHit = 0
    } else if (retryW.ok && retryO.ok && retryI.ok) {
      accountLogger.debug('Empty account found after retry', { accountIndex: i })
      if (foundAny) {
        consecutiveEmptyAfterHit++
        if (consecutiveEmptyAfterHit >= DISCOVERY_GAP_LIMIT_AFTER_FIRST_HIT) {
          accountLogger.info('Gap limit reached after retry and first discovered account; stopping', {
            accountIndex: i,
            consecutiveEmptyAfterHit,
            gapLimit: DISCOVERY_GAP_LIMIT_AFTER_FIRST_HIT
          })
          break
        }
      }
    }
    // If retry also fails (API error), continue to next account.
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
