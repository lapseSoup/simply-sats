import { onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { handleBRC100Request, generateRequestId, type BRC100Request, type BRC100Response } from './brc100'
import type { WalletKeys } from './wallet'
import { logger } from './logger'

/**
 * Safely parse JSON from untrusted deep link parameters
 * Returns undefined if parsing fails instead of throwing
 */
function safeJsonParse<T>(value: string | undefined): T | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    // Basic validation - ensure we got an expected type
    if (parsed === null || (typeof parsed !== 'object' && !Array.isArray(parsed))) {
      logger.warn('Deep link JSON parsed to unexpected type:', { type: typeof parsed })
      return undefined
    }
    return parsed as T
  } catch (error) {
    logger.warn('Failed to parse deep link JSON parameter', undefined, error instanceof Error ? error : undefined)
    return undefined
  }
}

/**
 * Sanitize an origin string from deep link parameters.
 * Prevents overly long or control-character-laden origin strings from
 * being displayed in the BRC-100 approval UI.
 */
function sanitizeOrigin(raw: string): string {
  // Strip control characters (U+0000–U+001F, U+007F–U+009F)
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\x00-\x1f\x7f-\x9f]/g, '')
  // Limit length to prevent UI overflow
  if (cleaned.length > 100) {
    return cleaned.slice(0, 100) + '…'
  }
  return cleaned || 'Unknown App'
}

// Parse a deep link URL and convert to BRC-100 request
export function parseDeepLink(url: string): BRC100Request | null {
  try {
    const parsed = new URL(url)

    // Handle simplysats:// protocol
    if (parsed.protocol !== 'simplysats:') {
      return null
    }

    const action = parsed.hostname || parsed.pathname.replace(/^\//, '')
    const params = Object.fromEntries(parsed.searchParams)

    switch (action) {
      case 'connect':
        return {
          id: generateRequestId(),
          type: 'getPublicKey',
          params: { identityKey: true },
          origin: sanitizeOrigin(params.origin || params.app || 'Unknown App')
        }

      case 'sign':
        return {
          id: generateRequestId(),
          type: 'createSignature',
          params: {
            data: safeJsonParse<number[]>(params.data) ?? [],
            protocolID: params.protocol ? [1, params.protocol] : [1, 'unknown'],
            keyID: params.keyId || 'default'
          },
          origin: sanitizeOrigin(params.origin || params.app || 'Unknown App')
        }

      case 'action':
      case 'tx':
        return {
          id: generateRequestId(),
          type: 'createAction',
          params: {
            description: params.description || 'Transaction',
            outputs: safeJsonParse<unknown[]>(params.outputs) ?? []
          },
          origin: sanitizeOrigin(params.origin || params.app || 'Unknown App')
        }

      case 'auth':
        return {
          id: generateRequestId(),
          type: 'isAuthenticated',
          origin: sanitizeOrigin(params.origin || params.app || 'Unknown App')
        }

      default:
        logger.warn('Unknown deep link action:', { action })
        return null
    }
  } catch (error) {
    logger.error('Failed to parse deep link', error)
    return null
  }
}

// Set up deep link listener
export async function setupDeepLinkListener(
  onRequest: (request: BRC100Request) => void
): Promise<() => void> {
  try {
    const unlisten = await onOpenUrl((urls: string[]) => {
      for (const url of urls) {
        logger.info('Received deep link', { url })
        const request = parseDeepLink(url)
        if (request) {
          onRequest(request)
        }
      }
    })

    logger.info('Deep link listener registered')
    return unlisten
  } catch (error) {
    logger.error('Failed to set up deep link listener', error)
    return () => {}
  }
}

// Handle a deep link with the wallet (auto-respond for some requests)
export async function handleDeepLink(
  url: string,
  wallet: WalletKeys,
  autoApprove: boolean = false
): Promise<BRC100Response> {
  const request = parseDeepLink(url)
  if (!request) {
    throw new Error('Invalid deep link')
  }

  return handleBRC100Request(request, wallet, autoApprove)
}

// Generate a connection URL that apps can use to connect
export function generateConnectUrl(identityPubKey: string): string {
  return `simplysats://connected?pubkey=${encodeURIComponent(identityPubKey)}`
}
