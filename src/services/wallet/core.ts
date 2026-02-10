/**
 * Core wallet operations
 * Creation, restoration, and import functions
 */

import * as bip39 from 'bip39'
import type { WalletKeys, ShaulletBackup, OneSatWalletBackup } from './types'
import {
  deriveWalletKeys,
  keysFromWif as domainKeysFromWif,
  WALLET_PATHS
} from '../../domain/wallet/keyDerivation'
import { validateMnemonic } from '../../domain/wallet/validation'
import { walletLogger } from '../logger'

// Re-export WALLET_PATHS for backward compatibility
export { WALLET_PATHS }

// Generate keys from WIF (for importing from other wallets) - delegates to domain layer
function keysFromWif(wif: string) {
  return domainKeysFromWif(wif)
}

/**
 * Create new wallet with fresh mnemonic
 */
export async function createWallet(): Promise<WalletKeys> {
  const mnemonic = bip39.generateMnemonic()
  return restoreWallet(mnemonic)
}

/**
 * Restore wallet from mnemonic - delegates to domain layer
 */
export async function restoreWallet(mnemonic: string): Promise<WalletKeys> {
  // Use domain layer validation which normalizes and validates
  const validation = validateMnemonic(mnemonic)

  if (!validation.isValid || !validation.normalizedMnemonic) {
    walletLogger.error('Mnemonic validation failed', undefined, { error: validation.error })
    throw new Error(validation.error || 'Invalid mnemonic phrase. Please check your 12 words.')
  }

  try {
    // Delegate to domain layer for key derivation
    return await deriveWalletKeys(validation.normalizedMnemonic)
  } catch (error) {
    walletLogger.error('Error deriving keys from mnemonic', error)
    throw new Error('Failed to derive wallet keys from mnemonic')
  }
}

/**
 * Import from Shaullet JSON backup
 */
export async function importFromShaullet(jsonString: string): Promise<WalletKeys> {
  try {
    const backup: ShaulletBackup = JSON.parse(jsonString)

    // If mnemonic is present, use it
    if (backup.mnemonic) {
      return await restoreWallet(backup.mnemonic)
    }

    // If WIF is present, import keys directly
    if (backup.keys?.wif) {
      const wallet = await keysFromWif(backup.keys.wif)
      // For Shaullet imports without mnemonic, we use the same key for all purposes
      return {
        mnemonic: '', // No mnemonic available
        walletType: 'yours',
        walletWif: wallet.wif,
        walletAddress: wallet.address,
        walletPubKey: wallet.pubKey,
        ordWif: wallet.wif,
        ordAddress: wallet.address,
        ordPubKey: wallet.pubKey,
        identityWif: wallet.wif,
        identityAddress: wallet.address,
        identityPubKey: wallet.pubKey
      }
    }

    throw new Error('Invalid Shaullet backup format')
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error('Invalid JSON format')
    }
    throw e
  }
}

/**
 * Import from 1Sat Ordinals wallet JSON
 */
export async function importFrom1SatOrdinals(jsonString: string): Promise<WalletKeys> {
  try {
    const backup: OneSatWalletBackup = JSON.parse(jsonString)

    // If mnemonic is present, use it
    if (backup.mnemonic) {
      return await restoreWallet(backup.mnemonic)
    }

    // Import from separate keys
    if (backup.payPk || backup.ordPk) {
      const paymentKey = backup.payPk ? await keysFromWif(backup.payPk) : null
      const ordKey = backup.ordPk ? await keysFromWif(backup.ordPk) : null

      // Use payment key as primary, ordinals key for ordinals
      const primaryKey = paymentKey || ordKey
      if (!primaryKey) {
        throw new Error('No valid keys found in backup')
      }

      return {
        mnemonic: '', // No mnemonic available
        walletType: 'yours',
        walletWif: primaryKey.wif,
        walletAddress: primaryKey.address,
        walletPubKey: primaryKey.pubKey,
        ordWif: ordKey?.wif || primaryKey.wif,
        ordAddress: ordKey?.address || primaryKey.address,
        ordPubKey: ordKey?.pubKey || primaryKey.pubKey,
        // Generate identity from payment key for BRC-100 compatibility
        identityWif: primaryKey.wif,
        identityAddress: primaryKey.address,
        identityPubKey: primaryKey.pubKey
      }
    }

    throw new Error('Invalid 1Sat Ordinals backup format')
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error('Invalid JSON format')
    }
    throw e
  }
}

/**
 * Detect backup format and import accordingly
 */
export async function importFromJSON(jsonString: string): Promise<WalletKeys> {
  try {
    const backup = JSON.parse(jsonString)

    // Check for 1Sat Ordinals format (has ordPk or payPk)
    if (backup.ordPk || backup.payPk) {
      return await importFrom1SatOrdinals(jsonString)
    }

    // Check for Shaullet format (has keys object or mnemonic at root)
    if (backup.keys || backup.mnemonic || backup.seed) {
      return await importFromShaullet(jsonString)
    }

    throw new Error('Unknown backup format')
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error('Invalid JSON format')
    }
    throw e
  }
}

/**
 * Verify that a mnemonic produces the expected wallet address.
 * This is a read-only operation that does NOT modify any wallet state.
 *
 * @param mnemonic - The seed phrase to verify
 * @param expectedAddress - The wallet address to compare against
 * @returns Object with valid flag and the derived address
 */
export async function verifyMnemonicMatchesWallet(
  mnemonic: string,
  expectedAddress: string
): Promise<{ valid: boolean; derivedAddress: string }> {
  // Use the same restore logic but don't save anything
  const walletKeys = await restoreWallet(mnemonic)

  const derivedAddress = walletKeys.walletAddress

  return {
    valid: derivedAddress === expectedAddress,
    derivedAddress
  }
}
