import { Link2 } from 'lucide-react'
import { useConnectedApps } from '../../../contexts/ConnectedAppsContext'

export function SettingsConnectedApps() {
  const { connectedApps, disconnectApp } = useConnectedApps()

  if (connectedApps.length === 0) return null

  return (
    <div className="settings-section">
      <div className="settings-section-title">Connected Apps</div>
      <div className="settings-card">
        {connectedApps.map(app => (
          <div key={app} className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true"><Link2 size={16} strokeWidth={1.75} /></div>
              <div className="settings-row-content">
                <div className="settings-row-label">{app}</div>
              </div>
            </div>
            <button className="app-disconnect" onClick={() => disconnectApp(app)} aria-label={`Disconnect ${app}`}>
              Disconnect
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
