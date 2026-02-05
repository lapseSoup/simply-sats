/**
 * Logger utility for Simply Sats
 *
 * In development mode: All logs are shown
 * In production mode: Only errors are shown
 */

const isDev = import.meta.env.DEV

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LoggerOptions {
  prefix?: string
}

function formatMessage(prefix: string | undefined, args: unknown[]): unknown[] {
  if (prefix) {
    return [`[${prefix}]`, ...args]
  }
  return args
}

/**
 * Create a logger with optional prefix
 */
export function createLogger(options: LoggerOptions = {}) {
  const { prefix } = options

  return {
    debug: (...args: unknown[]) => {
      if (isDev) {
        console.debug(...formatMessage(prefix, args))
      }
    },

    log: (...args: unknown[]) => {
      if (isDev) {
        console.log(...formatMessage(prefix, args))
      }
    },

    info: (...args: unknown[]) => {
      if (isDev) {
        console.info(...formatMessage(prefix, args))
      }
    },

    warn: (...args: unknown[]) => {
      if (isDev) {
        console.warn(...formatMessage(prefix, args))
      }
    },

    error: (...args: unknown[]) => {
      // Always log errors, even in production
      console.error(...formatMessage(prefix, args))
    }
  }
}

/**
 * Default logger instance
 */
export const logger = createLogger()

/**
 * Convenience function for one-off logs with prefix
 */
export function log(prefix: string, ...args: unknown[]) {
  if (isDev) {
    console.log(`[${prefix}]`, ...args)
  }
}

export function logWarn(prefix: string, ...args: unknown[]) {
  if (isDev) {
    console.warn(`[${prefix}]`, ...args)
  }
}

export function logError(prefix: string, ...args: unknown[]) {
  // Always log errors
  console.error(`[${prefix}]`, ...args)
}
