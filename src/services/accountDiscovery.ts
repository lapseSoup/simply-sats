/**
 * BIP-44 Account Discovery
 *
 * After restoring a wallet from mnemonic, discovers additional accounts
 * that have on-chain activity by incrementally deriving account keys and
 * checking addresses for transaction history.
 */

import { deriveWalletKeysForAccount } from '../domain/wallet'
import { createWocClient } from '../infrastructure/api/wocClient'
import { createAccount } from './accounts'
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
 * @returns Number of additional accounts discovered and created
 */
export async function discoverAccounts(
  mnemonic: string,
  password: string
): Promise<number> {
  const wocClient = createWocClient()
  let found = 0

  for (let i = 1; i <= MAX_ACCOUNT_DISCOVERY; i++) {
    const keys = deriveWalletKeysForAccount(mnemonic, i)

    // Check both wallet and ordinals addresses for activity
    const [walletResult, ordResult] = await Promise.all([
      wocClient.getTransactionHistorySafe(keys.walletAddress),
      wocClient.getTransactionHistorySafe(keys.ordAddress)
    ])

    const walletHasActivity = walletResult.success && walletResult.data.length > 0
    const ordHasActivity = ordResult.success && ordResult.data.length > 0

    if (!walletHasActivity && !ordHasActivity) {
      break // Gap found — stop discovery
    }

    // This account has activity — create it in the database
    try {
      await createAccount(`Account ${i + 1}`, keys, password, true)
      found++
      accountLogger.info('Discovered account with activity', { accountIndex: i, name: `Account ${i + 1}` })
    } catch (err) {
      accountLogger.error('Failed to create discovered account', err, { accountIndex: i })
      break // Don't continue if DB write fails
    }
  }

  if (found > 0) {
    accountLogger.info('Account discovery complete', { found })
  }

  return found
}
