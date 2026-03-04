/**
 * Hook for MessageBox payment notifications.
 *
 * Extracted from App.tsx to reduce the monolith.
 * Sets up the payment listener when a wallet is loaded,
 * resets auth on account switch, and manages the payment alert state.
 */

import { useState, useEffect, useRef } from 'react'
import type { WalletKeys } from '../services/wallet'
import type { PaymentNotification } from '../services/messageBox'
import { loadNotifications, startPaymentListenerFromWif, resetMessageBoxAuth } from '../services/messageBox'
import { logger } from '../services/logger'
import type { ToastType } from '../contexts/UIContext'

interface UsePaymentListenerOptions {
  wallet: WalletKeys | null
  fetchData: () => Promise<void>
  showToast: (message: string, type?: ToastType) => void
}

interface UsePaymentListenerReturn {
  newPaymentAlert: PaymentNotification | null
  dismissPaymentAlert: () => void
}

/**
 * Listens for incoming payments via the MessageBox protocol.
 * Resets auth and reloads notifications on each account switch (wallet change).
 */
export function usePaymentListener({
  wallet,
  fetchData,
  showToast,
}: UsePaymentListenerOptions): UsePaymentListenerReturn {
  const [newPaymentAlert, setNewPaymentAlert] = useState<PaymentNotification | null>(null)

  // Ref mirrors to avoid stale closures without adding unstable deps
  const fetchDataRef = useRef(fetchData)
  useEffect(() => { fetchDataRef.current = fetchData }, [fetchData])

  const showToastRef = useRef(showToast)
  useEffect(() => { showToastRef.current = showToast }, [showToast])

  useEffect(() => {
    if (!wallet) return

    // Reset auth failure counter on account switch -- new identity key may succeed
    resetMessageBoxAuth()
    loadNotifications()

    const handleNewPayment = (payment: PaymentNotification) => {
      logger.info('New payment received', { txid: payment.txid, amount: payment.amount })
      setNewPaymentAlert(payment)
      showToastRef.current(`Received ${payment.amount?.toLocaleString() || 'unknown'} sats!`)
      fetchDataRef.current()
      setTimeout(() => setNewPaymentAlert(null), 5000)
    }

    const setupListener = async () => {
      const { getWifForOperation } = await import('../services/wallet')
      const identityWif = await getWifForOperation('identity', 'paymentListener', wallet)
      return startPaymentListenerFromWif(identityWif, handleNewPayment)
    }

    let stopListener: (() => void) | undefined
    setupListener()
      .then(stop => { stopListener = stop })
      .catch(err => logger.error('Failed to start payment listener', err))

    return () => {
      stopListener?.()
    }
  }, [wallet])

  const dismissPaymentAlert = () => setNewPaymentAlert(null)

  return { newPaymentAlert, dismissPaymentAlert }
}
