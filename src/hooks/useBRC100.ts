/**
 * BRC-100 Hook for Simply Sats
 *
 * Manages BRC-100 request handling, HTTP server listener setup,
 * and pending request state.
 */

import { useState, useEffect, useCallback } from 'react'
import type { WalletKeys } from '../services/wallet'
import {
  setupHttpServerListener,
  setWalletKeys,
  setRequestHandler,
  type BRC100Request
} from '../services/brc100'
import { brc100Logger } from '../services/logger'

export interface UseBRC100Options {
  wallet: WalletKeys | null
  onRequest?: (request: BRC100Request) => void
}

export interface UseBRC100Result {
  pendingRequest: BRC100Request | null
  clearPendingRequest: () => void
}

/**
 * Hook for managing BRC-100 protocol integration
 */
export function useBRC100({ wallet, onRequest }: UseBRC100Options): UseBRC100Result {
  const [pendingRequest, setPendingRequest] = useState<BRC100Request | null>(null)

  // Handle incoming BRC-100 requests
  const handleRequest = useCallback((request: BRC100Request) => {
    brc100Logger.info('Received BRC-100 request', { type: request.type, origin: request.origin })
    setPendingRequest(request)
    onRequest?.(request)
  }, [onRequest])

  // Clear pending request
  const clearPendingRequest = useCallback(() => {
    setPendingRequest(null)
  }, [])

  // Set up BRC-100 listeners when wallet is loaded
  useEffect(() => {
    if (!wallet) {
      setWalletKeys(null)
      return
    }

    // Update wallet keys for BRC-100 service
    setWalletKeys(wallet)

    // Set up request handler
    setRequestHandler(handleRequest)

    // Set up HTTP server listener
    let cleanupListener: (() => void) | undefined

    setupHttpServerListener().then(cleanup => {
      cleanupListener = cleanup
      brc100Logger.info('[BRC100] HTTP server listener active')
    }).catch(error => {
      brc100Logger.error('[BRC100] Failed to setup listener:', error)
    })

    return () => {
      cleanupListener?.()
      setRequestHandler(() => {})
    }
  }, [wallet, handleRequest])

  return {
    pendingRequest,
    clearPendingRequest
  }
}
