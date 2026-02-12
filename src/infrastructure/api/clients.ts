/**
 * Pre-configured HTTP Client Instances
 *
 * Provides singleton HTTP clients for each external API with
 * appropriate retry, timeout, and logging settings.
 * Service files should import these clients instead of using raw fetch().
 */
import { createApiClient, type HttpClient } from './httpClient'

/** GorillaPool ordinals and token indexer API */
export const gpOrdinalsApi: HttpClient = createApiClient('https://ordinals.gorillapool.io', {
  timeout: 30000,
  maxRetries: 2,
  retryDelayMs: 300
})

/** GorillaPool ARC transaction broadcaster (no retry — cascade handles fallback) */
export const gpArcApi: HttpClient = createApiClient('https://arc.gorillapool.io', {
  timeout: 30000,
  maxRetries: 1
})

/** GorillaPool mAPI (fee quotes and transaction submission) */
export const gpMapiApi: HttpClient = createApiClient('https://mapi.gorillapool.io', {
  timeout: 10000,
  maxRetries: 2,
  retryDelayMs: 200
})
