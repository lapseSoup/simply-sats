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
import { OrdinalSelectionProvider } from './contexts/OrdinalSelectionContext'
import { WalletSetupProvider } from './contexts/WalletSetupContext'
import { LockWorkflowProvider } from './contexts/LockWorkflowContext'
import { ScreenReaderAnnounceProvider, ErrorBoundary } from './components/shared'
import { PlatformProvider } from './platform/PlatformProvider'

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
 * PlatformProvider MUST be outermost — all other providers may use the platform adapter.
 *
 * Each provider is wrapped in its own ErrorBoundary so a crash in one provider
 * doesn't bring down the entire application. Inner providers show targeted
 * fallbacks; the outermost boundary is a last-resort catch-all.
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ErrorBoundary context="AppProviders">
      <PlatformProvider>
      <ScreenReaderAnnounceProvider>
        <ErrorBoundary context="NetworkProvider">
          <NetworkProvider>
            <ErrorBoundary context="UIProvider">
              <UIProvider>
                <ErrorBoundary context="ConnectedAppsProvider">
                  <ConnectedAppsProvider>
                    <ErrorBoundary context="AccountsProvider">
                      <AccountsProvider>
                        <ErrorBoundary context="TokensProvider">
                          <TokensProvider>
                            <ErrorBoundary context="SyncProvider">
                              <SyncProvider>
                                <ErrorBoundary context="LocksProvider">
                                  <LocksProvider>
                                    <OrdinalSelectionProvider>
                                    <WalletSetupProvider>
                                    <LockWorkflowProvider>
                                      <ErrorBoundary context="ModalProvider">
                                        <ModalProvider>
                                          <ErrorBoundary context="WalletProvider">
                                            <WalletProvider>
                                              {children}
                                            </WalletProvider>
                                          </ErrorBoundary>
                                        </ModalProvider>
                                      </ErrorBoundary>
                                    </LockWorkflowProvider>
                                    </WalletSetupProvider>
                                    </OrdinalSelectionProvider>
                                  </LocksProvider>
                                </ErrorBoundary>
                              </SyncProvider>
                            </ErrorBoundary>
                          </TokensProvider>
                        </ErrorBoundary>
                      </AccountsProvider>
                    </ErrorBoundary>
                  </ConnectedAppsProvider>
                </ErrorBoundary>
              </UIProvider>
            </ErrorBoundary>
          </NetworkProvider>
        </ErrorBoundary>
      </ScreenReaderAnnounceProvider>
      </PlatformProvider>
    </ErrorBoundary>
  )
}
