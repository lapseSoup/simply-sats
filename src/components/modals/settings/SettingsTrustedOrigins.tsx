import { useState, useCallback } from 'react'
import { Bot, Plus } from 'lucide-react'
import { useConnectedApps } from '../../../contexts/ConnectedAppsContext'
import { useUI } from '../../../contexts/UIContext'
import { handleKeyDown } from './settingsKeyDown'

export function SettingsTrustedOrigins() {
  const { trustedOrigins, addTrustedOrigin, removeTrustedOrigin } = useConnectedApps()
  const { showToast } = useUI()

  const [showTrustedOriginInput, setShowTrustedOriginInput] = useState(false)
  const [trustedOriginInput, setTrustedOriginInput] = useState('')

  const handleAddTrustedOrigin = useCallback(() => {
    if (trustedOriginInput.trim()) {
      addTrustedOrigin(trustedOriginInput.trim())
      setTrustedOriginInput('')
      setShowTrustedOriginInput(false)
      showToast(`Trusted origin "${trustedOriginInput.trim()}" added!`)
    }
  }, [trustedOriginInput, addTrustedOrigin, showToast])

  return (
    <div className="settings-section">
      <div className="settings-section-title">Trusted Origins (Auto-Approve)</div>
      <div className="settings-card">
        <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
          Requests from these origins will be auto-approved without prompting.
        </div>
        {trustedOrigins.map(origin => (
          <div key={origin} className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true"><Bot size={16} strokeWidth={1.75} /></div>
              <div className="settings-row-content">
                <div className="settings-row-label">{origin}</div>
                <div className="settings-row-value">Auto-approve enabled</div>
              </div>
            </div>
            <button className="app-disconnect" onClick={() => removeTrustedOrigin(origin)}>
              Remove
            </button>
          </div>
        ))}
        {!showTrustedOriginInput ? (
          <div className="settings-row" role="button" tabIndex={0} onClick={() => setShowTrustedOriginInput(true)} onKeyDown={handleKeyDown(() => setShowTrustedOriginInput(true))} aria-label="Add trusted origin">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true"><Plus size={16} strokeWidth={1.75} /></div>
              <div className="settings-row-content">
                <div className="settings-row-label">Add Trusted Origin</div>
                <div className="settings-row-value">e.g., "ai-agent", "wrootz"</div>
              </div>
            </div>
            <span className="settings-row-arrow" aria-hidden="true"><Plus size={16} strokeWidth={1.75} /></span>
          </div>
        ) : (
          <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
            <label htmlFor="trusted-origin-input" className="sr-only">Trusted origin name</label>
            <input
              id="trusted-origin-input"
              type="text"
              className="form-input"
              placeholder="Origin name (e.g., ai-agent, wrootz)"
              value={trustedOriginInput}
              onChange={e => setTrustedOriginInput(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              style={{ marginBottom: 8 }}
            />
            <div className="btn-group">
              <button className="btn btn-secondary" onClick={() => { setShowTrustedOriginInput(false); setTrustedOriginInput('') }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleAddTrustedOrigin}>
                Add
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
