import type { ReactNode } from 'react'
import {
  WalletProvider,
  NetworkProvider,
  UIProvider,
  AccountsProvider,
  TokensProvider,
  SyncProvider,
  LocksProvider,
  ConnectedAppsProvider,
  ModalProvider
} from './contexts'
import { ScreenReaderAnnounceProvider, ErrorBoundary } from './components/shared'

interface AppProvidersProps {
  children: ReactNode
}

/**
 * Wraps the application with all required context providers.
 * Provider order matters - outer providers are available to inner ones.
 *
 * Order rationale:
 * - NetworkProvider: Global block height and USD price, needed by all
 * - UIProvider: Toast notifications and formatters (REQUIRES NetworkProvider for USD price)
 * - ConnectedAppsProvider: Trusted origins for BRC-100
 * - AccountsProvider: Account switching affects sync scope
 * - TokensProvider: Independent token state
 * - SyncProvider: Sync state (utxos, ordinals, txHistory, balances)
 * - LocksProvider: Lock state (depends on NetworkProvider for block height)
 * - ModalProvider: Modal open/close state
 * - WalletProvider: Core wallet, aggregates all contexts for backward compatibility
 *
 * WARNING: Do not reorder NetworkProvider and UIProvider — UIProvider depends on NetworkProvider.
 *
 * Each provider is wrapped in its own ErrorBoundary so a crash in one provider
 * doesn't bring down the entire application. Inner providers show targeted
 * fallbacks; the outermost boundary is a last-resort catch-all.
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ErrorBoundary context="AppProviders">
      <ScreenReaderAnnounceProvider>
        <ErrorBoundary context="NetworkProvider">
          <NetworkProvider>
            <ErrorBoundary context="UIProvider">
              <UIProvider>
                <ErrorBoundary context="ConnectedAppsProvider">
                  <ConnectedAppsProvider>
                    <ErrorBoundary context="AccountsProvider">
                      <AccountsProvider>
                        <TokensProvider>
                          <ErrorBoundary context="SyncProvider">
                            <SyncProvider>
                              <ErrorBoundary context="LocksProvider">
                                <LocksProvider>
                                  <ModalProvider>
                                    <ErrorBoundary context="WalletProvider">
                                      <WalletProvider>
                                        {children}
                                      </WalletProvider>
                                    </ErrorBoundary>
                                  </ModalProvider>
                                </LocksProvider>
                              </ErrorBoundary>
                            </SyncProvider>
                          </ErrorBoundary>
                        </TokensProvider>
                      </AccountsProvider>
                    </ErrorBoundary>
                  </ConnectedAppsProvider>
                </ErrorBoundary>
              </UIProvider>
            </ErrorBoundary>
          </NetworkProvider>
        </ErrorBoundary>
      </ScreenReaderAnnounceProvider>
    </ErrorBoundary>
  )
}
