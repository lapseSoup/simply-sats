/**
 * Transaction Broadcast Service
 *
 * Unified broadcast that cascades across multiple endpoints:
 * WoC → ARC (JSON) → ARC (text) → mAPI
 *
 * Consolidates the duplicate broadcast implementations from
 * wallet/transactions.ts, transactions.ts, brc100.ts, and overlay.ts.
 */

import { getWocClient } from './wocClient'
import { gpArcApi, gpMapiApi } from './clients'
// NOTE: Logger is a cross-cutting concern — this import from services is an accepted exception
// to the strict layered architecture. Moving logger to infrastructure would break the
// convention that services/logger.ts is the canonical logging module.
import { apiLogger } from '../../services/logger'

/**
 * Patterns indicating a transaction is already in the mempool.
 * This is NOT a failure — it means the tx was already accepted.
 */
const TXN_ALREADY_KNOWN_PATTERNS = [
  'txn-already-known',
  'transaction already in the mempool',
  'transaction already known',
  '257:',
]

export function isTxAlreadyKnown(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase()
  return TXN_ALREADY_KNOWN_PATTERNS.some(p => lower.includes(p.toLowerCase()))
}

/** Valid txid: exactly 64 hex characters */
const TXID_RE = /^[0-9a-fA-F]{64}$/

/**
 * Return the first valid txid from the candidates, or undefined.
 * Used to prefer the endpoint's response but safely fall back to localTxid
 * when the endpoint returns a truncated or malformed string.
 */
function pickValidTxid(...candidates: (string | undefined)[]): string | undefined {
  for (const c of candidates) {
    if (c && TXID_RE.test(c)) return c
  }
  return undefined
}

/**
 * Broadcast a signed transaction hex to the BSV network.
 * Tries multiple endpoints in cascade for maximum reliability.
 *
 * @param txHex - Raw transaction hex to broadcast
 * @param localTxid - Optional locally-computed txid for cross-validation
 * @returns The transaction ID
 * @throws Error if all broadcast attempts fail
 */
export async function broadcastTransaction(txHex: string, localTxid?: string): Promise<string> {
  apiLogger.debug('Broadcasting transaction', { txhex: txHex.slice(0, 100) + '...' })
  const errors: string[] = []

  // 1. Try WhatsOnChain (via existing wocClient which has its own timeout)
  try {
    const result = await getWocClient().broadcastTransactionSafe(txHex)
    if (result.ok) {
      const responseTxid = result.value
      if (responseTxid && localTxid && responseTxid !== localTxid) {
        apiLogger.error('TXID mismatch between WoC and local', {
          broadcasterTxid: responseTxid,
          localTxid
        })
      }
      // Prefer the endpoint's txid but fall back to localTxid if WoC
      // returned a truncated or malformed response (network glitch, etc.)
      const validTxid = pickValidTxid(responseTxid, localTxid)
      if (validTxid) {
        if (validTxid !== responseTxid) {
          apiLogger.warn('WoC returned malformed txid, using local', { responseTxid, localTxid })
        }
        apiLogger.info('WhatsOnChain broadcast successful')
        return validTxid
      }
      // Both invalid — unlikely but cascade to next endpoint
      apiLogger.warn('WoC returned invalid txid and no localTxid available', { responseTxid })
      errors.push(`WoC: invalid txid response: ${responseTxid?.substring(0, 80)}`)
    } else {
      const errorMsg = result.error.message
      apiLogger.warn('WoC broadcast failed', { error: errorMsg })
      errors.push(`WoC: ${errorMsg}`)
      if (isTxAlreadyKnown(errorMsg) && localTxid) {
        apiLogger.info('WoC: txn-already-known — treating as success', { txid: localTxid })
        return localTxid
      }
    }
  } catch (error) {
    const errorMsg = String(error)
    apiLogger.warn('WoC error', { error: errorMsg })
    errors.push(`WoC: ${errorMsg}`)
    if (isTxAlreadyKnown(errorMsg) && localTxid) {
      apiLogger.info('WoC: txn-already-known (catch) — treating as success', { txid: localTxid })
      return localTxid
    }
  }

  // 2. Try GorillaPool ARC (JSON body + skipScriptFlags)
  try {
    const result = await gpArcApi.fetch('/v1/tx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SkipScriptFlags': 'DISCOURAGE_UPGRADABLE_NOPS'
      },
      body: JSON.stringify({
        rawTx: txHex,
        skipScriptFlags: ['DISCOURAGE_UPGRADABLE_NOPS']
      }),
      noRetry: true
    })

    if (result.ok) {
      const arcResult = await result.value.json()
      apiLogger.debug('ARC response', { txStatus: arcResult.txStatus, txid: arcResult.txid })

      if (arcResult.txid && (arcResult.txStatus === 'SEEN_ON_NETWORK' || arcResult.txStatus === 'ACCEPTED')) {
        const validArcTxid = pickValidTxid(arcResult.txid, localTxid)
        if (validArcTxid) {
          apiLogger.info('ARC broadcast successful', { txid: validArcTxid })
          return validArcTxid
        }
      }
      const errorMsg = arcResult.detail || arcResult.extraInfo || arcResult.title || 'Unknown ARC error'
      apiLogger.warn('ARC rejected transaction', { error: errorMsg })
      errors.push(`ARC: ${errorMsg}`)
      if (isTxAlreadyKnown(errorMsg) && localTxid) {
        apiLogger.info('ARC: txn-already-known — treating as success', { txid: localTxid })
        return localTxid
      }
    } else {
      const errorMsg = result.error.message
      errors.push(`ARC: ${errorMsg}`)
      if (isTxAlreadyKnown(errorMsg) && localTxid) {
        apiLogger.info('ARC: txn-already-known (http) — treating as success', { txid: localTxid })
        return localTxid
      }
    }
  } catch (error) {
    const errorMsg = String(error)
    apiLogger.warn('ARC error', { error: errorMsg })
    errors.push(`ARC: ${errorMsg}`)
    if (isTxAlreadyKnown(errorMsg) && localTxid) {
      apiLogger.info('ARC: txn-already-known (catch) — treating as success', { txid: localTxid })
      return localTxid
    }
  }

  // 3. Try ARC with text/plain body
  try {
    const result = await gpArcApi.fetch('/v1/tx', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'X-SkipScriptFlags': 'DISCOURAGE_UPGRADABLE_NOPS'
      },
      body: txHex,
      noRetry: true
    })

    if (result.ok) {
      const arcResult = await result.value.json()
      apiLogger.debug('ARC (text) response', { txStatus: arcResult.txStatus, txid: arcResult.txid })

      if (arcResult.txid && (arcResult.txStatus === 'SEEN_ON_NETWORK' || arcResult.txStatus === 'ACCEPTED')) {
        const validArc2Txid = pickValidTxid(arcResult.txid, localTxid)
        if (validArc2Txid) {
          apiLogger.info('ARC (text) broadcast successful', { txid: validArc2Txid })
          return validArc2Txid
        }
      }
      const errorMsg = arcResult.detail || arcResult.extraInfo || arcResult.title || 'Unknown ARC error'
      errors.push(`ARC2: ${errorMsg}`)
      if (isTxAlreadyKnown(errorMsg) && localTxid) {
        apiLogger.info('ARC2: txn-already-known — treating as success', { txid: localTxid })
        return localTxid
      }
    } else {
      const errorMsg = result.error.message
      errors.push(`ARC2: ${errorMsg}`)
      if (isTxAlreadyKnown(errorMsg) && localTxid) {
        apiLogger.info('ARC2: txn-already-known (http) — treating as success', { txid: localTxid })
        return localTxid
      }
    }
  } catch (error) {
    const errorMsg = String(error)
    errors.push(`ARC2: ${errorMsg}`)
    if (isTxAlreadyKnown(errorMsg) && localTxid) {
      apiLogger.info('ARC2: txn-already-known (catch) — treating as success', { txid: localTxid })
      return localTxid
    }
  }

  // 4. Try GorillaPool mAPI as last fallback
  try {
    const result = await gpMapiApi.fetch('/mapi/tx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawtx: txHex }),
      noRetry: true
    })

    if (result.ok) {
      const mResult = await result.value.json()
      apiLogger.debug('mAPI response received')

      if (mResult.payload) {
        const payload = typeof mResult.payload === 'string' ? JSON.parse(mResult.payload) : mResult.payload
        if (payload.returnResult === 'success' && payload.txid) {
          const validMapiTxid = pickValidTxid(payload.txid, localTxid)
          if (validMapiTxid) {
            apiLogger.info('mAPI broadcast successful', { txid: validMapiTxid })
            return validMapiTxid
          }
        }
        const errorMsg = payload.resultDescription || payload.returnResult || 'Unknown mAPI error'
        errors.push(`mAPI: ${errorMsg}`)
        if (isTxAlreadyKnown(errorMsg) && localTxid) {
          apiLogger.info('mAPI: txn-already-known — treating as success', { txid: localTxid })
          return localTxid
        }
      } else {
        errors.push('mAPI: No payload in response')
      }
    } else {
      const errorMsg = result.error.message
      errors.push(`mAPI: ${errorMsg}`)
      if (isTxAlreadyKnown(errorMsg) && localTxid) {
        apiLogger.info('mAPI: txn-already-known (http) — treating as success', { txid: localTxid })
        return localTxid
      }
    }
  } catch (error) {
    const errorMsg = String(error)
    errors.push(`mAPI: ${errorMsg}`)
    if (isTxAlreadyKnown(errorMsg) && localTxid) {
      apiLogger.info('mAPI: txn-already-known (catch) — treating as success', { txid: localTxid })
      return localTxid
    }
  }

  // Final fallback: if any error was "txn-already-known" and we have a local txid,
  // the transaction IS in the mempool — treat as success
  if (localTxid && errors.some(e => isTxAlreadyKnown(e))) {
    apiLogger.info('txn-already-known detected in errors — treating as success', { txid: localTxid })
    return localTxid
  }

  // Log full errors for debugging, but sanitize the user-facing message
  apiLogger.error('All broadcast endpoints failed', { errors })
  // Extract only the reason (strip endpoint names and raw API responses)
  const sanitized = errors.map(e => e.replace(/^(WoC|ARC[^:]*|mAPI):\s*/i, '').slice(0, 200))
  throw new Error(`Broadcast failed: ${sanitized.join(' | ')}`)
}
