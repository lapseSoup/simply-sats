/**
 * BRC-100 HTTP Server Listener
 *
 * Sets up the Tauri event listener for BRC-100 requests
 * from the HTTP server backend.
 */

import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { brc100Logger } from '../logger'
import { getCurrentBlockHeight } from '../sync'
import { getLocks as getLocksFromDB } from '../database'
import {
  isValidBRC100RequestType,
  getParams,
  type BRC100Request,
  type BRC100Response,
  type ListOutputsParams,
  type LockBSVParams,
  type UnlockBSVParams,
  type LockedOutput
} from './types'
import { getRequestManager } from './RequestManager'
import { getWalletKeys } from './state'
import { resolvePublicKey, resolveListOutputs } from './outputs'

// Set up listener for HTTP server requests via Tauri events
export async function setupHttpServerListener(): Promise<() => void> {
  const requestManager = getRequestManager()

  // Legacy pendingRequests map - redirects to RequestManager
  const pendingRequests = {
    set: (id: string, value: { request: BRC100Request; resolve: (r: BRC100Response) => void; reject: (e: Error) => void }) => {
      requestManager.add(id, value.request, value.resolve, value.reject)
    }
  }

  try {
    const unlisten = await listen<{
      id: string
      method: string
      params: Record<string, unknown>
      origin?: string
    }>('brc100-request', async (event) => {
      try {
        // Validate the request type before processing
        const requestMethod = event.payload.method
        if (!isValidBRC100RequestType(requestMethod)) {
          brc100Logger.error(`Invalid request type: ${requestMethod}`)
          try {
            await invoke('respond_to_brc100', {
              requestId: event.payload.id,
              response: { error: { code: -32601, message: `Invalid method: ${requestMethod}` } }
            })
          } catch (e) {
            brc100Logger.error('Failed to send error response for invalid method', e)
          }
          return
        }

        const request: BRC100Request = {
          id: event.payload.id,
          type: requestMethod,
          params: event.payload.params,
          origin: event.payload.origin
        }

      // If no wallet is loaded, return error for requests that need it
      if (!getWalletKeys()) {
        if (request.type === 'getPublicKey' || request.type === 'createSignature' ||
            request.type === 'createAction' || request.type === 'listOutputs' ||
            request.type === 'lockBSV' || request.type === 'unlockBSV' || request.type === 'listLocks') {
          try {
            await invoke('respond_to_brc100', {
              requestId: request.id,
              response: { error: { code: -32002, message: 'No wallet loaded' } }
            })
          } catch (e) {
            brc100Logger.error('Failed to send error response', e)
          }
          return
        }
      }

      const walletKeys = getWalletKeys()
      if (request.type === 'getPublicKey' && walletKeys) {
        const publicKey = resolvePublicKey(walletKeys, request.params || {})
        try {
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { result: { publicKey } }
          })
        } catch (e) {
          brc100Logger.error('Failed to send auto-response', e)
        }
        return
      }

      // Auto-respond to listOutputs using database
      if (request.type === 'listOutputs' && getWalletKeys()) {
        const params = getParams<ListOutputsParams>(request)
        try {
          const result = await resolveListOutputs(params)
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { result }
          })
          return
        } catch (e) {
          brc100Logger.error('Failed to list outputs', e)
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { error: { code: -32000, message: 'Failed to list outputs' } }
          })
          return
        }
      }

      // Handle listLocks - returns all time-locked outputs
      if (request.type === 'listLocks' && getWalletKeys()) {
        try {
          const currentHeight = await getCurrentBlockHeight()
          const locks = await getLocksFromDB(currentHeight)

          const lockOutputs: LockedOutput[] = locks.map(lock => ({
            outpoint: `${lock.utxo.txid}.${lock.utxo.vout}`,
            txid: lock.utxo.txid,
            vout: lock.utxo.vout,
            satoshis: lock.utxo.satoshis,
            unlockBlock: lock.unlockBlock,
            tags: [`unlock_${lock.unlockBlock}`, ...(lock.ordinalOrigin ? [`ordinal_${lock.ordinalOrigin}`] : [])],
            spendable: currentHeight >= lock.unlockBlock,
            blocksRemaining: Math.max(0, lock.unlockBlock - currentHeight)
          }))

          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { result: { locks: lockOutputs, currentHeight } }
          })
          return
        } catch (e) {
          brc100Logger.error('Failed to list locks', e)
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { error: { code: -32000, message: 'Failed to list locks' } }
          })
          return
        }
      }

      // Handle lockBSV - creates time-locked output using OP_PUSH_TX
      // This requires user approval as it spends funds
      if (request.type === 'lockBSV' && getWalletKeys()) {
        const params = getParams<LockBSVParams>(request)
        const satoshis = params.satoshis
        const blocks = params.blocks

        if (!satoshis || satoshis <= 0 || !Number.isFinite(satoshis) || satoshis > 21_000_000_00_000_000) {
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { error: { code: -32602, message: 'Invalid satoshis amount' } }
          })
          return
        }

        if (!blocks || blocks <= 0 || !Number.isInteger(blocks) || blocks > 210_000) {
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { error: { code: -32602, message: 'Invalid blocks duration (must be 1-210000)' } }
          })
          return
        }

        // This will be handled by the pending request flow for user approval
        // Don't auto-process - let it fall through to be queued for approval
      }

      // Handle unlockBSV - spends time-locked output back to wallet
      // This requires user approval as it spends funds
      if (request.type === 'unlockBSV' && getWalletKeys()) {
        const params = getParams<UnlockBSVParams>(request)
        const outpoint = params.outpoints?.[0]

        if (!outpoint) {
          await invoke('respond_to_brc100', {
            requestId: request.id,
            response: { error: { code: -32602, message: 'Missing outpoint parameter' } }
          })
          return
        }

        // This will be handled by the pending request flow for user approval
        // Don't auto-process - let it fall through to be queued for approval
      }

      // Store as pending and notify UI for requests that need approval
      pendingRequests.set(request.id, {
        request,
        resolve: async (response) => {
          // Send response back to Tauri backend
          try {
            await invoke('respond_to_brc100', {
              requestId: request.id,
              response
            })
          } catch (e) {
            brc100Logger.error('Failed to send BRC-100 response', e)
          }
        },
        reject: async (error) => {
          try {
            await invoke('respond_to_brc100', {
              requestId: request.id,
              response: {
                id: request.id,
                error: { code: -32000, message: error.message || 'Unknown error' }
              }
            })
          } catch (e) {
            brc100Logger.error('Failed to send BRC-100 error', e)
          }
        }
      })

      const requestHandler = requestManager.getRequestHandler()
      if (requestHandler) {
        requestHandler(request)
      }
      } catch (err) {
        brc100Logger.error('Error in event handler', err)
      }
    })

    return unlisten
  } catch {
    return () => {}
  }
}
