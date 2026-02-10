import { useEffect } from 'react'
import { AlertCircle, Search } from 'lucide-react'
import { ActivityTab, OrdinalsTab, LocksTab, TokensTab, SearchTab } from './components/tabs'
import type { Ordinal, LockedUTXO } from './services/wallet'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { FEATURES } from './config'

/**
 * Fallback UI for tab errors - shows a compact error message that fits the tab area
 */
function TabErrorFallback({ tabName, error, reset }: { tabName: string; error: Error; reset: () => void }) {
  return (
    <div className="tab-error-fallback" role="alert">
      <div className="tab-error-content">
        <AlertCircle size={32} strokeWidth={2} />
        <h3>Error loading {tabName}</h3>
        <p className="tab-error-message">{error.message}</p>
        <button type="button" className="tab-error-retry" onClick={reset}>
          Try Again
        </button>
      </div>
    </div>
  )
}

export type Tab = 'activity' | 'ordinals' | 'tokens' | 'locks' | 'search'

interface TabButtonProps {
  id: Tab
  label: string
  count?: number
  activeTab: Tab
  onSelect: (tab: Tab) => void
}

function TabButton({ id, label, count, activeTab, onSelect }: TabButtonProps) {
  const isActive = activeTab === id

  return (
    <button
      id={`tab-${id}`}
      className={`nav-tab ${isActive ? 'active' : ''}`}
      onClick={() => onSelect(id)}
      role="tab"
      aria-selected={isActive}
      aria-controls={`tabpanel-${id}`}
      tabIndex={isActive ? 0 : -1}
    >
      {label}
      {count !== undefined && (
        <span className="tab-count" aria-label={`${count} ${label.toLowerCase()}`}>
          {count}
        </span>
      )}
    </button>
  )
}

interface AppTabsProps {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  counts: {
    activity: number
    ordinals: number
    tokens: number
    locks: number
  }
}

/**
 * Tab navigation bar for the wallet sections.
 */
export function AppTabNav({ activeTab, onTabChange, counts }: AppTabsProps) {
  return (
    <nav className="nav-tabs" role="tablist" aria-label="Wallet sections">
      <TabButton
        id="activity"
        label="Activity"
        count={counts.activity}
        activeTab={activeTab}
        onSelect={onTabChange}
      />
      <TabButton
        id="ordinals"
        label="Ordinals"
        count={counts.ordinals}
        activeTab={activeTab}
        onSelect={onTabChange}
      />
      <TabButton
        id="tokens"
        label="Tokens"
        count={counts.tokens}
        activeTab={activeTab}
        onSelect={onTabChange}
      />
      {FEATURES.LOCKS && (
        <TabButton
          id="locks"
          label="Locks"
          count={counts.locks}
          activeTab={activeTab}
          onSelect={onTabChange}
        />
      )}
      <button
        id="tab-search"
        className={`nav-tab ${activeTab === 'search' ? 'active' : ''}`}
        onClick={() => onTabChange('search')}
        role="tab"
        aria-selected={activeTab === 'search'}
        aria-controls="tabpanel-search"
        aria-label="Search"
        tabIndex={activeTab === 'search' ? 0 : -1}
      >
        <Search size={18} strokeWidth={2} />
      </button>
    </nav>
  )
}

interface AppTabContentProps {
  activeTab: Tab
  onSelectOrdinal: (ordinal: Ordinal) => void
  onTransferOrdinal: (ordinal: Ordinal) => void
  onRefreshTokens: () => Promise<void>
  onLock: () => void
  onUnlock: (lock: LockedUTXO) => void
  onUnlockAll: () => void
  unlocking: string | null
}

/**
 * Tab content panel that renders the active tab's content.
 */
export function AppTabContent({
  activeTab,
  onSelectOrdinal,
  onTransferOrdinal,
  onRefreshTokens,
  onLock,
  onUnlock,
  onUnlockAll,
  unlocking
}: AppTabContentProps) {
  // Scroll to top when switching tabs
  useEffect(() => {
    const mainContent = document.getElementById('main-content')
    if (mainContent) {
      mainContent.scrollTop = 0
    }
    window.scrollTo(0, 0)
  }, [activeTab])

  return (
    <main
      id="main-content"
      className="content"
      role="tabpanel"
      aria-labelledby={`tab-${activeTab}`}
      tabIndex={-1}
    >
      {activeTab === 'activity' && (
        <ErrorBoundary
          context="ActivityTab"
          fallback={(error, reset) => (
            <TabErrorFallback tabName="Activity" error={error} reset={reset} />
          )}
        >
          <ActivityTab />
        </ErrorBoundary>
      )}
      {activeTab === 'ordinals' && (
        <ErrorBoundary
          context="OrdinalsTab"
          fallback={(error, reset) => (
            <TabErrorFallback tabName="Ordinals" error={error} reset={reset} />
          )}
        >
          <OrdinalsTab
            onSelectOrdinal={onSelectOrdinal}
            onTransferOrdinal={onTransferOrdinal}
          />
        </ErrorBoundary>
      )}
      {activeTab === 'tokens' && (
        <ErrorBoundary
          context="TokensTab"
          fallback={(error, reset) => (
            <TabErrorFallback tabName="Tokens" error={error} reset={reset} />
          )}
        >
          <TokensTab onRefresh={onRefreshTokens} />
        </ErrorBoundary>
      )}
      {FEATURES.LOCKS && activeTab === 'locks' && (
        <ErrorBoundary
          context="LocksTab"
          fallback={(error, reset) => (
            <TabErrorFallback tabName="Locks" error={error} reset={reset} />
          )}
        >
          <LocksTab
            onLock={onLock}
            onUnlock={onUnlock}
            onUnlockAll={onUnlockAll}
            unlocking={unlocking}
          />
        </ErrorBoundary>
      )}
      {activeTab === 'search' && (
        <ErrorBoundary
          context="SearchTab"
          fallback={(error, reset) => (
            <TabErrorFallback tabName="Search" error={error} reset={reset} />
          )}
        >
          <SearchTab />
        </ErrorBoundary>
      )}
    </main>
  )
}
