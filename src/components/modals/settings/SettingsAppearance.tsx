import { Sun, Moon } from 'lucide-react'
import { useUI } from '../../../contexts/UIContext'
import { handleKeyDown } from './settingsKeyDown'

export function SettingsAppearance() {
  const { theme, toggleTheme } = useUI()

  return (
    <div className="settings-section">
      <div className="settings-section-title">Appearance</div>
      <div className="settings-card">
        <div className="settings-row" role="button" tabIndex={0} onClick={toggleTheme} onKeyDown={handleKeyDown(toggleTheme)} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          <div className="settings-row-left">
            <div className="settings-row-icon" aria-hidden="true">
              {theme === 'dark' ? <Moon size={16} strokeWidth={1.75} /> : <Sun size={16} strokeWidth={1.75} />}
            </div>
            <div className="settings-row-content">
              <div className="settings-row-label">Theme</div>
              <div className="settings-row-value">{theme === 'dark' ? 'Dark' : 'Light'}</div>
            </div>
          </div>
          <span className="settings-row-arrow" aria-hidden="true">
            {theme === 'dark' ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
          </span>
        </div>
      </div>
    </div>
  )
}
