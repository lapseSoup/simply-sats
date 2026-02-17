# Optional Password Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the wallet password optional in all setup flows while preserving full encryption when a password is chosen.

**Architecture:** Dual-mode storage — version 0 (unprotected, plaintext in OS keychain) vs version 1 (AES-256-GCM encrypted). A `simply_sats_has_password` localStorage flag drives conditional behavior throughout the app. Session password uses `NO_PASSWORD = ''` sentinel for passwordless wallets.

**Tech Stack:** TypeScript, React 19, Tauri 2 secure storage, AES-256-GCM (existing), Vitest

**Design doc:** `docs/plans/2026-02-16-optional-password-design.md`

---

### Task 1: Storage Key & Type Foundations

**Files:**
- Modify: `src/infrastructure/storage/localStorage.ts:13-57` (add HAS_PASSWORD key)
- Modify: `src/services/wallet/types.ts:1-26` (add UnprotectedWalletData)
- Modify: `src/services/sessionPasswordStore.ts:1-37` (add NO_PASSWORD)
- Test: `src/services/wallet/storage.test.ts` (new or extend)

**Step 1: Add HAS_PASSWORD storage key**

In `src/infrastructure/storage/localStorage.ts`, add to STORAGE_KEYS object after the TRUSTED_ORIGINS entry:

```ts
  // Password protection flag
  HAS_PASSWORD: 'simply_sats_has_password',
```

And add a `hasPassword` accessor to the `storage` object in the Security section:

```ts
  hasPassword: {
    get(): boolean {
      return localStorage.getItem(STORAGE_KEYS.HAS_PASSWORD) !== 'false'
    },
    set(value: boolean): void {
      localStorage.setItem(STORAGE_KEYS.HAS_PASSWORD, String(value))
    },
    clear(): void {
      localStorage.removeItem(STORAGE_KEYS.HAS_PASSWORD)
    }
  },
```

**Step 2: Add UnprotectedWalletData type**

In `src/services/wallet/types.ts`, add after the `WalletKeys` interface (after line 26):

```ts
/**
 * Unprotected wallet data — plaintext keys stored in OS keychain.
 * Used when user opts out of password protection during setup.
 * version: 0 distinguishes this from EncryptedData (version: 1).
 */
export interface UnprotectedWalletData {
  version: 0
  mode: 'unprotected'
  keys: WalletKeys
}

/**
 * Type guard for UnprotectedWalletData
 */
export function isUnprotectedData(data: unknown): data is UnprotectedWalletData {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>
  return obj.version === 0 && obj.mode === 'unprotected' && typeof obj.keys === 'object'
}
```

**Step 3: Add NO_PASSWORD sentinel**

In `src/services/sessionPasswordStore.ts`, add after line 21 (before `let _sessionPassword`):

```ts
/**
 * Sentinel value for "wallet is unlocked but no password was set."
 * Distinct from null (locked) and any real password string.
 * Note: empty string is falsy in JS — use `=== null` to check "no session."
 */
export const NO_PASSWORD = '' as const
```

**Step 4: Write tests for type guard**

Create or extend `src/services/wallet/storage.test.ts` with:

```ts
import { isUnprotectedData } from './types'

describe('isUnprotectedData', () => {
  it('returns true for valid unprotected data', () => {
    const data = { version: 0, mode: 'unprotected', keys: { mnemonic: 'test' } }
    expect(isUnprotectedData(data)).toBe(true)
  })

  it('returns false for EncryptedData', () => {
    const data = { version: 1, ciphertext: 'x', iv: 'y', salt: 'z', iterations: 600000 }
    expect(isUnprotectedData(data)).toBe(false)
  })

  it('returns false for null', () => {
    expect(isUnprotectedData(null)).toBe(false)
  })

  it('returns false for wrong version', () => {
    const data = { version: 1, mode: 'unprotected', keys: {} }
    expect(isUnprotectedData(data)).toBe(false)
  })
})
```

**Step 5: Run tests**

Run: `npm run test:run -- --reporter=verbose src/services/wallet/storage.test.ts`
Expected: PASS

**Step 6: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/infrastructure/storage/localStorage.ts src/services/wallet/types.ts src/services/sessionPasswordStore.ts src/services/wallet/storage.test.ts
git commit -m "feat: add UnprotectedWalletData type, HAS_PASSWORD key, NO_PASSWORD sentinel"
```

---

### Task 2: Storage Layer — saveWalletUnprotected & loadWallet(null)

**Files:**
- Modify: `src/services/wallet/storage.ts:1-255`
- Test: `src/services/wallet/storage.test.ts` (extend)

**Step 1: Write failing tests for unprotected save/load**

Add to `src/services/wallet/storage.test.ts`:

```ts
import { saveWalletUnprotected, loadWallet, hasPassword, saveWallet, clearWallet } from './storage'

// Mock Tauri — these tests run in Node, not Tauri
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('Not in Tauri'))
}))

const mockKeys = {
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  walletType: 'yours' as const,
  walletWif: 'L1...',
  walletAddress: '1A...',
  walletPubKey: '02...',
  ordWif: 'L2...',
  ordAddress: '1B...',
  ordPubKey: '03...',
  identityWif: 'L3...',
  identityAddress: '1C...',
  identityPubKey: '04...'
}

describe('saveWalletUnprotected', () => {
  beforeEach(async () => {
    localStorage.clear()
    await clearWallet()
  })

  it('saves keys as version 0 unprotected format', async () => {
    await saveWalletUnprotected(mockKeys)
    expect(hasPassword()).toBe(false)
  })

  it('loadWallet(null) retrieves unprotected keys', async () => {
    await saveWalletUnprotected(mockKeys)
    const loaded = await loadWallet(null)
    expect(loaded).not.toBeNull()
    expect(loaded!.walletAddress).toBe(mockKeys.walletAddress)
  })
})

describe('hasPassword', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to true when flag is absent', () => {
    expect(hasPassword()).toBe(true)
  })

  it('returns false when flag is "false"', () => {
    localStorage.setItem('simply_sats_has_password', 'false')
    expect(hasPassword()).toBe(false)
  })

  it('returns true when flag is "true"', () => {
    localStorage.setItem('simply_sats_has_password', 'true')
    expect(hasPassword()).toBe(true)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm run test:run -- --reporter=verbose src/services/wallet/storage.test.ts`
Expected: FAIL — `saveWalletUnprotected` and `hasPassword` not exported

**Step 3: Implement saveWalletUnprotected, hasPassword, and update loadWallet**

In `src/services/wallet/storage.ts`:

Add import at top (after existing imports):
```ts
import { isUnprotectedData, type UnprotectedWalletData } from './types'
import { STORAGE_KEYS } from '../../infrastructure/storage/localStorage'
```

Note: `STORAGE_KEYS` is already imported — just use the existing import.

Add `hasPassword()` function:

```ts
/**
 * Check if wallet has password protection.
 * Reads from localStorage flag — synchronous, no async needed.
 * Defaults to true (safe for existing wallets without the flag).
 */
export function hasPassword(): boolean {
  return localStorage.getItem(STORAGE_KEYS.HAS_PASSWORD) !== 'false'
}
```

Add `saveWalletUnprotected()` function:

```ts
/**
 * Save wallet keys WITHOUT encryption — plaintext in OS keychain.
 * Used when user skips password during setup.
 */
export async function saveWalletUnprotected(keys: WalletKeys): Promise<void> {
  const data: UnprotectedWalletData = {
    version: 0,
    mode: 'unprotected',
    keys
  }

  const savedSecurely = await saveToSecureStorage(data as unknown as EncryptedData)

  if (savedSecurely) {
    localStorage.removeItem(STORAGE_KEY)
    walletLogger.info('Wallet saved to secure storage (unprotected mode)')
  } else {
    // Fallback to localStorage (web/dev build)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    walletLogger.info('Wallet saved to localStorage (unprotected mode)')
  }

  localStorage.setItem(STORAGE_KEYS.HAS_PASSWORD, 'false')
}
```

Update `saveWallet()` — add `has_password` flag at the end (after existing save logic):

```ts
  localStorage.setItem(STORAGE_KEYS.HAS_PASSWORD, 'true')
```

Update `loadWallet()` signature and implementation:

Change signature from `loadWallet(password: string)` to `loadWallet(password: string | null)`.

Add version 0 handling at the start of the function, after loading from secure storage:

```ts
  // Try secure storage first (Tauri desktop)
  const secureData = await loadFromSecureStorage()
  if (secureData) {
    // Check for unprotected format (version 0)
    if (isUnprotectedData(secureData)) {
      return secureData.keys
    }
    // Encrypted format — need password
    if (!password) {
      throw new Error('Password required for encrypted wallet')
    }
    const decrypted = await decrypt(secureData, password)
    return JSON.parse(decrypted)
  }
```

Similarly for the localStorage fallback path — after `JSON.parse(stored)`, add:

```ts
    if (isUnprotectedData(parsed)) {
      return parsed.keys
    }
```

And replace the security violation check (lines 167-172) — the plaintext keys check becomes unreachable since unprotected data is now handled above.

**Step 4: Run tests**

Run: `npm run test:run -- --reporter=verbose src/services/wallet/storage.test.ts`
Expected: PASS

**Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors (may need to fix callers of loadWallet — addressed in Task 3)

**Step 6: Commit**

```bash
git add src/services/wallet/storage.ts src/services/wallet/storage.test.ts
git commit -m "feat: add saveWalletUnprotected, hasPassword, loadWallet(null) support"
```

---

### Task 3: Account Layer — password: string | null

**Files:**
- Modify: `src/services/accounts.ts:63-119` (createAccount), `:266-308` (getAccountKeys), `:440-464` (migrateToMultiAccount)
- Test: `src/services/accounts.test.ts` (extend or create)

**Step 1: Update createAccount to accept null password**

Change signature: `password: string` → `password: string | null`

Replace lines 70-73 (password required check):
```ts
  // Password is optional — when null, keys are stored unprotected
  if (password !== null) {
    // Validate password against requirements
    const requirements = useLegacyRequirements ? LEGACY_PASSWORD_REQUIREMENTS : DEFAULT_PASSWORD_REQUIREMENTS
    const validation = validatePassword(password, requirements)
    if (!validation.isValid) {
      throw new Error(validation.errors.join('. '))
    }
  }
```

Replace lines 84-100 (encryption logic):
```ts
  const keysJson = JSON.stringify({
    mnemonic: keys.mnemonic,
    walletWif: keys.walletWif,
    walletAddress: keys.walletAddress,
    walletPubKey: keys.walletPubKey,
    ordWif: keys.ordWif,
    ordAddress: keys.ordAddress,
    ordPubKey: keys.ordPubKey,
    identityWif: keys.identityWif,
    identityAddress: keys.identityAddress,
    identityPubKey: keys.identityPubKey
  })

  let encryptedKeysStr: string
  if (password !== null) {
    const encryptedData = await encrypt(keysJson, password)
    encryptedKeysStr = JSON.stringify(encryptedData)
  } else {
    // Unprotected mode — store plaintext in structured format
    encryptedKeysStr = JSON.stringify({ version: 0, mode: 'unprotected', keys: JSON.parse(keysJson) })
  }
```

**Step 2: Update getAccountKeys to accept null password**

Change signature: `password: string` → `password: string | null`

Replace lines 270-275 (empty password rejection):
```ts
  try {
    const parsed = JSON.parse(account.encryptedKeys)

    // Check for unprotected format first
    if (parsed.version === 0 && parsed.mode === 'unprotected') {
      return parsed.keys as WalletKeys
    }

    // Encrypted format — password required
    if (!password || password.trim().length === 0) {
      accountLogger.error('Password is required to decrypt account keys')
      return null
    }

    const encryptedData = parsed as EncryptedData
    const keysJson = await decrypt(encryptedData, password)
```

Keep the PBKDF2 migration logic after decryption.

**Step 3: Update migrateToMultiAccount signature**

Change: `password: string` → `password: string | null`

Pass through to `createAccount` — the null propagates naturally.

**Step 4: Add encryptAllAccounts function**

Add at the end of `accounts.ts`:

```ts
/**
 * Retroactively encrypt all unprotected accounts with a password.
 * Called when user sets a password in Settings after initially skipping it.
 * Atomic — if any account fails, throws and makes no changes.
 */
export async function encryptAllAccounts(password: string): Promise<void> {
  if (!password || password.length < SECURITY.MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${SECURITY.MIN_PASSWORD_LENGTH} characters`)
  }

  const accounts = await getAllAccounts()
  const updates: { accountId: number; encryptedKeysStr: string }[] = []

  // Phase 1: Encrypt all unprotected accounts (no DB writes yet)
  for (const account of accounts) {
    const parsed = JSON.parse(account.encryptedKeys)
    if (parsed.version === 0 && parsed.mode === 'unprotected') {
      const keysJson = JSON.stringify(parsed.keys)
      const encryptedData = await encrypt(keysJson, password)
      updates.push({
        accountId: account.id!,
        encryptedKeysStr: JSON.stringify(encryptedData)
      })
    }
  }

  if (updates.length === 0) {
    accountLogger.info('No unprotected accounts to encrypt')
    return
  }

  // Phase 2: Write all updates atomically
  const database = getDatabase()
  await withTransaction(async () => {
    for (const { accountId, encryptedKeysStr } of updates) {
      await database.execute(
        'UPDATE accounts SET encrypted_keys = $1 WHERE id = $2',
        [encryptedKeysStr, accountId]
      )
    }
  })

  accountLogger.info('Encrypted all accounts', { count: updates.length })
}
```

**Step 5: Run typecheck to find cascading type errors**

Run: `npx tsc --noEmit`

This will reveal callers that still pass `string` where `string | null` is needed. Fix in later tasks.

**Step 6: Commit**

```bash
git add src/services/accounts.ts
git commit -m "feat: accounts layer accepts null password, add encryptAllAccounts"
```

---

### Task 4: Hook Layer — useWalletActions (create/restore/import with null password)

**Files:**
- Modify: `src/hooks/useWalletActions.ts:47-53` (signatures), `:71-92` (create), `:94-117` (restore), `:119-137` (import)

**Step 1: Update handleCreateWallet**

Change signature from `(password: string)` to `(password: string | null)`.

Replace password validation block (lines 72-75):
```ts
    if (password !== null) {
      const validation = validatePassword(password)
      if (!validation.isValid) {
        throw new Error(validation.errors[0] || `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      }
    }
```

Replace save call (line 78):
```ts
      if (password !== null) {
        await saveWallet(keys, password)
      } else {
        const { saveWalletUnprotected } = await import('../services/wallet')
        await saveWalletUnprotected(keys)
      }
```

Update session password storage (line 83):
```ts
      const sessionPwd = password ?? ''  // NO_PASSWORD sentinel
      setSessionPassword(sessionPwd)
      setModuleSessionPassword(sessionPwd)
```

**Step 2: Update handleRestoreWallet**

Same pattern — `(mnemonic: string, password: string)` → `(mnemonic: string, password: string | null)`.

Wrap password validation in `if (password !== null)`. Branch save call. Store `password ?? ''` as session password.

**Step 3: Update handleImportJSON**

Same pattern — `(json: string, password: string)` → `(json: string, password: string | null)`.

**Step 4: Update interface types**

Change `UseWalletActionsReturn` interface:
```ts
  handleCreateWallet: (password: string | null) => Promise<string | null>
  handleRestoreWallet: (mnemonic: string, password: string | null) => Promise<boolean>
  handleImportJSON: (json: string, password: string | null) => Promise<boolean>
```

**Step 5: Add saveWalletUnprotected to barrel export**

In `src/services/wallet/index.ts` (or wherever wallet exports are), add `saveWalletUnprotected` to exports.

**Step 6: Run typecheck**

Run: `npx tsc --noEmit`
Expected: May have more cascading errors from callers — note them for Task 5.

**Step 7: Commit**

```bash
git add src/hooks/useWalletActions.ts src/services/wallet/index.ts
git commit -m "feat: useWalletActions accepts null password for all operations"
```

---

### Task 5: Hook Layer — useWalletLock & useWalletInit (skip lock for passwordless)

**Files:**
- Modify: `src/hooks/useWalletLock.ts:51-225`
- Modify: `src/hooks/useWalletInit.ts:57-153`
- Modify: `src/contexts/WalletContext.tsx:207-213` (auto-lock guard)

**Step 1: Update useWalletLock**

Import `hasPassword` at top:
```ts
import { hasPassword } from '../services/wallet/storage'
```

Import `NO_PASSWORD` at top:
```ts
import { NO_PASSWORD } from '../services/sessionPasswordStore'
```

Update `lockWallet` (line 77): add early return when no password:
```ts
  const lockWallet = useCallback(async () => {
    if (!hasPassword()) {
      walletLogger.debug('lockWallet no-op: no password set')
      return
    }
    // ... existing lock logic
  }, [activeAccountId, setWalletState])
```

Update visibility-based lock effect (line 93): add `hasPassword()` guard:
```ts
  useEffect(() => {
    if (isLocked || !hasPassword()) return
    // ... rest of effect
  }, [isLocked, lockWallet])
```

Update `unlockWallet` (line 126): add unprotected path before the password-based path:
```ts
  const unlockWallet = useCallback(async (password: string): Promise<boolean> => {
    // ... existing rate limit check ...

    try {
      let account = activeAccount
      // ... existing account lookup ...

      if (!account) {
        walletLogger.error('No account found to unlock')
        return false
      }

      // Unprotected path — no PBKDF2, no rate limiting
      if (!hasPassword()) {
        const keys = await getKeysForAccount(account, null)
        if (keys) {
          setWalletState(keys)
          setWalletKeys(keys)
          setIsLocked(false)
          setSessionPassword(NO_PASSWORD)
          setModuleSessionPassword(NO_PASSWORD)
          await storeKeysInRust(keys.mnemonic, keys.accountIndex ?? 0)
          await refreshAccounts()
          walletLogger.info('Wallet unlocked (unprotected mode)')
          return true
        }
        return false
      }

      // Encrypted path — existing PBKDF2 logic...
```

**Step 2: Update useWalletInit**

Import `hasPassword`:
```ts
import { hasPassword } from '../services/wallet/storage'
import { loadWallet } from '../services/wallet'
```

Update the wallet loading block (lines 120-143). Replace:
```ts
        if (allAccounts.length > 0) {
          walletLogger.info('Found encrypted wallet with accounts, showing lock screen')
          setIsLocked(true)
        }
```

With:
```ts
        if (allAccounts.length > 0) {
          if (hasPassword()) {
            walletLogger.info('Found encrypted wallet with accounts, showing lock screen')
            setIsLocked(true)
          } else {
            // Passwordless wallet — load directly, no lock screen
            walletLogger.info('Found unprotected wallet, loading directly')
            try {
              const keys = await loadWallet(null)
              if (!mounted) return
              if (keys) {
                setWallet({ ...keys, mnemonic: '' })
                setSessionPassword('')
                setModuleSessionPassword('')
              } else {
                walletLogger.error('Failed to load unprotected wallet')
                setIsLocked(true) // Fallback to lock screen
              }
            } catch (e) {
              walletLogger.error('Error loading unprotected wallet', e)
              setIsLocked(true) // Fallback
            }
          }
        }
```

**Step 3: Update WalletContext auto-lock guard**

In `src/contexts/WalletContext.tsx`, line 208:
```ts
    if (wallet && autoLockMinutes > 0 && hasPassword()) {
```

Import `hasPassword` from storage.

**Step 4: Run typecheck**

Run: `npx tsc --noEmit`

**Step 5: Run full tests**

Run: `npm run test:run`
Expected: PASS (existing tests should still pass)

**Step 6: Commit**

```bash
git add src/hooks/useWalletLock.ts src/hooks/useWalletInit.ts src/contexts/WalletContext.tsx
git commit -m "feat: skip lock screen and auto-lock for passwordless wallets"
```

---

### Task 6: Hook Layer — useAccountSwitching & AccountsContext

**Files:**
- Modify: `src/hooks/useAccountSwitching.ts:38-56` (interface types)
- Modify: `src/contexts/AccountsContext.tsx:17-39` (interface), `:87-94` (getKeysForAccount)

**Step 1: Update AccountsContext interface**

Change all password params from `string` to `string | null`:
```ts
  switchAccount: (accountId: number, password: string | null) => Promise<WalletKeys | null>
  createNewAccount: (name: string, password: string | null) => Promise<WalletKeys | null>
  importAccount: (name: string, mnemonic: string, password: string | null) => Promise<WalletKeys | null>
  getKeysForAccount: (account: Account, password: string | null) => Promise<WalletKeys | null>
```

Update the `getKeysForAccount` implementation to pass `null` through:
```ts
  const getKeysForAccount = useCallback(async (account: Account, password: string | null): Promise<WalletKeys | null> => {
```

**Step 2: Update useAccountSwitching interface**

```ts
  accountsSwitchAccount: (accountId: number, password: string | null) => Promise<WalletKeys | null>
  accountsCreateNewAccount: (name: string, password: string | null) => Promise<WalletKeys | null>
  accountsImportAccount: (name: string, mnemonic: string, password: string | null) => Promise<WalletKeys | null>
  getKeysForAccount: (account: Account, password: string | null) => Promise<WalletKeys | null>
```

**Step 3: Update useWalletLock interface**

In `src/hooks/useWalletLock.ts`, update the options interface:
```ts
  getKeysForAccount: (account: Account, password: string | null) => Promise<WalletKeys | null>
```

**Step 4: Update discoverAccounts signature**

In `src/services/accountDiscovery.ts`, change:
```ts
export async function discoverAccounts(
  mnemonic: string,
  password: string | null,
  restoreActiveAccountId?: number
): Promise<number> {
```

And update the `createAccount` call inside it to pass `password` (which can now be null).

**Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Should resolve most remaining type errors.

**Step 6: Commit**

```bash
git add src/hooks/useAccountSwitching.ts src/contexts/AccountsContext.tsx src/hooks/useWalletLock.ts src/services/accountDiscovery.ts
git commit -m "feat: propagate password: string | null through account operations"
```

---

### Task 7: Fix sessionPassword Truthiness Checks

**Files:**
- Modify: `src/components/modals/settings/SettingsSecurity.tsx:53`
- Modify: `src/components/modals/settings/SettingsBackup.tsx:27,76,137`

**Step 1: Fix SettingsSecurity.tsx**

Line 53: Change `if (!wallet || !sessionPassword)` to:
```ts
    if (!wallet || sessionPassword === null) {
```

**Step 2: Fix SettingsBackup.tsx**

Line 27: Change `if (!wallet || !sessionPassword)` to:
```ts
    if (!wallet || sessionPassword === null) {
```

Line 76: Same change.

Line 137: Change `if (!sessionPassword)` to:
```ts
        if (sessionPassword === null) {
```

**Step 3: Search for any other `!sessionPassword` checks**

Run: `grep -rn '!sessionPassword' src/` and fix any remaining instances.

**Step 4: Run typecheck**

Run: `npx tsc --noEmit`

**Step 5: Commit**

```bash
git add src/components/modals/settings/SettingsSecurity.tsx src/components/modals/settings/SettingsBackup.tsx
git commit -m "fix: use sessionPassword === null instead of !sessionPassword for session checks"
```

---

### Task 8: OnboardingFlow — Skip Password UI

**Files:**
- Modify: `src/components/onboarding/OnboardingFlow.tsx`

**Step 1: Update OnboardingFlowProps**

Change `onCreateWallet` signature:
```ts
  onCreateWallet: (password: string | null) => Promise<string | null>
```

**Step 2: Add skip-password state and handler**

Add state:
```ts
  const [showSkipWarning, setShowSkipWarning] = useState(false)
```

Add handler:
```ts
  const handleSkipPassword = async () => {
    setShowSkipWarning(false)
    setCreating(true)
    try {
      const mnemonic = await onCreateWallet(null)
      if (mnemonic) {
        onWalletCreated?.(mnemonic)
      } else {
        showToast('Failed to create wallet', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error creating wallet', 'error')
    }
    setCreating(false)
  }
```

**Step 3: Add "Skip password" link to the password step UI**

After the Create Wallet button (around line 285), add:

```tsx
              <button
                className="btn btn-ghost btn-small"
                onClick={() => setShowSkipWarning(true)}
                disabled={creating}
                type="button"
              >
                Continue without password
              </button>
```

**Step 4: Add skip-password warning modal**

After the password step section, add a confirmation dialog:

```tsx
      {showSkipWarning && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-container modal-sm">
            <h3 className="modal-title">Skip Password?</h3>
            <p className="modal-text">
              Without a password, anyone with access to this computer can open your wallet and spend your funds.
              You can set a password later in Settings.
            </p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowSkipWarning(false)}>
                Go Back
              </button>
              <button className="btn btn-primary" onClick={handleSkipPassword} disabled={creating}>
                {creating ? 'Creating...' : 'Continue Without Password'}
              </button>
            </div>
          </div>
        </div>
      )}
```

**Step 5: Run typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`

**Step 6: Commit**

```bash
git add src/components/onboarding/OnboardingFlow.tsx
git commit -m "feat: add 'Continue without password' option to wallet creation"
```

---

### Task 9: RestoreModal — Optional Password

**Files:**
- Modify: `src/components/modals/RestoreModal.tsx`

**Step 1: Add skip-password state**

```ts
  const [skipPassword, setSkipPassword] = useState(false)
  const [showSkipWarning, setShowSkipWarning] = useState(false)
```

**Step 2: Update validatePassword to handle skip mode**

```ts
  const validatePasswordFields = (): boolean => {
    if (skipPassword) return true  // No validation needed
    if (password.length < SECURITY.MIN_PASSWORD_LENGTH) {
      setPasswordError(`Password must be at least ${SECURITY.MIN_PASSWORD_LENGTH} characters`)
      return false
    }
    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return false
    }
    setPasswordError('')
    return true
  }
```

**Step 3: Update restore handlers to pass null when skipped**

Each handler passes `skipPassword ? null : password` instead of `password`. For example:

```ts
  const handleRestoreFromMnemonic = async () => {
    if (!validatePasswordFields()) return
    const pwd = skipPassword ? null : password
    // ... rest uses pwd ...
    const success = await handleRestoreWallet(restoreMnemonic.trim(), pwd)
```

Same pattern for `handleRestoreFromJSON` and `handleRestoreFromFullBackup`.

**Step 4: Update each tab's password section**

Wrap password fields in `{!skipPassword && (...)}` and add the skip link:

```tsx
  {!skipPassword && (
    <>
      <div className="form-group">
        <label className="form-label">Create Password</label>
        <PasswordInput ... />
      </div>
      <div className="form-group">
        <label className="form-label">Confirm Password</label>
        <PasswordInput ... />
      </div>
      {passwordError && <div className="form-error">{passwordError}</div>}
    </>
  )}
  <button
    className="btn btn-ghost btn-small"
    onClick={() => setShowSkipWarning(true)}
    type="button"
  >
    {skipPassword ? 'Set a password' : 'Skip password'}
  </button>
```

When `skipPassword` is true and the user clicks "Set a password", toggle it back: `setSkipPassword(false)`.

**Step 5: Update submit button disabled state**

```ts
  disabled={!restoreMnemonic.trim() || (!skipPassword && (!password || !confirmPassword))}
```

**Step 6: Add the same warning modal as OnboardingFlow**

Reuse the same pattern — or extract a shared `SkipPasswordWarning` component if you prefer DRY.

**Step 7: Run typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`

**Step 8: Commit**

```bash
git add src/components/modals/RestoreModal.tsx
git commit -m "feat: add optional password to all restore flows"
```

---

### Task 10: SettingsSecurity — Set Password & Export Password Prompt

**Files:**
- Modify: `src/components/modals/settings/SettingsSecurity.tsx`

**Step 1: Import dependencies**

```ts
import { hasPassword } from '../../../services/wallet/storage'
import { encryptAllAccounts } from '../../../services/accounts'
import { saveWallet, loadWallet } from '../../../services/wallet'
import { NO_PASSWORD } from '../../../services/sessionPasswordStore'
import { PasswordInput } from '../../shared/PasswordInput'
import { SECURITY } from '../../../config'
```

**Step 2: Add set-password state**

```ts
  const [showSetPassword, setShowSetPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [setPasswordError, setSetPasswordError] = useState('')
  const [settingPassword, setSettingPassword] = useState(false)
  const [showExportPasswordPrompt, setShowExportPasswordPrompt] = useState(false)
  const [exportPassword, setExportPassword] = useState('')
  const [confirmExportPassword, setConfirmExportPassword] = useState('')
  const [exportPasswordError, setExportPasswordError] = useState('')
  const isPasswordless = !hasPassword()
```

**Step 3: Add handleSetPassword function**

```ts
  const handleSetPassword = useCallback(async () => {
    if (newPassword.length < SECURITY.MIN_PASSWORD_LENGTH) {
      setSetPasswordError(`Password must be at least ${SECURITY.MIN_PASSWORD_LENGTH} characters`)
      return
    }
    if (newPassword !== confirmNewPassword) {
      setSetPasswordError('Passwords do not match')
      return
    }
    setSettingPassword(true)
    try {
      // Load current (unprotected) keys
      const keys = await loadWallet(null)
      if (!keys) throw new Error('Failed to load wallet keys')

      // Re-save encrypted + encrypt all account rows
      await saveWallet(keys, newPassword)
      await encryptAllAccounts(newPassword)

      // Update session
      setSessionPassword(newPassword)
      setModuleSessionPassword(newPassword)
      setAutoLockMinutes(10) // Enable auto-lock at default

      showToast('Password set! Lock screen and auto-lock are now enabled.')
      setShowSetPassword(false)
      setNewPassword('')
      setConfirmNewPassword('')
    } catch (err) {
      setSetPasswordError(err instanceof Error ? err.message : 'Failed to set password')
    } finally {
      setSettingPassword(false)
    }
  }, [newPassword, confirmNewPassword, showToast, setAutoLockMinutes])
```

Note: Import `setSessionPassword as setModuleSessionPassword` from `sessionPasswordStore` and `setAutoLockMinutes` from wallet context.

**Step 4: Conditionally render security rows**

Wrap "Auto-Lock Timer" and "Lock Wallet Now" rows in `{!isPasswordless && (...)}`.

Add "Set Password" row when passwordless:
```tsx
  {isPasswordless && (
    <div className="settings-row" role="button" tabIndex={0}
         onClick={() => setShowSetPassword(true)}
         onKeyDown={handleKeyDown(() => setShowSetPassword(true))}
         aria-label="Set wallet password">
      <div className="settings-row-left">
        <div className="settings-row-icon"><Lock size={16} strokeWidth={1.75} /></div>
        <div className="settings-row-content">
          <div className="settings-row-label">Set Password</div>
          <div className="settings-row-value">Enable lock screen and encryption</div>
        </div>
      </div>
      <span className="settings-row-arrow"><ChevronRight size={16} strokeWidth={1.75} /></span>
    </div>
  )}
```

**Step 5: Add Set Password modal**

```tsx
  {showSetPassword && (
    <ConfirmationModal
      title="Set Wallet Password"
      message=""
      type="info"
      confirmText={settingPassword ? 'Setting...' : 'Set Password'}
      cancelText="Cancel"
      onConfirm={handleSetPassword}
      onCancel={() => { setShowSetPassword(false); setNewPassword(''); setConfirmNewPassword(''); setSetPasswordError('') }}
    >
      <div className="form-group">
        <label className="form-label">Password</label>
        <PasswordInput value={newPassword} onChange={setNewPassword} placeholder={`At least ${SECURITY.MIN_PASSWORD_LENGTH} characters`} />
      </div>
      <div className="form-group">
        <label className="form-label">Confirm Password</label>
        <PasswordInput value={confirmNewPassword} onChange={setConfirmNewPassword} placeholder="Confirm password" />
      </div>
      {setPasswordError && <div className="form-error">{setPasswordError}</div>}
    </ConfirmationModal>
  )}
```

Note: ConfirmationModal may need a `children` prop. Check its implementation — if it doesn't support children, use a custom modal instead.

**Step 6: Update export keys to prompt for one-time password when passwordless**

Replace `executeExportKeys` — when `sessionPassword === '' || sessionPassword === null`:
```ts
  const executeExportKeys = useCallback(async () => {
    if (!wallet) {
      setShowKeysWarning(false)
      return
    }

    if (sessionPassword === null || sessionPassword === NO_PASSWORD) {
      // Passwordless — need one-time export password
      setShowKeysWarning(false)
      setShowExportPasswordPrompt(true)
      return
    }

    // Existing export logic using sessionPassword...
  }, [wallet, sessionPassword, showToast])
```

Add `handleExportWithOneTimePassword`:
```ts
  const handleExportWithOneTimePassword = useCallback(async () => {
    if (exportPassword.length < SECURITY.MIN_PASSWORD_LENGTH) {
      setExportPasswordError(`Password must be at least ${SECURITY.MIN_PASSWORD_LENGTH} characters`)
      return
    }
    if (exportPassword !== confirmExportPassword) {
      setExportPasswordError('Passwords do not match')
      return
    }
    // ... same export logic as existing executeExportKeys but use exportPassword instead of sessionPassword
    setShowExportPasswordPrompt(false)
    setExportPassword('')
    setConfirmExportPassword('')
  }, [exportPassword, confirmExportPassword, wallet, showToast])
```

**Step 7: Run typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`

**Step 8: Commit**

```bash
git add src/components/modals/settings/SettingsSecurity.tsx
git commit -m "feat: add Set Password in settings, export password prompt for passwordless wallets"
```

---

### Task 11: Fix SettingsBackup for Passwordless Exports

**Files:**
- Modify: `src/components/modals/settings/SettingsBackup.tsx`

**Step 1: Update backup export to handle passwordless**

The essential backup and full backup exports currently check `!sessionPassword`. These need to either:
1. Prompt for a one-time backup encryption password (like key export), OR
2. Export unencrypted (since the user chose no password)

Recommended: Prompt for a one-time password for encrypted backup, or offer unencrypted export with a warning.

For the simplest approach, when `sessionPassword === null || sessionPassword === ''`, prompt the user to enter a password for the backup file:

```ts
  const [showBackupPasswordPrompt, setShowBackupPasswordPrompt] = useState(false)
  const [backupPassword, setBackupPassword] = useState('')
  // ... etc, similar to export keys pattern
```

Update `handleExportEssentialBackup` and the encrypted backup import to use the prompted password.

**Step 2: Run typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`

**Step 3: Commit**

```bash
git add src/components/modals/settings/SettingsBackup.tsx
git commit -m "feat: backup export prompts for password when wallet is passwordless"
```

---

### Task 12: Full Test Pass & Integration Verification

**Files:**
- All test files

**Step 1: Run full test suite**

Run: `npm run test:run`
Expected: All 657+ tests pass

**Step 2: Fix any failing tests**

Tests that mock `loadWallet` or `saveWallet` may need signature updates. Tests that check `sessionPassword` truthiness may need `=== null` fixes.

**Step 3: Run lint**

Run: `npm run lint`

**Step 4: Run typecheck**

Run: `npx tsc --noEmit`

**Step 5: Run build**

Run: `npm run build`
Expected: Clean build, no errors

**Step 6: Commit any test fixes**

```bash
git add -A
git commit -m "test: fix tests for optional password support"
```

---

### Task 13: Manual Testing Checklist

Test each flow in `npm run tauri:dev`:

1. **Create wallet without password** — click Skip, confirm warning, verify wallet opens, no lock screen
2. **Create wallet with password** — enter 14+ char password, verify lock screen on reload
3. **Restore from seed phrase without password** — skip password, verify wallet loads
4. **Restore from seed phrase with password** — verify lock screen on reload
5. **Restore from JSON backup without password** — same pattern
6. **Restore from full backup without password** — same pattern
7. **Settings → Set Password** — enter password, verify lock screen activates
8. **Auto-lock disabled when no password** — wait for timeout, verify wallet stays open
9. **Auto-lock enabled after Set Password** — wait, verify lock screen appears
10. **Export keys (no password)** — verify one-time password prompt appears
11. **Account switching (no password)** — switch accounts, verify works without password
12. **Create new account (no password)** — verify account created without needing password

---

### Summary: Task Dependency Graph

```
Task 1 (types/keys)
  └─> Task 2 (storage layer)
       └─> Task 3 (accounts layer)
            └─> Task 4 (useWalletActions)
            └─> Task 6 (useAccountSwitching)
       └─> Task 5 (useWalletLock/Init)
  └─> Task 7 (truthiness fixes) [independent]
  └─> Task 8 (OnboardingFlow UI) [needs Task 4]
  └─> Task 9 (RestoreModal UI) [needs Task 4]
  └─> Task 10 (SettingsSecurity) [needs Task 3, 5]
  └─> Task 11 (SettingsBackup) [needs Task 7]
  └─> Task 12 (full test pass) [needs all above]
  └─> Task 13 (manual testing) [needs Task 12]
```

Tasks 7, 8, 9 can run in parallel after Task 4 is complete.
Tasks 10, 11 can run in parallel after Tasks 3+5+7 are complete.
