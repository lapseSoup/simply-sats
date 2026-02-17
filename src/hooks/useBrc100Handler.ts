import { useEffect, useRef, useState, useCallback } from 'react'
import type { BRC100Request } from '../services/brc100'
import {
  setRequestHandler,
  approveRequest,
  rejectRequest,
  getPendingRequests,
  setupHttpServerListener
} from '../services/brc100'
import { setupDeepLinkListener } from '../services/deeplink'
import type { WalletKeys } from '../services/wallet'
import { brc100Logger } from '../services/logger'
import { useConnectedApps } from '../contexts/ConnectedAppsContext'

interface UseBrc100HandlerOptions {
  wallet: WalletKeys | null
  onRequestReceived?: (request: BRC100Request) => void
}

interface UseBrc100HandlerReturn {
  brc100Request: BRC100Request | null
  handleApprove: () => void
  handleReject: () => void
  clearRequest: () => void
}

/**
 * Hook for handling BRC-100 protocol requests.
 * Sets up listeners for deep links and HTTP server requests,
 * and manages the approval/rejection flow.
 */
export function useBrc100Handler({
  wallet,
  onRequestReceived
}: UseBrc100HandlerOptions): UseBrc100HandlerReturn {
  const [brc100Request, setBrc100Request] = useState<BRC100Request | null>(null)
  const { connectedApps, connectApp, isTrustedOrigin } = useConnectedApps()

  // Keep a ref to the latest isTrustedOrigin so the main effect doesn't
  // tear down listeners every time a new origin is trusted.
  const isTrustedOriginRef = useRef(isTrustedOrigin)
  useEffect(() => {
    isTrustedOriginRef.current = isTrustedOrigin
  }, [isTrustedOrigin])

  // Set up BRC-100 request handler
  useEffect(() => {
    const handleIncomingRequest = async (request: BRC100Request) => {
      // Check if this is from a trusted origin (auto-approve)
      const isTrusted = request.origin && isTrustedOriginRef.current(request.origin)

      if (isTrusted && wallet) {
        brc100Logger.info(`Auto-approving request from trusted origin: ${request.origin}`)
        approveRequest(request.id, wallet)
        return
      }

      setBrc100Request(request)
      onRequestReceived?.(request)
    }

    setRequestHandler(handleIncomingRequest)

    let mounted = true
    let unlistenDeepLink: (() => void) | null = null
    let unlistenHttp: (() => void) | null = null

    setupDeepLinkListener(handleIncomingRequest).then(unlisten => {
      if (mounted) {
        unlistenDeepLink = unlisten
      } else {
        unlisten()
      }
    })

    setupHttpServerListener().then(unlisten => {
      if (mounted) {
        unlistenHttp = unlisten
      } else {
        unlisten()
      }
    })

    // Check for pending requests on mount
    const pending = getPendingRequests()
    if (pending.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Initialization on mount
      setBrc100Request(pending[0]!)
      onRequestReceived?.(pending[0]!)
    }

    return () => {
      mounted = false
      if (unlistenDeepLink) unlistenDeepLink()
      if (unlistenHttp) unlistenHttp()
    }
  }, [wallet, onRequestReceived])

  const handleApprove = useCallback(() => {
    if (!brc100Request || !wallet) return

    if (brc100Request.origin && !connectedApps.includes(brc100Request.origin)) {
      connectApp(brc100Request.origin)
    }

    approveRequest(brc100Request.id, wallet)
    setBrc100Request(null)
  }, [brc100Request, wallet, connectedApps, connectApp])

  const handleReject = useCallback(() => {
    if (!brc100Request) return
    rejectRequest(brc100Request.id)
    setBrc100Request(null)
  }, [brc100Request])

  const clearRequest = useCallback(() => {
    setBrc100Request(null)
  }, [])

  return {
    brc100Request,
    handleApprove,
    handleReject,
    clearRequest
  }
}
