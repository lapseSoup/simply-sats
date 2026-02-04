/**
 * LocalStorage Abstraction Layer
 *
 * Provides type-safe access to localStorage with proper error handling,
 * default values, and validation. This centralizes all localStorage access
 * to prevent scattered direct calls throughout the codebase.
 */

// ============================================
// Storage Keys
// ============================================

export const STORAGE_KEYS = {
  // Balance caching
  CACHED_BALANCE: 'simply_sats_cached_balance',
  CACHED_ORD_BALANCE: 'simply_sats_cached_ord_balance',

  // User preferences
  AUTO_LOCK_MINUTES: 'simply_sats_auto_lock_minutes',
  DISPLAY_SATS: 'simply_sats_display_sats',
  FEE_RATE: 'simply_sats_fee_rate',

  // Security
  TRUSTED_ORIGINS: 'simply_sats_trusted_origins',

  // Wallet storage (encrypted)
  WALLET: 'simply_sats_wallet',

  // Sync state
  LAST_SYNC: 'simply_sats_last_sync',

  // UI state
  ACTIVE_TAB: 'simply_sats_active_tab',
  SIDEBAR_COLLAPSED: 'simply_sats_sidebar_collapsed'
} as const

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS]

// ============================================
// Utility Functions
// ============================================

/**
 * Safely parse an integer from storage with a default fallback
 */
function safeParseInt(value: string | null, defaultValue: number): number {
  if (value === null) return defaultValue
  const parsed = parseInt(value, 10)
  return isNaN(parsed) ? defaultValue : parsed
}

/**
 * Safely parse a float from storage with a default fallback
 */
function safeParseFloat(value: string | null, defaultValue: number): number {
  if (value === null) return defaultValue
  const parsed = parseFloat(value)
  return isNaN(parsed) ? defaultValue : parsed
}

/**
 * Safely parse JSON from storage with a default fallback
 */
function safeParseJSON<T>(value: string | null, defaultValue: T): T {
  if (value === null) return defaultValue
  try {
    return JSON.parse(value) as T
  } catch {
    return defaultValue
  }
}

/**
 * Safely parse a boolean from storage
 */
function safeParseBoolean(value: string | null, defaultValue: boolean): boolean {
  if (value === null) return defaultValue
  return value === 'true'
}

// ============================================
// Storage Interface
// ============================================

/**
 * Type-safe localStorage abstraction
 *
 * Usage:
 *   const balance = storage.balance.get()
 *   storage.balance.set(1000)
 *   storage.trustedOrigins.add('https://example.com')
 */
export const storage = {
  // ==========================================
  // Balance
  // ==========================================
  balance: {
    get(): number {
      return safeParseInt(localStorage.getItem(STORAGE_KEYS.CACHED_BALANCE), 0)
    },
    set(value: number): void {
      localStorage.setItem(STORAGE_KEYS.CACHED_BALANCE, String(value))
    },
    clear(): void {
      localStorage.removeItem(STORAGE_KEYS.CACHED_BALANCE)
    }
  },

  ordBalance: {
    get(): number {
      return safeParseInt(localStorage.getItem(STORAGE_KEYS.CACHED_ORD_BALANCE), 0)
    },
    set(value: number): void {
      localStorage.setItem(STORAGE_KEYS.CACHED_ORD_BALANCE, String(value))
    },
    clear(): void {
      localStorage.removeItem(STORAGE_KEYS.CACHED_ORD_BALANCE)
    }
  },

  // ==========================================
  // User Preferences
  // ==========================================
  autoLockMinutes: {
    get(): number {
      return safeParseInt(localStorage.getItem(STORAGE_KEYS.AUTO_LOCK_MINUTES), 10)
    },
    set(value: number): void {
      localStorage.setItem(STORAGE_KEYS.AUTO_LOCK_MINUTES, String(value))
    },
    clear(): void {
      localStorage.removeItem(STORAGE_KEYS.AUTO_LOCK_MINUTES)
    }
  },

  displayInSats: {
    get(): boolean {
      return safeParseBoolean(localStorage.getItem(STORAGE_KEYS.DISPLAY_SATS), false)
    },
    set(value: boolean): void {
      localStorage.setItem(STORAGE_KEYS.DISPLAY_SATS, String(value))
    },
    clear(): void {
      localStorage.removeItem(STORAGE_KEYS.DISPLAY_SATS)
    }
  },

  feeRate: {
    get(): number | null {
      const stored = localStorage.getItem(STORAGE_KEYS.FEE_RATE)
      if (stored === null) return null
      const rate = safeParseFloat(stored, -1)
      return rate > 0 ? rate : null
    },
    set(value: number): void {
      localStorage.setItem(STORAGE_KEYS.FEE_RATE, String(value))
    },
    clear(): void {
      localStorage.removeItem(STORAGE_KEYS.FEE_RATE)
    }
  },

  // ==========================================
  // Security
  // ==========================================
  trustedOrigins: {
    get(): string[] {
      return safeParseJSON<string[]>(localStorage.getItem(STORAGE_KEYS.TRUSTED_ORIGINS), [])
    },
    set(origins: string[]): void {
      localStorage.setItem(STORAGE_KEYS.TRUSTED_ORIGINS, JSON.stringify(origins))
    },
    add(origin: string): void {
      const origins = this.get()
      if (!origins.includes(origin)) {
        origins.push(origin)
        this.set(origins)
      }
    },
    remove(origin: string): void {
      const origins = this.get()
      const filtered = origins.filter(o => o !== origin)
      this.set(filtered)
    },
    has(origin: string): boolean {
      return this.get().includes(origin)
    },
    clear(): void {
      localStorage.removeItem(STORAGE_KEYS.TRUSTED_ORIGINS)
    }
  },

  // ==========================================
  // Wallet Storage (encrypted data)
  // ==========================================
  wallet: {
    get(): string | null {
      return localStorage.getItem(STORAGE_KEYS.WALLET)
    },
    set(data: string): void {
      localStorage.setItem(STORAGE_KEYS.WALLET, data)
    },
    clear(): void {
      localStorage.removeItem(STORAGE_KEYS.WALLET)
    },
    exists(): boolean {
      return localStorage.getItem(STORAGE_KEYS.WALLET) !== null
    }
  },

  // ==========================================
  // Sync State
  // ==========================================
  lastSync: {
    get(): number | null {
      const value = localStorage.getItem(STORAGE_KEYS.LAST_SYNC)
      return value ? safeParseInt(value, 0) : null
    },
    set(timestamp: number): void {
      localStorage.setItem(STORAGE_KEYS.LAST_SYNC, String(timestamp))
    },
    clear(): void {
      localStorage.removeItem(STORAGE_KEYS.LAST_SYNC)
    }
  },

  // ==========================================
  // UI State
  // ==========================================
  activeTab: {
    get(): string {
      return localStorage.getItem(STORAGE_KEYS.ACTIVE_TAB) || 'activity'
    },
    set(tab: string): void {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, tab)
    }
  },

  sidebarCollapsed: {
    get(): boolean {
      return safeParseBoolean(localStorage.getItem(STORAGE_KEYS.SIDEBAR_COLLAPSED), false)
    },
    set(collapsed: boolean): void {
      localStorage.setItem(STORAGE_KEYS.SIDEBAR_COLLAPSED, String(collapsed))
    }
  },

  // ==========================================
  // Utility Methods
  // ==========================================

  /**
   * Clear all Simply Sats storage
   */
  clearAll(): void {
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key)
    })
  },

  /**
   * Clear only cached/temporary data (keep wallet and settings)
   */
  clearCache(): void {
    this.balance.clear()
    this.ordBalance.clear()
    this.lastSync.clear()
  }
}

// Default export for convenience
export default storage
