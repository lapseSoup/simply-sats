/**
 * BRC-100 Utility Functions
 *
 * Helper functions for BRC-100 operations.
 */

import type { WalletKeys } from '../wallet'
import type { CreateActionRequest } from './types'

/**
 * Get current block height from WhatsOnChain
 */
export async function getBlockHeight(): Promise<number> {
  try {
    const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/chain/info')
    const data = await response.json()
    return data.blocks
  } catch {
    return 0
  }
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Format identity key for display (similar to Yours Wallet)
 */
export function formatIdentityKey(pubKey: string): string {
  if (pubKey.length <= 16) return pubKey
  return `${pubKey.slice(0, 8)}...${pubKey.slice(-8)}`
}

/**
 * Get the identity key in the format apps expect
 */
export function getIdentityKeyForApp(keys: WalletKeys): {
  identityKey: string
  identityAddress: string
} {
  return {
    identityKey: keys.identityPubKey,
    identityAddress: keys.identityAddress
  }
}

/**
 * Check if this is an inscription transaction (1Sat Ordinals)
 */
export function isInscriptionTransaction(actionRequest: CreateActionRequest): boolean {
  // Check for inscription markers in outputs
  return actionRequest.outputs.some(o => {
    // Check basket name
    if (o.basket?.includes('ordinal') || o.basket?.includes('inscription')) return true
    // Check tags
    if (o.tags?.some(t => t.includes('inscription') || t.includes('ordinal'))) return true
    // Check for 1-sat outputs with long locking scripts (inscription envelope)
    // Inscription scripts start with OP_FALSE OP_IF "ord" ... OP_ENDIF
    if (o.satoshis === 1 && o.lockingScript.length > 100) {
      // Check for inscription envelope marker: 0063 (OP_FALSE OP_IF) followed by "ord" push
      if (o.lockingScript.startsWith('0063') && o.lockingScript.includes('036f7264')) {
        return true
      }
    }
    return false
  })
}
