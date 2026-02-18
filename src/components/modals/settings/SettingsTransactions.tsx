import { Fuel } from 'lucide-react'
import { useWalletState, useWalletActions } from '../../../contexts'

export function SettingsTransactions() {
  const { feeRateKB } = useWalletState()
  const { setFeeRate } = useWalletActions()

  return (
    <div className="settings-section">
      <div className="settings-section-title">Transactions</div>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-left">
            <div className="settings-row-icon" aria-hidden="true"><Fuel size={16} strokeWidth={1.75} /></div>
            <div className="settings-row-content">
              <div className="settings-row-label">Fee Rate</div>
              <div className="settings-row-value">
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={feeRateKB}
                  onChange={(e) => setFeeRate(parseInt(e.target.value) || 100)}
                  onClick={(e) => e.stopPropagation()}
                  autoComplete="off"
                  aria-label="Fee rate in sats per KB"
                  style={{
                    width: '60px',
                    padding: '4px 8px',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    textAlign: 'right'
                  }}
                /> sats/KB
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
          Default: 100 sats/KB. Most miners accept 50-100. Lower = cheaper, higher = faster confirmation.
        </div>
      </div>
    </div>
  )
}
