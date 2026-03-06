import { useCallback } from 'react'
import { addKnownSender, getKnownSenders, debugFindInvoiceNumberFromStore } from '../services/keyDerivation'
import { checkForPaymentsFromStore, getPaymentNotifications } from '../services/messageBox'

export function useSettingsAdvancedTools(
  identityPubKey: string | undefined,
  fetchData: () => Promise<void>,
  showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void
) {
  const addSender = useCallback((senderPubKey: string) => {
    if (senderPubKey.length === 66) {
      addKnownSender(senderPubKey)
      void fetchData()
      showToast('Sender added!')
      return true
    }

    showToast('Invalid: must be 66 hex chars', 'warning')
    return false
  }, [fetchData, showToast])

  const checkMessageBox = useCallback(async () => {
    if (!identityPubKey) return

    const newPayments = await checkForPaymentsFromStore(identityPubKey)
    const notifications = getPaymentNotifications()
    if (newPayments.length > 0) {
      showToast(`Found ${newPayments.length} new payment(s)!`)
      void fetchData()
    } else {
      showToast('No new payments')
    }
    return notifications
  }, [fetchData, identityPubKey, showToast])

  const debugSearch = useCallback(async (targetAddress: string) => {
    if (!targetAddress || !identityPubKey) return 'Error'

    const senders = getKnownSenders()
    if (senders.length === 0) {
      return 'No known senders'
    }

    for (const sender of senders) {
      const result = await debugFindInvoiceNumberFromStore('identity', sender, targetAddress)
      if (result.found) {
        return `Found: "${result.invoiceNumber}"`
      }
    }

    return 'Not found'
  }, [identityPubKey])

  return {
    addSender,
    checkMessageBox,
    debugSearch,
    getPaymentNotifications,
    getKnownSenders
  }
}
