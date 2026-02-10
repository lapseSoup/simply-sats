import { useEffect, useState, useCallback } from 'react'
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

interface UseBrc100HandlerOptions {
  wallet: WalletKeys | null
  onRequestReceived?: (request: BRC100Request) => void
}

interface UseBrc100HandlerReturn {
  brc100Request: BRC100Request | null
  localConnectedApps: string[]
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
  const [localConnectedApps, setLocalConnectedApps] = useState<string[]>(() => {
    return JSON.parse(localStorage.getItem('simply_sats_connected_apps') || '[]')
  })

  // Set up BRC-100 request handler
  useEffect(() => {
    const handleIncomingRequest = async (request: BRC100Request) => {
      // Check if this is from a trusted origin (auto-approve)
      const savedTrustedOrigins = JSON.parse(
        localStorage.getItem('simply_sats_trusted_origins') || '[]'
      )
      const isTrusted = request.origin && savedTrustedOrigins.includes(request.origin)

      if (isTrusted && wallet) {
        brc100Logger.info(`Auto-approving request from trusted origin: ${request.origin}`)
        approveRequest(request.id, wallet)
        return
      }

      setBrc100Request(request)
      onRequestReceived?.(request)
    }

    setRequestHandler(handleIncomingRequest)

    let unlistenDeepLink: (() => void) | null = null
    setupDeepLinkListener(handleIncomingRequest).then(unlisten => {
      unlistenDeepLink = unlisten
    })

    let unlistenHttp: (() => void) | null = null
    setupHttpServerListener().then(unlisten => {
      unlistenHttp = unlisten
    })

    // Check for pending requests on mount
    const pending = getPendingRequests()
    if (pending.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Initialization on mount
      setBrc100Request(pending[0]!)
      onRequestReceived?.(pending[0]!)
    }

    return () => {
      if (unlistenDeepLink) unlistenDeepLink()
      if (unlistenHttp) unlistenHttp()
    }
  }, [wallet, onRequestReceived])

  const handleApprove = useCallback(() => {
    if (!brc100Request || !wallet) return

    if (brc100Request.origin && !localConnectedApps.includes(brc100Request.origin)) {
      const newConnectedApps = [...localConnectedApps, brc100Request.origin]
      setLocalConnectedApps(newConnectedApps)
      localStorage.setItem('simply_sats_connected_apps', JSON.stringify(newConnectedApps))
    }

    approveRequest(brc100Request.id, wallet)
    setBrc100Request(null)
  }, [brc100Request, wallet, localConnectedApps])

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
    localConnectedApps,
    handleApprove,
    handleReject,
    clearRequest
  }
}
