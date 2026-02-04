/**
 * Structured Logging for Simply Sats
 *
 * Provides consistent logging with levels, timestamps, and context.
 * Can be configured to send logs to various destinations.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context?: Record<string, unknown>
  error?: {
    name: string
    message: string
    stack?: string
  }
}

export interface LoggerConfig {
  minLevel: LogLevel
  enableConsole: boolean
  enableStorage: boolean
  maxStoredLogs: number
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

const DEFAULT_CONFIG: LoggerConfig = {
  minLevel: 'info',
  enableConsole: true,
  enableStorage: false,
  maxStoredLogs: 1000
}

const STORAGE_KEY = 'simply_sats_logs'

class Logger {
  private config: LoggerConfig
  private logs: LogEntry[] = []

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Load existing logs from storage if enabled
    if (this.config.enableStorage) {
      this.loadFromStorage()
    }
  }

  /**
   * Configure the logger
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.minLevel]
  }

  /**
   * Format context for console output
   */
  private formatContext(context?: Record<string, unknown>): string {
    if (!context || Object.keys(context).length === 0) {
      return ''
    }
    return ' ' + JSON.stringify(context)
  }

  /**
   * Create a log entry
   */
  private createEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    }

    return entry
  }

  /**
   * Output to console
   */
  private logToConsole(entry: LogEntry): void {
    if (!this.config.enableConsole) return

    const prefix = `[${entry.timestamp.split('T')[1].slice(0, 8)}]`
    const contextStr = this.formatContext(entry.context)

    switch (entry.level) {
      case 'debug':
        console.debug(`${prefix} DEBUG: ${entry.message}${contextStr}`)
        break
      case 'info':
        console.info(`${prefix} INFO: ${entry.message}${contextStr}`)
        break
      case 'warn':
        console.warn(`${prefix} WARN: ${entry.message}${contextStr}`)
        if (entry.error) {
          console.warn(entry.error.stack || entry.error.message)
        }
        break
      case 'error':
        console.error(`${prefix} ERROR: ${entry.message}${contextStr}`)
        if (entry.error) {
          console.error(entry.error.stack || entry.error.message)
        }
        break
    }
  }

  /**
   * Store log entry
   */
  private storeEntry(entry: LogEntry): void {
    if (!this.config.enableStorage) return

    this.logs.push(entry)

    // Trim old logs if exceeding max
    if (this.logs.length > this.config.maxStoredLogs) {
      this.logs = this.logs.slice(-this.config.maxStoredLogs)
    }

    // Save to localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.logs))
    } catch (e) {
      // Storage full or unavailable - clear old logs
      this.logs = this.logs.slice(-100)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.logs))
      } catch {
        // Give up on storage
      }
    }
  }

  /**
   * Load logs from storage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        this.logs = JSON.parse(stored)
      }
    } catch {
      this.logs = []
    }
  }

  /**
   * Log a message
   */
  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): void {
    if (!this.shouldLog(level)) return

    const entry = this.createEntry(level, message, context, error)
    this.logToConsole(entry)
    this.storeEntry(entry)
  }

  /**
   * Debug level log
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context)
  }

  /**
   * Info level log
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context)
  }

  /**
   * Warning level log
   */
  warn(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log('warn', message, context, error)
  }

  /**
   * Error level log
   */
  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    const errorObj = error instanceof Error ? error : undefined
    const errorContext = error && !(error instanceof Error)
      ? { ...context, errorValue: String(error) }
      : context

    this.log('error', message, errorContext, errorObj)
  }

  /**
   * Get stored logs
   */
  getLogs(level?: LogLevel): LogEntry[] {
    if (!level) return [...this.logs]
    return this.logs.filter(log => log.level === level)
  }

  /**
   * Get recent logs
   */
  getRecentLogs(count: number = 50): LogEntry[] {
    return this.logs.slice(-count)
  }

  /**
   * Clear stored logs
   */
  clearLogs(): void {
    this.logs = []
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Export logs as JSON string
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2)
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, unknown>): ChildLogger {
    return new ChildLogger(this, context)
  }
}

/**
 * Child logger that includes parent context
 */
class ChildLogger {
  private parent: Logger
  private baseContext: Record<string, unknown>

  constructor(parent: Logger, baseContext: Record<string, unknown>) {
    this.parent = parent
    this.baseContext = baseContext
  }

  private mergeContext(context?: Record<string, unknown>): Record<string, unknown> {
    return { ...this.baseContext, ...context }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.parent.debug(message, this.mergeContext(context))
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.parent.info(message, this.mergeContext(context))
  }

  warn(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.parent.warn(message, this.mergeContext(context), error)
  }

  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    this.parent.error(message, error, this.mergeContext(context))
  }
}

// Create and export singleton instance
export const logger = new Logger({
  minLevel: import.meta.env.DEV ? 'debug' : 'info',
  enableConsole: true,
  enableStorage: false // Enable for debugging: true
})

// Export class for custom instances
export { Logger }

// Convenience exports for common logging patterns
export function logTransaction(action: string, txid: string, details?: Record<string, unknown>): void {
  logger.info(`Transaction ${action}`, { txid, ...details })
}

export function logWalletAction(action: string, details?: Record<string, unknown>): void {
  logger.info(`Wallet: ${action}`, details)
}

export function logBRC100Request(type: string, requestId: string, details?: Record<string, unknown>): void {
  logger.debug(`BRC-100 ${type}`, { requestId, ...details })
}

export function logApiCall(endpoint: string, method: string, status?: number): void {
  logger.debug(`API ${method} ${endpoint}`, status !== undefined ? { status } : undefined)
}

export function logError(context: string, error: unknown): void {
  logger.error(context, error)
}
