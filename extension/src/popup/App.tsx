/**
 * Simply Sats Chrome Extension — Popup App Shell
 *
 * Wraps the shared wallet UI with extension-specific lifecycle management
 * (hydrate from service worker, auto-lock sync).
 */

import { useEffect } from 'react'
import { AppProviders } from '../../../src/AppProviders'
import { ErrorBoundary } from '../../../src/components/shared'
import { WalletApp } from '../../../src/App'

/**
 * Syncs state with the background service worker on popup open.
 */
function useServiceWorkerSync() {
  useEffect(() => {
    // Notify service worker that popup is open
    chrome.runtime?.sendMessage?.({ type: 'PING' }).catch(() => {
      // Service worker not ready yet — that's OK
    })

    // Reset auto-lock timer on user interaction
    const resetTimer = () => {
      chrome.runtime?.sendMessage?.({ type: 'RESET_AUTO_LOCK' }).catch(() => {})
    }

    window.addEventListener('click', resetTimer)
    window.addEventListener('keydown', resetTimer)

    return () => {
      window.removeEventListener('click', resetTimer)
      window.removeEventListener('keydown', resetTimer)
    }
  }, [])
}

/**
 * Extension popup root component.
 *
 * Uses AppProviders (which already includes PlatformProvider) to wrap
 * the shared WalletApp component. The Chrome platform adapter is
 * auto-detected by PlatformProvider.
 */
export function PopupApp() {
  useServiceWorkerSync()

  return (
    <ErrorBoundary
      context="ExtensionPopup"
      fallback={(error, reset) => (
        <div className="extension-error" role="alert">
          <h2>Simply Sats encountered an error</h2>
          <p>{error.message}</p>
          <button type="button" onClick={reset}>Try Again</button>
        </div>
      )}
    >
      <AppProviders>
        <WalletApp />
      </AppProviders>
    </ErrorBoundary>
  )
}
