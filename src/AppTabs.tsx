import { ActivityTab, OrdinalsTab, LocksTab, TokensTab } from './components/tabs'
import type { Ordinal, LockedUTXO } from './services/wallet'

export type Tab = 'activity' | 'ordinals' | 'tokens' | 'locks'

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
      <TabButton
        id="locks"
        label="Locks"
        count={counts.locks}
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
      {activeTab === 'activity' && <ActivityTab />}
      {activeTab === 'ordinals' && (
        <OrdinalsTab
          onSelectOrdinal={onSelectOrdinal}
          onTransferOrdinal={onTransferOrdinal}
        />
      )}
      {activeTab === 'tokens' && <TokensTab onRefresh={onRefreshTokens} />}
      {activeTab === 'locks' && (
        <LocksTab
          onLock={onLock}
          onUnlock={onUnlock}
          onUnlockAll={onUnlockAll}
          unlocking={unlocking}
        />
      )}
    </main>
  )
}
