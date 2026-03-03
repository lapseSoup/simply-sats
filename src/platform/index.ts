/**
 * Platform Detection and Adapter Initialization
 *
 * Detects the current runtime environment and creates the appropriate
 * PlatformAdapter singleton. Import `getPlatform()` to get the adapter.
 *
 * @module platform/index
 */

import type { PlatformAdapter, PlatformType } from './types'

export type { PlatformAdapter, PlatformType } from './types'
export type {
  DerivedKeyResult,
  DerivedAddressResult,
  DerivationTag,
  TaggedKeyResult,
  BuildP2PKHTxParams,
  BuildMultiKeyP2PKHTxParams,
  BuildConsolidationTxParams,
  BuildMultiOutputP2PKHTxParams,
  BuiltTransaction,
  BuiltConsolidationTransaction,
  BuiltMultiOutputTransaction,
  RateLimitCheckResult,
  FailedUnlockResult,
  EncryptedData,
  PublicWalletKeys,
  RecipientOutput,
} from './types'

/**
 * Detect the current platform.
 */
export function detectPlatform(): PlatformType {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return 'tauri'
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof globalThis !== 'undefined' && (globalThis as any).chrome?.runtime?.id) {
    return 'chrome-extension'
  }
  return 'browser'
}

/** Lazily-initialized singleton adapter */
let _adapter: PlatformAdapter | null = null

/**
 * Get the platform adapter singleton.
 *
 * Lazily initializes the correct adapter based on the detected platform.
 * The adapter is cached for the lifetime of the application.
 */
export async function getPlatform(): Promise<PlatformAdapter> {
  if (_adapter) return _adapter

  const platform = detectPlatform()

  switch (platform) {
    case 'tauri': {
      const { TauriAdapter } = await import('./tauri')
      _adapter = new TauriAdapter()
      break
    }
    case 'chrome-extension': {
      const { ChromeAdapter } = await import('./chrome')
      _adapter = new ChromeAdapter()
      break
    }
    default:
      throw new Error(`No platform adapter available for environment: ${platform}`)
  }

  return _adapter
}

/**
 * Get the platform adapter synchronously.
 * Only use after getPlatform() has been called at least once.
 * Throws if the adapter hasn't been initialized yet.
 */
export function getPlatformSync(): PlatformAdapter {
  if (!_adapter) {
    throw new Error('Platform adapter not initialized. Call getPlatform() first.')
  }
  return _adapter
}

/**
 * Set a custom platform adapter (useful for testing).
 */
export function setPlatformAdapter(adapter: PlatformAdapter): void {
  _adapter = adapter
}
