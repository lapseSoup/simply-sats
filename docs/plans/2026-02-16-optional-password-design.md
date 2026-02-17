# Optional Password for All Setup Flows

**Date:** 2026-02-16
**Status:** Approved
**Approach:** Dual-mode storage with explicit format flag (version 0 = unprotected, version 1 = encrypted)

## Problem

All setup flows (create wallet, restore from seed/JSON/full backup) require a 14+ character password. This creates unnecessary friction for users who want quick access and trust their device's OS-level security (keychain).

## Design Overview

Password becomes optional in all setup flows. Two explicit storage formats coexist:

- **Version 0 (unprotected):** Plaintext `WalletKeys` wrapped in `{ version: 0, mode: 'unprotected', keys }`, stored in Tauri secure storage (OS keychain)
- **Version 1 (encrypted):** AES-256-GCM `EncryptedData` — existing format, unchanged

A localStorage flag `simply_sats_has_password` (`'true'` / `'false'`) drives all conditional behavior (lock screen, auto-lock, settings UI). Defaults to `'true'` for existing wallets.

---

## Section 1: Storage Format

### New type: `UnprotectedWalletData`

```ts
interface UnprotectedWalletData {
  version: 0
  mode: 'unprotected'
  keys: WalletKeys  // plaintext
}
```

Alongside existing:

```ts
interface EncryptedData {
  version: 1  // (number, currently CURRENT_VERSION = 1)
  ciphertext: string
  iv: string
  salt: string
  iterations: number
}
```

New type guard: `isUnprotectedData(data)` checks `version === 0 && mode === 'unprotected'`.

**Where stored:** Tauri secure storage (OS keychain) — same IPC commands as encrypted data. The Rust `secure_storage_save`/`secure_storage_load` commands accept/return arbitrary JSON, so no Rust changes needed.

**Detection flag:** `localStorage.getItem('simply_sats_has_password')` — synchronous read on startup, no async needed.

---

## Section 2: Storage Layer (`storage.ts`)

### `saveWalletUnprotected(keys)` — new function

```ts
async function saveWalletUnprotected(keys: WalletKeys): Promise<void>
```

- Wraps keys in `{ version: 0, mode: 'unprotected', keys }`
- Saves to Tauri secure storage (falls back to localStorage for web builds)
- Sets `simply_sats_has_password = 'false'` in localStorage

### `saveWallet(keys, password)` — unchanged

- Existing behavior: encrypt → save → set `simply_sats_has_password = 'true'`

### `loadWallet(password)` — signature changes to `password: string | null`

- If stored data is `UnprotectedWalletData` (version 0): return `keys` directly, ignore password
- If stored data is `EncryptedData` (version 1): decrypt with password (existing behavior)
- Current security violation check (rejects raw `{mnemonic, walletWif}`) replaced by version 0 check

### `hasPassword()` — new function

```ts
function hasPassword(): boolean {
  return localStorage.getItem('simply_sats_has_password') !== 'false'
}
```

Safe default: `true` (existing wallets without the flag are password-protected).

---

## Section 3: Account Layer (`accounts.ts`)

### `createAccount()` — password becomes `string | null`

When `null`:
- Skip password validation
- Store `JSON.stringify({ version: 0, mode: 'unprotected', keys: keysJson })` in `encrypted_keys` column
- Column name is a misnomer in this mode; renaming requires a migration — not worth it

When `string`: everything works as today (encrypt → store).

### `getAccountKeys()` — password becomes `string | null`

- Parse `account.encryptedKeys` as JSON
- If `version: 0, mode: 'unprotected'` → return `keys` directly
- If `EncryptedData` (version 1) → decrypt with password
- Current empty-password rejection bypassed when stored data is unprotected

### `migrateToMultiAccount()` — passes `password: string | null` through

### `encryptAllAccounts(password)` — new function

Called by "Set Password" in Settings:

```ts
async function encryptAllAccounts(password: string): Promise<void>
```

- Iterates ALL accounts
- For each with version 0: parse plaintext keys → encrypt with password → UPDATE row
- Calls `saveWallet(keys, password)` to re-encrypt the secure storage blob
- Sets `simply_sats_has_password = 'true'`
- Atomic: if any account fails, rolls back — no partial state

---

## Section 4: Session Password & Lock Behavior

### Session password sentinel

```ts
// sessionPasswordStore.ts
export const NO_PASSWORD = '' as const
```

Semantics:
- `sessionPassword === null` → locked / no active session
- `sessionPassword === ''` (NO_PASSWORD) → unlocked, no password was set
- `sessionPassword === 'actual-string'` → unlocked, password-protected

**Important:** All `!sessionPassword` checks that mean "no active session" must change to `sessionPassword === null`. Empty string is falsy in JS.

### `useWalletLock` changes

- `lockWallet()` — no-op when `!hasPassword()`. Visibility-based lock also checks `hasPassword()`.
- `unlockWallet(password)` — when stored data is version 0: load keys directly, skip PBKDF2 and rate limiting, set `sessionPassword = NO_PASSWORD`.
- Auto-lock init guard: `wallet && autoLockMinutes > 0 && hasPassword()`.

### `useWalletInit` changes (app startup)

Current:
1. `hasWallet()` → accounts exist → `setIsLocked(true)` → lock screen

New:
1. `hasWallet()` → accounts exist AND `hasPassword()` → `setIsLocked(true)` → lock screen
2. `hasWallet()` → accounts exist AND `!hasPassword()` → `loadWallet(null)` → set wallet → `sessionPassword = NO_PASSWORD` → no lock screen

### Lock screen gate (`App.tsx` line 271)

No change needed: `isLocked && wallet === null`. For passwordless wallets, `isLocked` is never set to `true`.

### Settings (`SettingsSecurity.tsx`)

When `!hasPassword()`:
- Hide "Auto-Lock Timer", "Lock Wallet Now"
- Show "Set Password" row: "Enable lock screen and encryption"
- On submit: `encryptAllAccounts(password)` → update `sessionPassword` → enable auto-lock at 10 min

When `hasPassword()`:
- Everything as today
- Add "Change Password" row (currently missing)

---

## Section 5: UI Changes

### OnboardingFlow (create wallet)

Password step gains a "Skip — Continue without password" link below the Create Wallet button:
- Shows one-time warning: "Without a password, anyone with access to this computer can spend your funds."
- On confirm: calls `onCreateWallet(null)` — password param becomes `string | null`

### RestoreModal (all three tabs)

Each tab (Seed Phrase, JSON Backup, Full Backup):
- Password/confirm fields remain visible but become optional
- "Skip password" link below confirm field
- Clicking it collapses the password section, changes button text to "Restore Without Password"
- Same one-time warning

### Export Keys (no wallet password)

When `!hasPassword()` or `sessionPassword === NO_PASSWORD`:
- Instead of encrypting with session password, show modal: "Enter a password to protect your exported keys"
- Password + confirm fields
- Encrypt export with that one-time password
- Toast: "Keys exported — remember the password you used!"

---

## Section 6: Account Operations & Edge Cases

### Account operations — password becomes `string | null`

All operations that pass `password: string`:
- `switchAccount(accountId, password)` → passes `null` when `!hasPassword()`
- `createNewAccount(name, password)` → same
- `importAccount(name, mnemonic, password)` → same
- `discoverAccounts(mnemonic, password, excludeId)` → same

The `sessionPassword` value (real password or `NO_PASSWORD`) flows through. `NO_PASSWORD = ''` is falsy, so all `!sessionPassword` checks must become `sessionPassword === null`.

### Edge case: Mixed encryption state

Cannot happen by design. Either ALL accounts are unprotected or ALL are encrypted. `encryptAllAccounts` is atomic.

### Edge case: Encrypted backup file + no wallet password

Restore flow prompts for backup file's encryption password (to decrypt the file). Wallet itself stores unprotected if user skipped wallet password. UI labels: "Backup file password" vs "Wallet password (optional)".

### Edge case: "Remove Password"

Not supported. Once set, password can only be changed. Prevents accidental security downgrade.

---

## Affected Files Summary

| File | Change |
|------|--------|
| `src/services/wallet/storage.ts` | `saveWalletUnprotected()`, `loadWallet(null)`, `hasPassword()`, `UnprotectedWalletData` type |
| `src/services/wallet/types.ts` | `UnprotectedWalletData` interface |
| `src/services/accounts.ts` | `password: string \| null` throughout, `encryptAllAccounts()` |
| `src/services/sessionPasswordStore.ts` | `NO_PASSWORD` constant |
| `src/hooks/useWalletLock.ts` | Guard lock/auto-lock on `hasPassword()` |
| `src/hooks/useWalletInit.ts` | Skip lock screen for passwordless wallets |
| `src/hooks/useWalletActions.ts` | `password: string \| null` in create/restore/import |
| `src/hooks/useAccountSwitching.ts` | Pass `null` password when unprotected |
| `src/contexts/AccountsContext.tsx` | `password: string \| null` in interface |
| `src/contexts/WalletContext.tsx` | Auto-lock guard adds `hasPassword()` |
| `src/components/onboarding/OnboardingFlow.tsx` | "Skip password" link + warning |
| `src/components/modals/RestoreModal.tsx` | Optional password fields + skip link |
| `src/components/modals/settings/SettingsSecurity.tsx` | "Set Password" / "Change Password", conditional hide lock options, export password prompt |
| `src/components/modals/LockScreenModal.tsx` | No changes needed |
| `src/services/autoLock.ts` | No changes needed (guarded at call site) |
| `src/services/crypto.ts` | No changes needed |
| `src/services/accountDiscovery.ts` | `password: string \| null` |
| `src/App.tsx` | No changes needed (lock gate works as-is) |

## What Stays The Same

- All encryption logic when password IS set — identical to today
- Password strength requirements: 14+ chars when chosen
- Encrypted backup export: user provides password at export time
- BRC-100 operations
- Rate limiting on unlock attempts (only applies when password exists)
- Tauri secure storage Rust commands — no changes
