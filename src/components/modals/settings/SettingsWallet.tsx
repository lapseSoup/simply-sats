import { Wallet, Palette, KeyRound, Copy } from 'lucide-react'
import { useWalletState } from '../../../contexts'
import { useUI } from '../../../contexts/UIContext'
import { handleKeyDown } from './settingsKeyDown'

export function SettingsWallet() {
  const { wallet } = useWalletState()
  const { copyToClipboard } = useUI()

  if (!wallet) return null

  return (
    <div className="settings-section">
      <div className="settings-section-title">Wallet</div>
      <div className="settings-card">
        <div className="settings-row" role="button" tabIndex={0} onClick={() => wallet.walletAddress && copyToClipboard(wallet.walletAddress, 'Payment address copied!')} onKeyDown={handleKeyDown(() => wallet.walletAddress && copyToClipboard(wallet.walletAddress, 'Payment address copied!'))} aria-label="Copy payment address">
          <div className="settings-row-left">
            <div className="settings-row-icon" aria-hidden="true"><Wallet size={16} strokeWidth={1.75} /></div>
            <div className="settings-row-content">
              <div className="settings-row-label">Payment Address</div>
              <div className="settings-row-value" title={wallet.walletAddress || ''}>{wallet.walletAddress ? `${wallet.walletAddress.slice(0, 12)}...${wallet.walletAddress.slice(-6)}` : '\u2014'}</div>
            </div>
          </div>
          <span className="settings-row-arrow" aria-hidden="true"><Copy size={16} strokeWidth={1.75} /></span>
        </div>
        <div className="settings-row" role="button" tabIndex={0} onClick={() => wallet.ordAddress && copyToClipboard(wallet.ordAddress, 'Ordinals address copied!')} onKeyDown={handleKeyDown(() => wallet.ordAddress && copyToClipboard(wallet.ordAddress, 'Ordinals address copied!'))} aria-label="Copy ordinals address">
          <div className="settings-row-left">
            <div className="settings-row-icon" aria-hidden="true"><Palette size={16} strokeWidth={1.75} /></div>
            <div className="settings-row-content">
              <div className="settings-row-label">Ordinals Address</div>
              <div className="settings-row-value" title={wallet.ordAddress || ''}>{wallet.ordAddress ? `${wallet.ordAddress.slice(0, 12)}...${wallet.ordAddress.slice(-6)}` : '\u2014'}</div>
            </div>
          </div>
          <span className="settings-row-arrow" aria-hidden="true"><Copy size={16} strokeWidth={1.75} /></span>
        </div>
        <div className="settings-row" role="button" tabIndex={0} onClick={() => wallet.identityPubKey && copyToClipboard(wallet.identityPubKey, 'Identity key copied!')} onKeyDown={handleKeyDown(() => wallet.identityPubKey && copyToClipboard(wallet.identityPubKey, 'Identity key copied!'))} aria-label="Copy identity key">
          <div className="settings-row-left">
            <div className="settings-row-icon" aria-hidden="true"><KeyRound size={16} strokeWidth={1.75} /></div>
            <div className="settings-row-content">
              <div className="settings-row-label">Identity Key</div>
              <div className="settings-row-value" title={wallet.identityPubKey || ''}>{wallet.identityPubKey ? `${wallet.identityPubKey.slice(0, 12)}...${wallet.identityPubKey.slice(-6)}` : '\u2014'}</div>
            </div>
          </div>
          <span className="settings-row-arrow" aria-hidden="true"><Copy size={16} strokeWidth={1.75} /></span>
        </div>
      </div>
    </div>
  )
}
