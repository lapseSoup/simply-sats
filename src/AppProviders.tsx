import type { ReactNode } from 'react'
import {
  WalletProvider,
  NetworkProvider,
  UIProvider,
  AccountsProvider,
  TokensProvider
} from './contexts'
import { ScreenReaderAnnounceProvider } from './components/shared'

interface AppProvidersProps {
  children: ReactNode
}

/**
 * Wraps the application with all required context providers.
 * Provider order matters - outer providers are available to inner ones.
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ScreenReaderAnnounceProvider>
      <NetworkProvider>
        <UIProvider>
          <AccountsProvider>
            <TokensProvider>
              <WalletProvider>
                {children}
              </WalletProvider>
            </TokensProvider>
          </AccountsProvider>
        </UIProvider>
      </NetworkProvider>
    </ScreenReaderAnnounceProvider>
  )
}
