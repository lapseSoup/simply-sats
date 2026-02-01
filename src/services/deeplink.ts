import { onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { handleBRC100Request, generateRequestId, type BRC100Request } from './brc100'
import type { WalletKeys } from './wallet'

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
          origin: params.origin || params.app || 'Unknown App'
        }

      case 'sign':
        return {
          id: generateRequestId(),
          type: 'createSignature',
          params: {
            data: params.data ? JSON.parse(params.data) : [],
            protocolID: params.protocol ? [1, params.protocol] : [1, 'unknown'],
            keyID: params.keyId || 'default'
          },
          origin: params.origin || params.app || 'Unknown App'
        }

      case 'action':
      case 'tx':
        return {
          id: generateRequestId(),
          type: 'createAction',
          params: {
            description: params.description || 'Transaction',
            outputs: params.outputs ? JSON.parse(params.outputs) : []
          },
          origin: params.origin || params.app || 'Unknown App'
        }

      case 'auth':
        return {
          id: generateRequestId(),
          type: 'isAuthenticated',
          origin: params.origin || params.app || 'Unknown App'
        }

      default:
        console.warn('Unknown deep link action:', action)
        return null
    }
  } catch (error) {
    console.error('Failed to parse deep link:', error)
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
        console.log('Received deep link:', url)
        const request = parseDeepLink(url)
        if (request) {
          onRequest(request)
        }
      }
    })

    console.log('Deep link listener registered')
    return unlisten
  } catch (error) {
    console.error('Failed to set up deep link listener:', error)
    return () => {}
  }
}

// Handle a deep link with the wallet (auto-respond for some requests)
export async function handleDeepLink(
  url: string,
  wallet: WalletKeys,
  autoApprove: boolean = false
): Promise<any> {
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
