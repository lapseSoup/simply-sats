/**
 * Hook for MessageBox payment notifications.
 *
 * Extracted from App.tsx to reduce the monolith.
 * Sets up the payment listener when a wallet is loaded,
 * resets auth on account switch, and manages the payment alert state.
 */

import { useState, useEffect } from 'react'
import type { ActiveWallet } from '../services/wallet'
import type { PaymentNotification } from '../services/messageBox'
import { loadNotifications, startPaymentListenerFromStore, resetMessageBoxAuth } from '../services/messageBox'
import { logger } from '../services/logger'
import type { ToastType } from '../contexts/UIContext'
import { useLatestRef } from './useLatestRef'

interface UsePaymentListenerOptions {
  wallet: ActiveWallet | null
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
  const fetchDataRef = useLatestRef(fetchData)
  const showToastRef = useLatestRef(showToast)

  useEffect(() => {
    if (!wallet) return

    // Reset auth failure counter on account switch -- new identity key may succeed
    resetMessageBoxAuth()
    loadNotifications()

    let timerId: ReturnType<typeof setTimeout> | null = null

    const handleNewPayment = (payment: PaymentNotification) => {
      logger.info('New payment received', { txid: payment.txid, amount: payment.amount })
      setNewPaymentAlert(payment)
      showToastRef.current(`Received ${payment.amount?.toLocaleString() || 'unknown'} sats!`)
      fetchDataRef.current().catch(err => logger.error('Failed to refresh data after payment', err))
      timerId = setTimeout(() => setNewPaymentAlert(null), 5000)
    }

    // S-121: Use store-based listener — identity WIF never enters JS heap.
    // The public key is already available in the wallet object.
    const stopListener = startPaymentListenerFromStore(wallet.identityPubKey, handleNewPayment)

    return () => {
      stopListener()
      setNewPaymentAlert(null)
      if (timerId) clearTimeout(timerId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- *Ref values are stable refs from useLatestRef
  }, [wallet])

  const dismissPaymentAlert = () => setNewPaymentAlert(null)

  return { newPaymentAlert, dismissPaymentAlert }
}
