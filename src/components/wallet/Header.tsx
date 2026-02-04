import { useWallet } from '../../contexts/WalletContext'
import { SimplySatsLogo } from '../shared/SimplySatsLogo'

interface HeaderProps {
  onSettingsClick: () => void
}

export function Header({ onSettingsClick }: HeaderProps) {
  const { networkInfo, syncing, performSync, fetchData } = useWallet()

  const handleSync = async () => {
    await performSync(false)
    await fetchData()
  }

  return (
    <header className="header">
      <div className="logo">
        <div className="logo-icon">
          <SimplySatsLogo size={18} />
        </div>
        Simply Sats
        <span className="header-badge">BRC-100</span>
      </div>
      <div className="header-actions">
        <div
          className="header-status"
          title={`Block ${networkInfo?.blockHeight?.toLocaleString() || '...'}`}
        >
          <span className="status-dot online" aria-hidden="true"></span>
          <span className="sr-only">Current block height:</span>
          {networkInfo?.blockHeight?.toLocaleString() || '...'}
        </div>
        <button
          className={`icon-btn ${syncing ? 'active' : ''}`}
          onClick={handleSync}
          title="Sync wallet"
          aria-label={syncing ? 'Syncing...' : 'Sync wallet'}
          disabled={syncing}
        >
          🔄
        </button>
        <button
          className="icon-btn"
          onClick={onSettingsClick}
          aria-label="Settings"
        >
          ⚙️
        </button>
      </div>
    </header>
  )
}
