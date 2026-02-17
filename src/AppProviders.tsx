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
import { ScreenReaderAnnounceProvider } from './components/shared'

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
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ScreenReaderAnnounceProvider>
      <NetworkProvider>
        <UIProvider>
          <ConnectedAppsProvider>
            <AccountsProvider>
              <TokensProvider>
                <SyncProvider>
                  <LocksProvider>
                    <ModalProvider>
                      <WalletProvider>
                        {children}
                      </WalletProvider>
                    </ModalProvider>
                  </LocksProvider>
                </SyncProvider>
              </TokensProvider>
            </AccountsProvider>
          </ConnectedAppsProvider>
        </UIProvider>
      </NetworkProvider>
    </ScreenReaderAnnounceProvider>
  )
}
