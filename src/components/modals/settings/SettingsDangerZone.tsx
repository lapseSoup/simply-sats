import { useState, useCallback } from 'react'
import { useWalletActions } from '../../../contexts'
import { useUI } from '../../../contexts/UIContext'
import { ConfirmationModal } from '../../shared/ConfirmationModal'

interface SettingsDangerZoneProps {
  onClose: () => void
}

export function SettingsDangerZone({ onClose }: SettingsDangerZoneProps) {
  const { handleDeleteWallet } = useWalletActions()
  const { showToast } = useUI()

  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false)

  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirmation(true)
  }, [])

  const executeDelete = useCallback(async () => {
    setShowDeleteConfirmation(false)
    try {
      await handleDeleteWallet()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error deleting wallet', 'error')
    }
    onClose()
  }, [handleDeleteWallet, showToast, onClose])

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">Danger Zone</div>
        <button className="btn btn-danger" onClick={handleDeleteClick}>
          Delete Wallet
        </button>
      </div>

      {showDeleteConfirmation && (
        <ConfirmationModal
          title="Delete Wallet"
          message="This will permanently delete your wallet and all associated data. This action cannot be undone."
          details="Make sure you have saved your recovery phrase before proceeding!"
          type="danger"
          confirmText="Delete Wallet"
          cancelText="Cancel"
          onConfirm={executeDelete}
          onCancel={() => setShowDeleteConfirmation(false)}
          requireTypedConfirmation="DELETE"
          confirmDelaySeconds={3}
        />
      )}
    </>
  )
}
