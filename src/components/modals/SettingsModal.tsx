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

  // Explicit max-height bypasses Tauri WebKit flex-scroll bug.
  // The CSS flex approach (.modal-content-scroll { flex: 1; overflow-y: auto })
  // works in Chromium but fails in WebKit when the parent's height comes from
  // max-height rather than height. Inline max-height gives WebKit a concrete
  // constraint. The 100px accounts for modal padding (24px) + header (~56px) + margin.
  return (
    <Modal onClose={onClose} title="Settings">
      <div
        className="modal-content-scroll"
        style={{ maxHeight: 'calc(100vh - 100px)' }}
      >
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
