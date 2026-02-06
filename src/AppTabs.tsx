import { AlertCircle } from 'lucide-react'
import { ActivityTab, OrdinalsTab, LocksTab, TokensTab, UTXOsTab } from './components/tabs'
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

export type Tab = 'activity' | 'ordinals' | 'tokens' | 'locks' | 'utxos'

interface TabButtonProps {
  id: Tab
  label: string
  count: number
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
      <span className="tab-count" aria-label={`${count} ${label.toLowerCase()}`}>
        {count}
      </span>
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
    utxos: number
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
      <TabButton
        id="utxos"
        label="UTXOs"
        count={counts.utxos}
        activeTab={activeTab}
        onSelect={onTabChange}
      />
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
      {activeTab === 'utxos' && (
        <ErrorBoundary
          context="UTXOsTab"
          fallback={(error, reset) => (
            <TabErrorFallback tabName="UTXOs" error={error} reset={reset} />
          )}
        >
          <UTXOsTab />
        </ErrorBoundary>
      )}
    </main>
  )
}
