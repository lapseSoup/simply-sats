import { useWalletState } from '../../contexts'
import { Modal } from '../shared/Modal'
import {
  SettingsWallet,
  SettingsAppearance,
  SettingsTransactions,
  SettingsSecurity,
  SettingsBackup,
  SettingsCache,
  SettingsAdvanced,
  SettingsTrustedOrigins,
  SettingsConnectedApps,
  SettingsNetwork,
  SettingsDangerZone
} from './settings'

interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { wallet } = useWalletState()

  if (!wallet) return null

  return (
    <Modal onClose={onClose} title="Settings">
      <div className="modal-content">
        <SettingsWallet />
        <SettingsAppearance />
        <SettingsTransactions />
        <SettingsNetwork />
        <SettingsSecurity onClose={onClose} />
        <SettingsBackup />
        <SettingsCache />
        <SettingsAdvanced />
        <SettingsTrustedOrigins />
        <SettingsConnectedApps />
        <SettingsDangerZone onClose={onClose} />
      </div>
    </Modal>
  )
}
