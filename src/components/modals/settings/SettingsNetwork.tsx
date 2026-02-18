import { useState, useCallback } from 'react'
import { Globe } from 'lucide-react'
import { getNetwork, setNetwork, NetworkType } from '../../../services/config'
import { useUI } from '../../../contexts/UIContext'

export function SettingsNetwork() {
  const { showToast } = useUI()
  const [network, setNetworkState] = useState<NetworkType>(getNetwork())

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const selected = e.target.value as NetworkType
      setNetwork(selected)
      setNetworkState(selected)
      showToast(
        selected === 'testnet'
          ? 'Switched to Testnet — restart to apply changes'
          : 'Switched to Mainnet — restart to apply changes',
        'success'
      )
    },
    [showToast]
  )

  return (
    <div className="settings-section">
      <div className="settings-section-title">Network</div>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-left">
            <div className="settings-row-icon" aria-hidden="true">
              <Globe size={16} strokeWidth={1.75} />
            </div>
            <div className="settings-row-content">
              <div className="settings-row-label">
                Network
              </div>
              <div className="settings-row-value">
                <select
                  value={network}
                  onChange={handleChange}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Select network"
                  style={{
                    padding: '4px 8px',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                  }}
                >
                  <option value="mainnet">Mainnet</option>
                  <option value="testnet">Testnet</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        {network === 'testnet' && (
          <div style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
            Warning: Testnet coins have no real value. Restart the app for all endpoints to update.
          </div>
        )}
      </div>
    </div>
  )
}
