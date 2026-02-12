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
import { apiLogger } from '../../services/logger'

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
    if (result.success) {
      const responseTxid = result.data
      if (responseTxid && localTxid && responseTxid !== localTxid) {
        apiLogger.error('TXID mismatch between WoC and local', {
          broadcasterTxid: responseTxid,
          localTxid
        })
      }
      apiLogger.info('WhatsOnChain broadcast successful')
      return responseTxid || localTxid || ''
    }
    apiLogger.warn('WoC broadcast failed', { error: result.error.message })
    errors.push(`WoC: ${result.error.message}`)
  } catch (error) {
    apiLogger.warn('WoC error', { error: String(error) })
    errors.push(`WoC: ${error}`)
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
        apiLogger.info('ARC broadcast successful', { txid: arcResult.txid })
        return arcResult.txid
      }
      const errorMsg = arcResult.detail || arcResult.extraInfo || arcResult.title || 'Unknown ARC error'
      apiLogger.warn('ARC rejected transaction', { error: errorMsg })
      errors.push(`ARC: ${errorMsg}`)
    } else {
      errors.push(`ARC: ${result.error.message}`)
    }
  } catch (error) {
    apiLogger.warn('ARC error', { error: String(error) })
    errors.push(`ARC: ${error}`)
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
        apiLogger.info('ARC (text) broadcast successful', { txid: arcResult.txid })
        return arcResult.txid
      }
      const errorMsg = arcResult.detail || arcResult.extraInfo || arcResult.title || 'Unknown ARC error'
      errors.push(`ARC2: ${errorMsg}`)
    } else {
      errors.push(`ARC2: ${result.error.message}`)
    }
  } catch (error) {
    errors.push(`ARC2: ${error}`)
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
          apiLogger.info('mAPI broadcast successful', { txid: payload.txid })
          return payload.txid
        }
        const errorMsg = payload.resultDescription || payload.returnResult || 'Unknown mAPI error'
        errors.push(`mAPI: ${errorMsg}`)
      } else {
        errors.push('mAPI: No payload in response')
      }
    } else {
      errors.push(`mAPI: ${result.error.message}`)
    }
  } catch (error) {
    errors.push(`mAPI: ${error}`)
  }

  throw new Error(`Failed to broadcast: ${errors.join(' | ')}`)
}
