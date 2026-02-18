import { useState } from 'react'
import { Wallet, Palette, KeyRound, Copy, PenLine, Eye, EyeOff, AlertTriangle } from 'lucide-react'
import { useWalletState } from '../../../contexts'
import { useUI } from '../../../contexts/UIContext'
import { handleKeyDown } from './settingsKeyDown'
import { SignMessageModal } from '../SignMessageModal'

export function SettingsWallet() {
  const { wallet } = useWalletState()
  const { copyToClipboard } = useUI()
  const [showSignMessage, setShowSignMessage] = useState(false)
  const [showWif, setShowWif] = useState(false)

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
        <div className="settings-row" role="button" tabIndex={0} onClick={() => setShowSignMessage(true)} onKeyDown={handleKeyDown(() => setShowSignMessage(true))} aria-label="Sign or verify a message">
          <div className="settings-row-left">
            <div className="settings-row-icon" aria-hidden="true"><PenLine size={16} strokeWidth={1.75} /></div>
            <div className="settings-row-content">
              <div className="settings-row-label">Sign Message</div>
              <div className="settings-row-value">Sign or verify with your key</div>
            </div>
          </div>
          <span className="settings-row-arrow" aria-hidden="true"><PenLine size={16} strokeWidth={1.75} /></span>
        </div>
      </div>

      {/* WIF Private Key Export — Danger Zone */}
      {/* TODO: WIF import is future work. Importing a bare WIF has no mnemonic for backup,
           which requires a separate wallet derivation path and distinct backup warning flow. */}
      <div className="settings-section-title" style={{ marginTop: '1.5rem' }}>Private Key Export</div>
      <div className="settings-card">
        <div style={{ padding: '0.75rem 1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <AlertTriangle size={14} strokeWidth={2} style={{ color: 'var(--color-warning, #f59e0b)', flexShrink: 0 }} aria-hidden="true" />
            <span style={{ fontSize: '0.75rem', color: 'var(--color-warning, #f59e0b)', fontWeight: 600 }}>
              Never share your private key. Anyone with this key has full control of your funds.
            </span>
          </div>
          <button
            className="btn btn-secondary"
            style={{ marginBottom: showWif ? '0.75rem' : 0, fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            onClick={() => setShowWif(v => !v)}
            aria-expanded={showWif}
            aria-controls="wif-key-panel"
          >
            {showWif
              ? <><EyeOff size={14} strokeWidth={1.75} aria-hidden="true" /> Hide WIF Key</>
              : <><Eye size={14} strokeWidth={1.75} aria-hidden="true" /> Show WIF Key</>
            }
          </button>
          {showWif && (
            <div id="wif-key-panel">
              <textarea
                readOnly
                value={wallet.walletWif ?? ''}
                rows={2}
                aria-label="Payment private key (WIF)"
                style={{
                  width: '100%',
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  resize: 'none',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--color-border, #374151)',
                  background: 'var(--color-surface-2, #111827)',
                  color: 'var(--color-text, #f9fafb)',
                  padding: '0.5rem',
                  boxSizing: 'border-box',
                  marginBottom: '0.5rem',
                }}
              />
              <button
                className="btn btn-secondary"
                style={{ fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}
                onClick={() => wallet.walletWif && copyToClipboard(wallet.walletWif, 'Private key copied!')}
                aria-label="Copy WIF private key"
              >
                <Copy size={14} strokeWidth={1.75} aria-hidden="true" /> Copy
              </button>
            </div>
          )}
        </div>
      </div>

      {showSignMessage && <SignMessageModal onClose={() => setShowSignMessage(false)} />}
    </div>
  )
}
