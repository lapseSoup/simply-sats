# Simply Sats — Full Review v29 (Review #29)
**Date:** 2026-03-04
**Baseline:** 0 lint errors (54 warnings), typecheck passes, 1957/1957 tests pass
**Rating:** 8.0 / 10

---

## Phase 1: Security Audit

### Previously Open Issues — Status

| ID | Status | Notes |
|----|--------|-------|
| S-126 | Still Open | `useWalletSend.ts` — 6 `getWifForOperation` call sites pull WIFs into JS heap for send operations |
| S-117 | Still Open | Rust `add_p2pkh_output` accepts zero-sat outputs; JS validates but Rust does not |
| S-118 | Still Open | `get_mnemonic`/`get_mnemonic_once` return mnemonic through IPC; JS copies never zeroized |
| S-119 | Still Open (by design) | BRC-100 locks use P2PKH soft locks, not CLTV — documented design decision |

### New Security Findings

#### S-131 — WalletKeys with WIFs stored in React state for entire session [Medium]

**File:** `WalletContext.tsx:62`, `domain/types.ts:103-116`

The `WalletKeys` interface includes `walletWif`, `ordWif`, and `identityWif` as required string fields. This object is stored in React state (`useState<WalletKeys | null>`) and remains in the JS heap for the entire session. While callers strip mnemonic (`{ ...keys, mnemonic: '' }`), WIF fields are never stripped.

This is the architectural root cause of S-126 — WIFs are available in React state and accessible from any component via `useWallet()`.

**Fix:** Create `PublicWalletKeys` type (already exists at `services/wallet/types.ts:80-88`) and use it for React state. The `getWifForOperation()` bridge would be the only path to access WIFs.

#### S-132 — 25+ `getWifForOperation` call sites create broad WIF exposure surface [Medium]

**Files:** `useWalletSend.ts` (6), `TokensContext.tsx` (2), `ReceiveModal.tsx` (1), `SettingsBackup.tsx` (3), `SettingsSecurity.tsx` (6), `SettingsAdvanced.tsx` (2), `lockCreation.ts` (1), `lockUnlocking.ts` (1)

Each call pulls a WIF from Rust into JS for the duration of an operation. None implement zeroization after use. The migration to `_from_store` Rust commands has stalled.

**Fix:** Prioritize migrating remaining operations to Rust `_from_store` commands.

#### S-133 — `build_ordinal_transfer_tx` receives WIFs via IPC from JS [Medium]

**File:** `ordinals.ts:281-303`, `transaction.rs:441`

Unlike other transaction types (which have `_from_store` variants), ordinal transfers have no key-store-based Rust command. WIFs travel JS → IPC → Rust.

**Fix:** Create `build_ordinal_transfer_tx_from_store`.

#### S-134 — Deprecated `getKnownTaggedKey` still exists, returns root WIFs [Low]

**File:** `keyDerivation.ts:402-448`

Marked `@deprecated` but still exists. No active call sites found. Dead code that should be deleted entirely since `deriveTaggedKeyFromStore()` is the preferred replacement.

#### S-135 — BRC-100 module-level wallet keys can diverge from React state [Low]

**File:** `brc100/state.ts:26`

`currentWalletKeys` is module-level mutable state that could diverge from `WalletContext` state. Mitigation exists via `assertKeysMatchAccount()` guard and `approveRequest` re-fetch.

#### S-136 — Account creation handles plaintext WIFs in JS during key lifecycle [Low]

**File:** `accounts.ts:107-118`

Inherent to key lifecycle — keys must exist in JS at creation time. Encrypted storage is sound (AES-256-GCM, PBKDF2 600k).

#### S-137 — No zero-sat output check in Rust `add_p2pkh_output` [Low]

**File:** `transaction.rs:116-126`

Defense-in-depth issue. All current code paths validate before reaching this function.

**Fix:** Add `if satoshis == 0 { return Err(...) }` to `add_p2pkh_output()`.

### Positive Security Notes

- Rust key store architecture: well-designed `Zeroizing<String>`, proper `Drop`, `require_keys()` guard
- Transaction validation: comprehensive Number.isFinite + satoshis > 0 + isInteger + MAX_SATOSHIS + isValidBSVAddress
- PBKDF2: 600k iterations with minimum enforcement during decryption
- HTTP server: layered defense (host validation, origin whitelist, session tokens, CSRF nonces, rate limiting, HMAC signing)
- Rate limiter: HMAC-SHA256 integrity, constant-time comparison, exponential backoff
- BRC-100 handler validation: byte array validation, size limits, output count limits

---

## Phase 2: Bug Detection

### Previously Open Bugs — Status

| ID | Status | Notes |
|----|--------|-------|
| B-78 | Still Open | Fee fallback `Math.ceil(balance / 10000)` overestimates for large balances |
| B-79 | Still Open (accepted) | Hardcoded `qr-scanner-container` ID; single modal prevents collision |
| B-22 | Mitigated | localStorage quota warning added; 0-balance flash remains (unlikely on desktop) |
| B-88 | Noted | `syncInactiveAccountsBackground` fire-and-forget; intentional for background ops |

### New Bug Findings

#### B-121 — `handleImportJSON` leaks mnemonic+WIFs into React state [High]

**File:** `useWalletActions.ts:226`

`handleImportJSON` calls `setWallet(keys)` with the full `keys` object including mnemonic and all WIFs. Every other wallet-setting path calls `setWallet({ ...keys, mnemonic: '' })` to strip the mnemonic:
- `handleCreateWallet` (line 112)
- `handleRestoreWallet` (line 168)
- `useAccountSwitching` (lines 231, 313, 332)
- `useWalletInit` (lines 218, 258)

After JSON import, the full mnemonic persists in React state.

**Fix:** Change `setWallet(keys)` to `setWallet({ ...keys, mnemonic: '' })`.

#### B-122 — `handleImportJSON` does not set `activeAccountState` [Medium]

**File:** `useWalletActions.ts:180-235`

After import, `refreshAccounts()` is called but `setActiveAccountState()` is never called. Both `handleCreateWallet` and `handleRestoreWallet` call it. Without it, `activeAccountId` remains null and auto-sync doesn't fire.

**Fix:** Add `setActiveAccountState(activeAcc, activeAcc.id)` after `refreshAccounts()`.

#### B-123 — `createNewAccount` uses potentially stale `accounts.length` for Rust key store index [Medium]

**File:** `useAccountSwitching.ts:311,330`

`storeKeysInRust(keys.mnemonic, keys.accountIndex ?? (accounts.length))` — `accounts.length` is from a closure that may be stale due to React batch updates. The `keys.accountIndex` fallback rarely fires but could produce wrong BIP-44 path.

**Fix:** Use `keys.accountIndex ?? 0` as safer fallback, or read from the newly created account record.

#### B-124 — Payment alert persists across account switch [Medium]

**File:** `usePaymentListener.ts:37-66`

When switching accounts, the effect cleanup stops the old listener but doesn't clear `newPaymentAlert` state. A payment alert from Account A could persist and display in Account B's view.

**Fix:** Add `setNewPaymentAlert(null)` in the cleanup function.

#### B-125 — `useLatestRef` return type mismatch [Low]

**File:** `useLatestRef.ts:8`

Returns `React.RefObject<T>` (readonly) but internal effect writes to `.current`. Type-level only, no runtime impact.

#### B-126 — `lockWallet` audit log captures stale `activeAccountId` in narrow race window [Low]

**File:** `useWalletLock.ts:113`

Self-correcting since `lockWallet` is in the auto-lock effect's dependency array. Extremely narrow race window.

#### B-127 — Background sync for inactive accounts continues briefly after wallet lock [Low]

**File:** `useCheckSync.ts:233-268`

`cancelled` flag not set by wallet lock (only by effect cleanup). Keys remain in local variables briefly after lock. Low risk — keys are garbage collected after loop iteration.

#### B-128 — `deleteAccount` does not reset sync state [Low]

**File:** `useAccountSwitching.ts:351-373`

After deletion, `setWallet(keys)` is called but no `resetSync()`, `resetKnownUnlockedLocks()`, or `fetchDataFromDB()`. UI shows deleted account's data until next `checkSync` fires.

**Fix:** Add sync reset + data reload after setting the new wallet.

---

## Phase 3: Architecture Review

### Previously Open Issues — Status

| ID | Status | Notes |
|----|--------|-------|
| A-49 | Improved (27→13 files) | 13 non-test files still import `@tauri-apps/*` directly. Still blocks Chrome extension parity |
| A-50 | **FIXED** | No circular imports found between sync/ and wallet/ |
| A-51 | Improved (25→24 fields) | Split into WalletStateContext + WalletActionsContext. Still 24 fields in state |
| A-55 | Improved (37→6 files) | 6 service files still call `getDatabase()` directly |
| A-56 | Improved | Dual API pattern (`*Safe` methods) added, legacy methods retained intentionally |
| A-58 | **WORSE** (1→7 files) | Now 7 repositories use runtime `CREATE TABLE IF NOT EXISTS` |
| A-60 | **IMPROVED** | Split into State+Actions contexts, logic extracted into 5 hooks. Still coordinates |
| A-52 | Open (11 components + 8 hooks) | Components and hooks importing from infrastructure/database directly |
| A-53 | Partial | ordinalRepository and utxoRepository still have unbounded queries |
| A-59 | Open | tokens/state.ts fat service with no tokenRepository |
| A-62 | Open | Three error patterns (Result, WalletResult, throw) coexist |
| A-68 | Partial | utils/ wrappers exist but missing event, deep link, plugin SQL wrappers |

### New Architecture Findings

#### A-70 — Services layer not using PlatformAdapter at all [Medium]

Zero service files import `getPlatform()` or `usePlatform()`. The PlatformAdapter is only used by `PlatformProvider.tsx` and a few hooks. Services hardcode Tauri IPC calls, making Chrome extension mode impossible at the service layer.

#### A-71 — Infrastructure has upward dependency on services/logger and services/errors [Low]

Every infrastructure/database file imports `dbLogger` from `../../services/logger` and `DbError` from `../../services/errors`. Violates layered architecture (infrastructure should not depend on services).

#### A-72 — N+1 query pattern in utxoRepository [Low]

**File:** `utxoRepository.ts:243-247`

Each UTXO triggers an individual tag query. With 100+ UTXOs, this generates 100+ queries. Same in `getAllUTXOs()` (line 573).

**Fix:** Use JOIN or batch query.

#### A-73 — auditLog.ts maintains separate DB connection [Medium]

**File:** `auditLog.ts:18,30`

Creates its own singleton Database instance separate from the main connection. Risks SQLITE_BUSY conflicts and breaks transaction atomicity.

#### A-74 — 7 repository tables use ensure*Table() lazy initialization [Medium]

**Files:** ordinalRepository, contactRepository, actionRepository, addressRepository, addressBookRepository, certificates.ts, utxoRepository (ensureColumn)

Schema management split between Tauri migrations and runtime DDL. Creates race conditions, prevents schema rollback.

#### A-76 — Database connection pool does not guarantee transaction atomicity [Medium]

**File:** `connection.ts:8-19`

Well-documented: `BEGIN TRANSACTION` / `COMMIT` may run on different pool connections. `drainDanglingTransactions()` is a mitigation but not a fix.

### Positive Architecture Notes

- PlatformAdapter pattern (types.ts, TauriAdapter, ChromeAdapter) is well-designed
- Context splitting into State+Actions is a meaningful improvement
- Hook extraction (5 focused hooks from WalletContext) is solid decomposition
- ErrorBoundary per provider prevents cascade failures
- WoC client dual API is a clean migration path
- Batch DB operations for ordinals prevent N+1 patterns

---

## Phase 4: Code Quality

### Previously Open Issues — Status

| ID | Status | Notes |
|----|--------|-------|
| Q-72 | Open | 4 service modules with zero test coverage |
| Q-85 | Open | Duplicated formatAmount/formatBalance (now confirmed 3 implementations) |
| Q-86 | Improved (100→40 occurrences) | `toErrorMessage()` utility exists but imported in 0 non-test files |
| Q-92 | Open | 6 service files at 0-3% coverage (1,551 lines combined) |
| Q-95 | Open (expanded) | Now 60+ silent catch blocks (was 22) |
| Q-70 | Open | Missing aria-describedby on lock-blocks input |
| Q-75 | Open (23 casts) | `as any` casts in useOrdinalCache.test.ts |
| Q-76 | Open (60+ instances) | Inline style={{}} scattered across modals |
| Q-87 | Open (176 instances) | Repeated settings row pattern across 10 settings files |

### New Quality Findings

#### Q-100 — Key export logic fully duplicated in SettingsSecurity.tsx [Medium]

**File:** `SettingsSecurity.tsx:62-112, 171-219`

Two ~35-line functions (`executeExportKeys`, `handleExportWithOneTimePassword`) are nearly identical. Only difference is password source.

**Fix:** Extract `exportKeysToFile(password, wallet)`.

#### Q-101 — Three independent formatBalance/formatAmount implementations [Medium]

**Files:** `UIContext.tsx:140` (`formatBSVShort`), `Header.tsx:94` (`formatBalance`), `SendModal.tsx:284` (`formatAmount`)

Each has subtly different formatting logic and thresholds. Same balance value may display differently in different views.

**Fix:** Consolidate into single `formatSatoshis(sats, mode)` utility.

#### Q-102 — `sats.toLocaleString() + ' sats'` pattern repeated 30+ times [Low]

Scattered formatting without centralized utility.

#### Q-103 — 60+ silent catch blocks with no logging [Medium]

**Files:** overlay.ts (6), orchestration.ts (5), lockReconciliation.ts (3), historySync.ts (3), accounts.ts (3), and many components.

Critical sync paths silently swallow errors with `catch { }` or `catch (_e) { /* Best-effort */ }`.

**Fix:** Add at minimum `syncLogger.debug()` to sync-critical catch blocks.

#### Q-104 — `.catch(() => {})` swallows promise rejections [Low]

**Files:** `SignMessageModal.tsx:53`, `SettingsCache.tsx:16`

No feedback to user or developer on clipboard/cache failures.

#### Q-105 — `toErrorMessage()` utility exists but virtually unused [Medium]

**File:** `utils/errorMessage.ts`

Imported in 0 non-test files. The exact pattern it provides is manually repeated 40 times.

**Fix:** Global adoption of `toErrorMessage()`.

#### Q-106 — 23 `as any` casts in single test file [Low]

All `bumpCacheVersion as any` in `useOrdinalCache.test.ts`.

#### Q-107 — Chained `as` casts in error context extraction [Low]

**File:** `useWalletSend.ts:175,189,211,224`

`(e.context as Record<string, unknown>)?.txid as string` — double type assertions bypass checking.

#### Q-108 — Header fetches all account balances on every account switch [Medium]

**File:** `Header.tsx:32-60`

2N async DB calls (N = account count) on every `accounts` or `activeAccountId` change, even when dropdown is closed.

**Fix:** Lazy-load balances when dropdown opens.

#### Q-109 — Unbounded `txDetailCache` Map in historySync.ts [Low]

**File:** `historySync.ts:32`

Grows unboundedly during sync. Cleared after each sync but could be large during restore operations.

#### Q-110 — 6 service modules with zero test coverage [Medium]

- `ordinalContent.ts` (69 lines)
- `ordinalCacheManager.ts` (145 lines)
- `lockReconciliation.ts` (276 lines)
- `backupReminder.ts` (47 lines)
- `historySync.ts` (354 lines)
- `orchestration.ts` (660 lines)

Combined 1,551 lines of untested business logic. `orchestration.ts` and `historySync.ts` are the most critical.

#### Q-111 — BRC-100 listener, outputs, and locks modules lack tests [Medium]

**Files:** `brc100/listener.ts` (273 lines), `brc100/outputs.ts` (207 lines), `brc100/locks.ts` (195 lines)

External-facing BRC-100 protocol interactions with zero test coverage.

#### Q-112 — `lock-blocks` input missing `aria-describedby` [Low]

(Same as Q-70, re-confirmed.)

#### Q-113 — Settings rows use `div role="button"` instead of semantic `<button>` [Low]

**Files:** `SettingsWallet.tsx`, `SettingsSecurity.tsx`

Manual `onKeyDown` handling instead of native button behavior. Misses edge cases.

---

## Overall Assessment

### Rating: 8.0 / 10

The codebase is in good shape. The security architecture (Rust key store, encrypted storage, BRC-100 hardening) is solid. The layered architecture has meaningfully improved through context splitting, hook extraction, and PlatformAdapter. Test suite is substantial (1957 tests) with clean baseline.

The primary concerns are:
1. **WIF-in-JS-heap** — The incomplete migration from JS-accessible WIFs to Rust `_from_store` commands remains the largest security gap (S-126, S-131, S-132, S-133).
2. **B-121** — `handleImportJSON` leaking mnemonic into React state is the one high-priority bug.
3. **Test coverage gaps** — 1,551 lines of critical sync/orchestration logic with zero test coverage.
4. **Database architecture** — Connection pool doesn't guarantee transaction atomicity; 7 tables use runtime schema creation.

### New Issue Count: 30
- Security: 7 new (0 critical, 0 high, 3 medium, 4 low)
- Bugs: 8 new (1 high, 3 medium, 4 low)
- Architecture: 7 new (0 high, 4 medium, 3 low)
- Quality: 14 new (0 high, 6 medium, 8 low — several subsume/expand existing issues)

Note: Some new issues (Q-101 expands Q-85, Q-103 expands Q-95, Q-110 expands Q-72+Q-92) are expansions of existing findings rather than wholly new discoveries.
