/**
 * BRC-100 Validation — request/argument validation and approval lifecycle
 *
 * Handles request routing (handleBRC100Request), approval (approveRequest),
 * and rejection (rejectRequest) of BRC-100 requests.
 */

import { brc100Logger } from '../logger'
import type { WalletKeys } from '../wallet'
import {
  getBalanceFromDB,
  recordActionRequest,
  updateActionResult
} from '../database'
import {
  getParams,
  type BRC100Request,
  type BRC100Response,
  type ListOutputsParams,
  type GetPublicKeyParams
} from './types'
import { getRequestManager } from './RequestManager'
import { getWalletKeys } from './state'
import { getBlockHeight } from './utils'
import { resolvePublicKey, resolveListOutputs } from './outputs'
import { getPendingRequests, executeApprovedRequest } from './handlers'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Handle incoming BRC-100 request
export async function handleBRC100Request(
  request: BRC100Request,
  keys: WalletKeys,
  autoApprove: boolean = false
): Promise<BRC100Response> {
  const pendingRequests = getPendingRequests()
  const requestManager = getRequestManager()
  const response: BRC100Response = { id: request.id }

  try {
    switch (request.type) {
      // Fast-path: no approval needed, execute immediately
      case 'getPublicKey':
      case 'getHeight':
      case 'listOutputs':
      case 'getNetwork':
      case 'getVersion':
      case 'isAuthenticated': {
        // These never require approval — handle inline for the fast path
        switch (request.type) {
          case 'getPublicKey': {
            const params = getParams<GetPublicKeyParams>(request)
            response.result = { publicKey: resolvePublicKey(keys, params) }
            break
          }

          case 'getHeight': {
            const height = await getBlockHeight()
            response.result = { height }
            break
          }

          case 'listOutputs': {
            const params = getParams<ListOutputsParams>(request)
            try {
              response.result = await resolveListOutputs(params)
            } catch (error) {
              brc100Logger.error('listOutputs error', error)
              // Fallback to balance from database
              {
                const balanceResult = await getBalanceFromDB(params.basket || undefined)
                if (balanceResult.ok) {
                  response.result = {
                    outputs: [{ satoshis: balanceResult.value, spendable: true }],
                    totalOutputs: balanceResult.value > 0 ? 1 : 0
                  }
                } else {
                  brc100Logger.error('getBalanceFromDB fallback also failed', balanceResult.error)
                  response.result = { outputs: [], totalOutputs: 0 }
                }
              }
            }
            break
          }

          case 'getNetwork':
            response.result = { network: 'mainnet' }
            break

          case 'getVersion':
            response.result = { version: '0.1.0' }
            break

          case 'isAuthenticated':
            response.result = { authenticated: true }
            break
        }
        break
      }

      // createSignature: auto-approve executes directly, otherwise queue
      case 'createSignature': {
        if (!autoApprove) {
          return new Promise((resolve, reject) => {
            pendingRequests.set(request.id, { request, resolve, reject })
            const handler = requestManager.getRequestHandler()
            if (handler) {
              handler(request)
            }
          })
        }
        try {
          return await executeApprovedRequest(request, keys)
        } catch (error) {
          response.error = {
            code: -32000,
            message: error instanceof Error ? error.message : 'Unknown error'
          }
          return response
        }
      }

      // createAction: always requires user approval (even with autoApprove flag)
      case 'createAction': {
        return new Promise((resolve, reject) => {
          pendingRequests.set(request.id, { request, resolve, reject })
          const handler = requestManager.getRequestHandler()
          if (handler) {
            handler(request)
          }
        })
      }

      // All other approval-required types: queue if not auto-approve, execute directly if auto-approve
      default: {
        if (!autoApprove) {
          return new Promise((resolve, reject) => {
            pendingRequests.set(request.id, { request, resolve, reject })
            const handler = requestManager.getRequestHandler()
            if (handler) {
              handler(request)
            }
          })
        }
        try {
          return await executeApprovedRequest(request, keys)
        } catch (error) {
          response.error = {
            code: -32000,
            message: error instanceof Error ? error.message : 'Unknown error'
          }
          return response
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
    brc100Logger.error('handleBRC100Request error', errorMessage)
    response.error = {
      code: -32000,
      message: errorMessage
    }
  }

  return response
}

// Approve a pending request
export async function approveRequest(requestId: string, keys: WalletKeys): Promise<void> {
  const pendingRequests = getPendingRequests()
  const pending = pendingRequests.get(requestId)
  if (!pending) return

  // B6: Re-fetch current keys to guard against wallet re-lock or account switch
  // between when the approval dialog opened and the user clicking "Approve".
  const freshKeys = getWalletKeys()
  if (freshKeys && freshKeys.identityPubKey === keys.identityPubKey) {
    keys = freshKeys
  } else if (freshKeys && freshKeys.identityPubKey !== keys.identityPubKey) {
    pending.resolve({
      id: requestId,
      error: { code: -32002, message: 'Wallet state has changed since approval was initiated' }
    })
    pendingRequests.delete(requestId)
    return
  } else {
    // No wallet loaded at all
    pending.resolve({
      id: requestId,
      error: { code: -32002, message: 'No wallet loaded' }
    })
    pendingRequests.delete(requestId)
    return
  }

  const { request, resolve } = pending

  // Record the action request
  try {
    await recordActionRequest({
      requestId: request.id,
      actionType: request.type,
      description: (request.params as Record<string, unknown>)?.description as string || `${request.type} request`,
      origin: request.origin,
      approved: true,
      inputParams: JSON.stringify(request.params),
      requestedAt: Date.now()
    })
  } catch (e) {
    brc100Logger.warn('Failed to record action request', undefined, e instanceof Error ? e : undefined)
  }

  try {
    const response = await executeApprovedRequest(request, keys)

    // Update action result with outcome
    try {
      const resultObj = response.result as Record<string, unknown> | undefined
      await updateActionResult(requestId, {
        txid: resultObj?.txid as string | undefined,
        approved: !response.error,
        error: response.error?.message,
        outputResult: JSON.stringify(response.result || response.error),
        completedAt: Date.now()
      })
    } catch (e) {
      brc100Logger.warn('Failed to update action result', undefined, e instanceof Error ? e : undefined)
    }

    resolve(response)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
    // Update action result with error
    try {
      await updateActionResult(requestId, {
        approved: false,
        error: errorMessage,
        completedAt: Date.now()
      })
    } catch (e) {
      brc100Logger.warn('Failed to update action result', undefined, e instanceof Error ? e : undefined)
    }

    resolve({
      id: requestId,
      error: { code: -32000, message: errorMessage }
    })
  }

  pendingRequests.delete(requestId)
}

// Reject a pending request
export async function rejectRequest(requestId: string): Promise<void> {
  const pendingRequests = getPendingRequests()
  const pending = pendingRequests.get(requestId)
  if (!pending) return

  const { request } = pending

  // Record the rejected action
  try {
    await recordActionRequest({
      requestId: request.id,
      actionType: request.type,
      description: (request.params as Record<string, unknown>)?.description as string || `${request.type} request`,
      origin: request.origin,
      approved: false,
      error: 'User rejected request',
      inputParams: JSON.stringify(request.params),
      requestedAt: Date.now(),
      completedAt: Date.now()
    })
  } catch (e) {
    brc100Logger.warn('Failed to record rejected action', undefined, e instanceof Error ? e : undefined)
  }

  pending.resolve({
    id: requestId,
    error: { code: -32003, message: 'User rejected request' }
  })

  pendingRequests.delete(requestId)
}
