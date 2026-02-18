# Simply Sats — Full Review #10 (v7)
**Date:** 2026-02-17
**Focus:** UX/UI Polish & Stability
**Rating:** 9.0 / 10
**Baseline:** 0 lint errors, 0 type errors, 1615 tests passing (pre-review)
**Post-fix:** 0 lint errors, 0 type errors, 1625 tests passing

---

## Review Scope

Review #10 was requested with a specific focus on **UX/UI polish** (top-of-the-line usability and presentation) and **stability** (error handling, race conditions, data integrity). Previous reviews (#1-#9) addressed security, bugs, architecture, and code quality — 60 issues found, 59 fixed, 1 accepted risk.

This review examined all 51 UI components, 7 context providers, 5 hooks, and the CSS design system.

---

## Phase 1: UX/UI Polish Audit

### Critical Visual Bug — U-1
`ReceiveModal.tsx:247-248` used `var(--primary)` and `var(--primary-bg)` — CSS custom properties that **do not exist** in the design token system. The correct tokens are `--accent` and `--accent-subtle`. This caused the contact selection chips in the BRC-100 "Private" receive flow to appear unstyled when selected (no visible border or background change).

**Fix:** Two-line change replacing the token names.

### Design System Isolation — U-3
`SpeedBumpModal.tsx` was the only component in the entire app with an embedded `<style>` tag (140 lines of CSS). It defined its own button classes (`.primary-button`, `.secondary-button`) instead of using the shared `.btn` system from `App.css`. This meant:
- Theme changes didn't propagate to SpeedBumpModal
- Button styling was visually inconsistent with every other modal
- CSS was injected into the DOM on every render

**Fix:** Removed the embedded `<style>`, switched buttons to `.btn .btn-primary`/`.btn-secondary`/`.btn-danger`, moved remaining styles to `App.css`. Component went from 337 to 197 lines.

### Inline Style Overuse — U-5
`ReceiveModal.tsx` had 29 inline `style={{}}` props — the most of any component by far. Every other component uses CSS classes. These inline styles:
- Made the component impossible to theme
- Couldn't benefit from design token updates
- Were inconsistent with the rest of the codebase

**Fix:** All 29 inline styles extracted to CSS classes in `App.css` under a `.receive-*` namespace. Contact chip active/hover states moved from conditional inline styles to proper CSS classes with transitions.

### Semantic Color Error — U-2
`SendModal.tsx:407` rendered `sendError` with `className="warning compact"` (amber/yellow). A send failure is an error, not a warning. The existing `.warning.error` CSS variant (red) was already defined but unused here.

**Fix:** Changed to `className="warning error compact"`.

### Emoji Inconsistency — U-4
`SendModal.tsx:382-384` used `🎯` and `⚙️` emoji in coin control buttons — the only emoji in the entire UI. Every other button uses lucide-react icons. Screen readers announce emoji names (e.g., "direct hit" for 🎯), which is confusing.

**Fix:** Replaced with `<Crosshair>` and `<Settings>` lucide-react icons.

### Dead Code — U-7
`FeeEstimation.tsx:60-65` had a function with 4 conditional branches that all returned `'~10 seconds'`. The multi-branch structure implied fee rate affects BSV confirmation time (it doesn't). The label was misleading.

**Fix:** Collapsed to single `return 'Near-instant'`.

### Other Polish
- **U-8:** Loading screen was blank with just a spinner. Added `SimplySatsLogo`.
- **U-9:** Empty state titles had inconsistent casing. Standardized to Title Case.
- **U-10:** Lock screen placeholder "Enter password (or leave blank)" changed to "Enter your password".
- **U-11:** Raw Unicode `✕` in backup dismiss button replaced with `<X>` icon.
- **ST-7:** Dead CSS `prefers-reduced-motion` rule targeting nonexistent `.tab-content` removed.

---

## Phase 2: Stability Audit

### Token Send Race Condition — ST-1 (Critical)
`TokensContext.tsx:81-114` — `sendTokenAction` called `sendToken` without acquiring the sync lock. Both `sendBSV` and `sendBSVMultiKey` use `acquireSyncLock` to prevent concurrent UTXO modifications. Without the lock, a concurrent `performSync` could modify the UTXO table during a token send, potentially causing:
- Stale UTXO selection (sending from already-spent outputs)
- Double-spend attempts

**Fix:** Wrapped `sendTokenAction` body with `acquireSyncLock()`/`releaseLock()` in try/finally.

### Inconsistent Error Handling — ST-3
`transactions.ts:432` — `consolidateUtxos` called `executeBroadcast` without a try/catch, unlike `sendBSV` (line 243) and `sendBSVMultiKey` (line 390) which both wrap `executeBroadcast`. If broadcast+rollback both failed, the error would propagate as a thrown exception instead of `err(AppError)`, inconsistent with the Result pattern.

**Fix:** Added try/catch returning `err(AppError.fromUnknown(broadcastError, ErrorCodes.BROADCAST_FAILED))`.

### Double-Send Race Window — ST-5
`SendModal.tsx:107-116` — The `sending` state flag was set inside `executeSend()` (line 120), not at the start of `handleSubmitClick()` (line 107). A rapid double-click before React re-renders and disables the button could trigger two sends.

**Fix:** Added `sendingRef` (useRef) set synchronously at the top of both functions, with proper cleanup in a finally block.

### Remaining Stability Items (not fixed)
- **ST-4:** No `AbortController` for cancelled network requests. All API calls to WhatsOnChain/GorillaPool proceed to completion even after `isCancelled()`. Only a bandwidth concern, not a correctness issue.
- **ST-6:** `performSync` has no cancellation mechanism. Unlike `fetchData` which checks `isCancelled()`, `performSync` runs DB writes to completion even after account switch.

### False Positive — ST-2
The stability agent reported that `SyncContext.fetchData` sets balance before the `isCancelled()` check. Manual verification proved this incorrect — line 264 (`if (isCancelled?.()) return`) runs before line 268 (`setBalance(totalBalance)`). The ordering is correct. Dropped from findings.

---

## Phase 3: Architecture & Code Quality

No new architecture or code quality issues found. The codebase is well-structured:
- Layered architecture (Components → Hooks → Contexts → Services → Domain/Infrastructure) is consistently followed
- Result<T,E> migration is complete across all service and DB layers
- Error boundaries wrap all context providers
- ESLint rules enforce import discipline

The only architectural observation is that 54 `no-restricted-imports` lint warnings remain — these are tracked and being cleaned up incrementally (A-1).

---

## Files Changed in Review #10

| File | Lines Changed | Issues Fixed |
|------|--------------|-------------|
| `src/App.css` | +268/-5 | U-3, U-5, ST-7 |
| `src/App.tsx` | +6/-3 | U-8, U-11 |
| `src/components/modals/LockScreenModal.tsx` | +1/-1 | U-10 |
| `src/components/modals/ReceiveModal.tsx` | +30/-77 | U-1, U-5 |
| `src/components/modals/SendModal.tsx` | +28/-16 | U-2, U-4, ST-5 |
| `src/components/shared/EmptyState.tsx` | +4/-4 | U-9 |
| `src/components/shared/EmptyState.test.tsx` | +3/-3 | U-9 (test update) |
| `src/components/shared/FeeEstimation.tsx` | +4/-6 | U-7 |
| `src/components/shared/SpeedBumpModal.tsx` | +6/-146 | U-3 |
| `src/contexts/TokensContext.tsx` | +4/-0 | ST-1 |
| `src/services/wallet/transactions.ts` | +5/-2 | ST-3 |

**Total:** +343 insertions, -238 deletions across 11 files.
**Net:** -140 lines of CSS removed from SpeedBumpModal, +268 lines properly organized in App.css.

---

## Verification

Post-implementation verification (all commands run fresh, output confirmed):
- `npm run typecheck`: 0 errors
- `npm run lint`: 0 errors (54 pre-existing warnings)
- `npm run test:run`: 66/66 test files, 1625/1625 tests passed
- `npm run build`: 4 pre-existing errors in `tsc -b` mode (confirmed identical on clean main)
