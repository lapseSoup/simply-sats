# Optional Password for All Setup Flows

**Date:** 2026-02-16
**Status:** Approved
**Decision:** Password is optional during wallet creation and all restore flows. Keys stored unencrypted in Tauri secure storage when no password is set.

## Problem

All setup flows (create wallet, restore from seed/JSON/full backup) require a 14+ character password. This creates unnecessary friction for users who want quick access to their wallet and are comfortable with OS-level device security.

## Design

### Core Principle

Password becomes optional everywhere. When skipped, wallet keys are stored as plaintext JSON in Tauri secure storage (OS keychain). When provided, everything works identically to today (AES-256-GCM encryption).

### Affected Flows

| Flow | File | Change |
|------|------|--------|
| Create Wallet | `OnboardingFlow.tsx` | Password step becomes optional, add "Skip" |
| Restore Seed Phrase | `RestoreModal.tsx` | Password fields optional, add "Continue without password" |
| Restore JSON Backup | `RestoreModal.tsx` | Same |
| Restore Full Backup | `RestoreModal.tsx` | Same |
| Lock Screen | `LockScreenModal.tsx` | Don't show if no password set |
| Auto-lock | `autoLock.ts` | Disabled when no password |
| Settings | `SettingsSecurity.tsx` | "Set Password" option when none exists |

### Storage Layer Changes

**`src/services/wallet/storage.ts`:**
- `saveWallet(keys, password?)` — if no password, store keys as plaintext JSON
- `loadWallet(password?)` — if no password, load plaintext JSON directly
- `hasPassword()` — new function to check if wallet is password-protected

**`src/services/crypto.ts`:**
- No changes. Encryption functions only called when password is provided.

**Storage format (no password):**
```json
{
  "format": "simply-sats-keys-plaintext",
  "version": 1,
  "mnemonic": "...",
  "walletWif": "...",
  "ordWif": "...",
  "identityWif": "...",
  "walletAddress": "...",
  "ordAddress": "...",
  "identityAddress": "...",
  "walletPubKey": "..."
}
```

### Behavioral Rules

1. **No password = no lock screen.** Auto-lock timer skipped. Wallet always open.
2. **No password = no session password.** Account operations derive keys from Rust key store or use plaintext storage directly.
3. **"Set Password" in Settings** encrypts existing plaintext keys, enables lock screen and auto-lock.
4. **"Remove Password" NOT supported** — once set, password can only be changed, not removed. This prevents accidental downgrade of security.
5. **Password strength unchanged** — 14+ chars minimum when a password is chosen.

### Account Operations Without Password

- `switchAccount()` — already uses Rust key store as primary path. No change needed.
- `createNewAccount()` / `importAccount()` — need to handle `password = undefined` by storing keys in plaintext.
- `getAccountKeys()` — bypass decryption when no password set, read plaintext directly.

### What Stays The Same

- All encryption logic when password IS set
- Password strength requirements (14+ chars)
- Encrypted backup export (user provides password at export time)
- BRC-100 operations
- Rate limiting on unlock attempts (only applies when password exists)
