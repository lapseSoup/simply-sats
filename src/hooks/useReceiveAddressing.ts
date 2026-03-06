import { useCallback } from 'react'
import {
  addDerivedAddress,
  addContact,
  getContacts,
  getNextInvoiceNumber
} from '../infrastructure/database'
import { deriveSenderAddressFromStore } from '../services/keyDerivation'
import { uiLogger } from '../services/logger'
import { BRC100 } from '../config'

export function useReceiveAddressing(
  activeAccountId: number | null,
  refreshContacts: () => Promise<void>,
  showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void
) {
  const deriveReceiveAddress = useCallback(async (
    senderPubKey: string,
    invoiceIndex: number
  ): Promise<string> => {
    try {
      const invoiceNumber = `${BRC100.INVOICE_PREFIX} ${invoiceIndex}`
      return await deriveSenderAddressFromStore('identity', senderPubKey, invoiceNumber)
    } catch (e) {
      uiLogger.error('Failed to derive address:', e)
      throw e
    }
  }, [])

  const saveDerivedAddress = useCallback(async (
    senderPubKey: string,
    address: string,
    invoiceIndex: number,
    label?: string
  ): Promise<boolean> => {
    try {
      const invoiceNumber = `${BRC100.INVOICE_PREFIX} ${invoiceIndex}`

      await addDerivedAddress({
        address,
        senderPubkey: senderPubKey,
        invoiceNumber,
        label: label || `From ${senderPubKey.substring(0, 8)}...`,
        createdAt: Date.now()
      }, activeAccountId ?? undefined)
      return true
    } catch (e) {
      uiLogger.error('Failed to save derived address:', e)
      return false
    }
  }, [activeAccountId])

  const fetchNextInvoiceNumber = useCallback(async (senderPubKey: string) => {
    return getNextInvoiceNumber(senderPubKey)
  }, [])

  const saveContact = useCallback(async (senderPubKey: string, label: string) => {
    try {
      await addContact({
        pubkey: senderPubKey,
        label,
        createdAt: Date.now()
      })
      const updatedResult = await getContacts()
      if (!updatedResult.ok) {
        uiLogger.error('Failed to reload contacts', updatedResult.error)
        showToast('Contact saved!', 'success')
        await refreshContacts()
        return null
      }
      await refreshContacts()
      showToast('Contact saved!', 'success')
      return updatedResult.value
    } catch (e) {
      uiLogger.error('Failed to save contact', e)
      showToast('Failed to save contact', 'error')
      return null
    }
  }, [refreshContacts, showToast])

  return {
    deriveReceiveAddress,
    saveDerivedAddress,
    fetchNextInvoiceNumber,
    saveContact
  }
}
