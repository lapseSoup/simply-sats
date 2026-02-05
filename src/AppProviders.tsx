import type { ReactNode } from 'react'
import {
  WalletProvider,
  NetworkProvider,
  UIProvider,
  AccountsProvider,
  TokensProvider,
  SyncProvider,
  LocksProvider
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
 * - NetworkProvider: Global block height, needed by all
 * - UIProvider: Toast notifications
 * - AccountsProvider: Account switching affects sync scope
 * - TokensProvider: Independent token state
 * - SyncProvider: Sync state (utxos, ordinals, txHistory, balances)
 * - LocksProvider: Lock state (depends on NetworkProvider for block height)
 * - WalletProvider: Core wallet, aggregates all contexts for backward compatibility
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ScreenReaderAnnounceProvider>
      <NetworkProvider>
        <UIProvider>
          <AccountsProvider>
            <TokensProvider>
              <SyncProvider>
                <LocksProvider>
                  <WalletProvider>
                    {children}
                  </WalletProvider>
                </LocksProvider>
              </SyncProvider>
            </TokensProvider>
          </AccountsProvider>
        </UIProvider>
      </NetworkProvider>
    </ScreenReaderAnnounceProvider>
  )
}
