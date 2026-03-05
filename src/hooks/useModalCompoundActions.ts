/**
 * Shared compound modal actions used by both App.tsx and AppModals.tsx.
 *
 * Each action combines a domain-state change (ordinal selection, mnemonic
 * confirm, etc.) with a modal open/close, so the two always stay in sync.
 *
 * Extracted to eliminate the duplicated definitions that previously lived
 * in both files (Q-121).
 */

import { useCallback } from 'react'
import { useModalContext, useOrdinalSelection, useWalletSetup } from '../contexts'
import type { Ordinal } from '../domain/types'

export function useModalCompoundActions() {
  const { closeModal: rawCloseModal, openModal } = useModalContext()
  const ordinalCtx = useOrdinalSelection()
  const { confirmMnemonic: rawConfirmMnemonic } = useWalletSetup()

  // B-104/B-111: Clear all ordinal state when closing any modal
  const closeModal = useCallback(() => {
    rawCloseModal()
    ordinalCtx.clearSelectedOrdinal()
    ordinalCtx.completeTransfer()
    ordinalCtx.completeList()
  }, [rawCloseModal, ordinalCtx])

  const confirmMnemonic = useCallback(() => {
    rawConfirmMnemonic()
    rawCloseModal()
  }, [rawConfirmMnemonic, rawCloseModal])

  const selectOrdinal = useCallback((ordinal: Ordinal) => {
    ordinalCtx.selectOrdinal(ordinal)
    openModal('ordinal')
  }, [ordinalCtx, openModal])

  const startTransferOrdinal = useCallback((ordinal: Ordinal) => {
    ordinalCtx.startTransferOrdinal(ordinal)
    openModal('transfer-ordinal')
  }, [ordinalCtx, openModal])

  const startListOrdinal = useCallback((ordinal: Ordinal) => {
    ordinalCtx.startListOrdinal(ordinal)
    openModal('list-ordinal')
  }, [ordinalCtx, openModal])

  const completeTransfer = useCallback(() => {
    ordinalCtx.completeTransfer()
    rawCloseModal()
  }, [ordinalCtx, rawCloseModal])

  const completeList = useCallback(() => {
    ordinalCtx.completeList()
    rawCloseModal()
  }, [ordinalCtx, rawCloseModal])

  return {
    closeModal,
    confirmMnemonic,
    selectOrdinal,
    startTransferOrdinal,
    startListOrdinal,
    completeTransfer,
    completeList,
  }
}
