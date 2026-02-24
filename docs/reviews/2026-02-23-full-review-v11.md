# Simply Sats — Full Review v11 (Review #14)
**Date:** 2026-02-23
**Focus:** UI/UX Polish
**Rating:** 9.8 / 10 (up from 9.7)
**Findings:** 16 new (4 high, 7 medium, 5 low) — all 16 fixed
**Cumulative:** 136 total issues tracked, 135 fixed (1 accepted risk, 1 backlog)

---

## Pre-Review Baseline

- **TypeScript:** 0 errors (`npm run typecheck`)
- **ESLint:** 0 errors, 55 warnings (all `no-restricted-imports` — tracked as A-16 backlog)
- **Tests:** 1670/1670 passing
- **Previous rating:** 9.7/10 after 13 reviews, 120 issues (119 fixed)

---

## Review Scope

This review focused exclusively on **UI/UX polish**: visual consistency, accessibility, keyboard navigation, design token alignment, screen reader support, and animation. No security, architecture, or bug-hunting phases — those areas are clean from prior reviews.

---

## Phase 1: Structural UX Gaps (HIGH)

### U-25 — Three modals bypass shared Modal component
**Files:** `ConsolidateModal.tsx`, `TestRecoveryModal.tsx`, `UnlockConfirmModal.tsx`
**Issue:** These modals manually built `<div className="modal-overlay"><div className="modal">` with hand-rolled close buttons, missing the focus trap, ESC handling, body scroll lock, and ARIA attributes provided by the shared `Modal` component (`src/components/shared/Modal.tsx`).
**Fix:** Migrated all 3 to `<Modal onClose={...} title={...}>`. Extracted 53 inline `style={{}}` props to CSS classes during migration.

### U-26 — SimplySatsLogo invisible on dark backgrounds
**File:** `SimplySatsLogo.tsx`
**Issue:** The SVG used hardcoded `stroke="#000"` and `fill="#000"` in 4 locations, making the logo invisible on dark backgrounds.
**Fix:** Replaced all with `currentColor`, inheriting from parent CSS color.

### U-27 — Toast dismiss button inaccessible to keyboard users
**Files:** `Toast.tsx`, `App.css`
**Issue:** The dismiss button was only rendered on mouse hover via `hoveredId` state, meaning keyboard-only users could never dismiss non-error toasts.
**Fix:** Dismiss button is now always in the DOM. CSS `opacity: 0` hides it by default; `:hover`, `:focus-within`, and `:focus-visible` selectors reveal it.

### U-28 — Toast progressive disclosure
**Files:** `Toast.tsx`, `App.css`
**Issue:** Related to U-27 — the original hover-only pattern was trying to achieve progressive disclosure but broke keyboard access.
**Fix:** Achieved with pure CSS: `.toast-dismiss { opacity: 0; transition: opacity 150ms }` + `.copy-toast:hover .toast-dismiss, .copy-toast:focus-within .toast-dismiss { opacity: 1 }`.

---

## Phase 2: Visual Consistency (MEDIUM)

### U-29 — Hardcoded hex colors instead of design tokens
**Files:** `OrdinalListModal.tsx:108`, `BackupVerificationModal.tsx:261`, `AccountCreateForm.tsx:49-50`
**Issue:** `color="#22c55e"` used directly instead of `var(--success)` design token.
**Fix:** Replaced all 5 locations with `var(--success)`.

### U-30 — Excessive inline styles in modal components
**Files:** `ConsolidateModal.tsx` (27), `TestRecoveryModal.tsx` (20), `UnlockConfirmModal.tsx` (6)
**Issue:** 53 inline `style={{}}` props across 3 modal files, making styles impossible to override and inconsistent with the CSS-first approach used elsewhere.
**Fix:** Extracted to named CSS classes: `.result-icon-circle`, `.result-icon-circle.success`/`.error`, `.result-title`, `.result-message`, `.result-address-block`, `.modal-actions`, `.consolidate-summary-row`, `.consolidate-divider`, `.consolidate-info-box`.

### U-31 — Embedded `<style>` blocks in components
**Files:** `MnemonicInput.tsx` (~150 lines), `AccountModal.tsx` (~225 lines)
**Issue:** Large embedded `<style>` blocks duplicating/conflicting with App.css rules. In particular, MnemonicInput had hardcoded values where App.css already used design tokens.
**Fix:** Moved all styles to App.css. When conflicts existed (e.g., hardcoded `14px` in embedded vs `var(--type-body-size)` in App.css), kept the token-based version.

### U-32 — No `:active` press feedback on settings rows
**File:** `App.css`
**Issue:** Settings rows had hover state but no press feedback, making taps feel unresponsive.
**Fix:** Added `transform: scale(0.995)` to the existing `.settings-row:active` rule.

### U-33 — Hardcoded font sizes bypass type scale
**File:** `App.css`
**Issue:** `.balance-unit` used `18px` and `.nav-tab` used `12px` instead of design tokens.
**Fix:** Replaced with `var(--type-h3-size)` (17px) and `var(--type-caption-size)` (12px). The 1px difference for balance-unit is imperceptible and maintains token consistency.

### U-34 — Duplicate `.empty-state` CSS rule
**File:** `App.css`
**Issue:** Two separate `.empty-state` rules with overlapping properties.
**Fix:** Merged into a single consolidated rule.

### U-35 — `onItemSelect` double-fire in useModalKeyboard
**File:** `useModalKeyboard.ts`
**Issue:** A `useEffect` watching `selectedIndex` called `onItemSelect` on every arrow key navigation. Combined with the explicit `onItemSelect` call on Enter/click, this caused double-fire. Per the ARIA listbox spec, arrow keys should only change highlight; selection should only fire on Enter or click.
**Fix:** Removed the offending `useEffect`. `onItemSelect` now only fires from Enter key handler and click handler.

---

## Phase 3: Polish (LOW)

### U-36 — Password toggle button not keyboard accessible
**File:** `PasswordInput.tsx:62`
**Issue:** `tabIndex={-1}` on the visibility toggle button meant keyboard users couldn't reach it.
**Fix:** Changed to `tabIndex={0}`.

### U-37 — Connected apps disconnect buttons lack differentiated aria-labels
**File:** `SettingsConnectedApps.tsx:21`
**Issue:** All disconnect buttons had the same generic label, making them indistinguishable for screen reader users.
**Fix:** Added `aria-label={`Disconnect ${app}`}` with the app name.

### U-38 — Screen reader announcements not connected
**File:** `WalletContext.tsx`
**Issue:** The `useAnnounce` hook and `ScreenReaderAnnounceProvider` were fully implemented but never called for any state changes.
**Fix:** Added announcements for wallet lock/unlock state changes and account switching using `announceRef` pattern to avoid dependency cycles.

### U-39 — No warning before auto-lock
**Files:** `autoLock.ts`, `WalletContext.tsx`
**Issue:** The wallet auto-locked after inactivity with zero warning, potentially interrupting in-progress work.
**Fix:** Added `onWarning` callback to `initAutoLock()` that fires 30 seconds before lock. Connected in WalletContext to show a warning toast. The warning fires once per inactivity cycle and resets on user activity.

### U-40 — Settings select/input elements use inline styles
**Files:** `SettingsNetwork.tsx`, `SettingsTransactions.tsx`
**Issue:** Network select and fee rate input used 7-line inline style objects instead of CSS classes.
**Fix:** Extracted to `.settings-inline-select`, `.settings-inline-input`, and `.settings-hint-text` CSS classes in App.css.

---

## Post-Implementation Verification

After all 5 implementation batches:
- **TypeScript:** 0 errors
- **ESLint:** 0 errors, 55 warnings (unchanged — all pre-existing `no-restricted-imports`)
- **Tests:** 1670/1670 passing (1 test updated for new Toast behavior)

---

## Cumulative Health

| Metric | Value |
|--------|-------|
| Overall Rating | 9.8 / 10 |
| Total Issues Tracked | 136 |
| Fixed/Verified | 135 |
| Open Critical/High | 0 |
| Open Medium | 1 (A-16 backlog: lint warnings) |
| Accepted Risk | 1 (S-17: SENSITIVE_KEYS empty) |
| Test Count | 1670 |
| Lint Errors | 0 |
| Type Errors | 0 |

The codebase is at its highest polish level. All modals now use the shared Modal component for consistent behavior. Design tokens are used throughout. Screen reader support is connected. Keyboard navigation works everywhere. The only remaining open item is the A-16 backlog of `no-restricted-imports` lint warnings, which is a large refactoring effort tracked for a future sprint.
