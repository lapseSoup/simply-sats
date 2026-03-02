# Simply Sats — Full Review v20
**Date:** 2026-03-02
**Rating:** 8.5 / 10
**Scope:** 4 commits since v19 (~1,154 new lines, 13 files)
**Tests:** 1762 passing (16 new), 0 lint errors, 0 type errors

## Commits Reviewed

| Commit | Description |
|--------|-------------|
| `7e9a747` | feat: redesign Send BSV modal with fee selector, address book, and QR scanner |
| `f2fb100` | fix: style account create form — label/input no longer overlap |
| `3627ac5` | Merge branch 'claude/awesome-grothendieck' |
| `26dc3ae` | Merge branch 'claude/kind-hawking' |

## New Files

| File | Lines | Purpose |
|------|-------|---------|
| `QRScannerModal.tsx` | 403 | QR code scanning via camera or image upload |
| `AddressPicker.tsx` | 263 | Dropdown for saved/recent BSV addresses |
| `addressBookRepository.ts` | 175 | CRUD for address book with Result pattern |
| `026_address_book.sql` | 14 | Migration creating address_book table |
| `SendModal.test.tsx` | 208 | Tests for SendModal component |

## Pre-Review Baseline

- `npm run lint`: 0 errors, 55 warnings (all pre-existing `no-restricted-imports`)
- `npm run typecheck`: clean
- `npm run test:run`: 1746 tests passing

---

## Phase 1: Security Audit

### S-77 (Critical) — Address Book UNIQUE Constraint Bug
**File:** `src-tauri/migrations/026_address_book.sql:6`

The address_book table had `address TEXT NOT NULL UNIQUE` — a UNIQUE constraint on address alone rather than the compound `(address, account_id)`. Impact:
- Account 1 sends to address X → saved with `account_id = 1`
- Account 2 sends to same address X → `ON CONFLICT` fires, increments `use_count` but keeps `account_id = 1`
- Account 2 never sees the address in their book (filtered by `WHERE account_id = $1`)
- Cross-account data leak: account 1 sees elevated `use_count` from account 2's activity

**Fix:** Created migration `027_address_book_fix_unique.sql` using the rename-recreate-copy pattern (matching migrations 009, 022). Updated `fresh_install_schema.sql` and `ensureAddressBookTable()` to use `UNIQUE(address, account_id)`. Changed `ON CONFLICT(address)` to `ON CONFLICT(address, account_id)` in `saveAddress()`.

### S-78 (High) — Zero-Value Send Not Prevented
**File:** `src/components/modals/SendModal.tsx:597`

Button disabled condition was: `sending || !sendAddress || !sendAmount || !!addressError || sendSats + fee > availableSats`

Missing `sendSats > 0` check. User could enter amount "0" and send a transaction that burns fee for nothing.

**Fix:** Added `sendSats <= 0` to disabled condition.

### S-79 (High) — NaN Amount Silently Becomes 0
**File:** `src/components/modals/SendModal.tsx:85-88`

`parseFloat('abc')` → NaN → silently converted to 0 via `Number.isNaN(rawSendSats) ? 0 : rawSendSats`. No user-visible feedback that the amount is invalid.

**Fix:** Added computed `amountError` that shows "Enter a valid amount" when input is non-numeric or negative. Rendered as `<div className="form-error">` below the amount input.

### S-80 (Medium) — account_id Fallback to 0
**File:** `src/components/modals/SendModal.tsx:144,339`

`activeAccountId ?? 0` used in two places. Account IDs start at 1, never 0. Fallback would save addresses to a phantom account.

**Fix:** `recordSentAddress` now returns early if `!activeAccountId`. AddressPicker fallback changed to `1` (minimum valid account).

### S-81 (Medium) — saveAddress Result Ignored
**File:** `src/components/modals/SendModal.tsx:145`

`await saveAddress(address, '', acctId)` with no error handling. Silent failure if DB write fails.

**Fix:** Check `result.ok`, log warning on failure: `console.warn('Failed to save address to book:', result.error.message)`.

### S-82 (Medium) — addressExists Swallows Errors
**File:** `src/infrastructure/database/addressBookRepository.ts:172`

`catch (_e) { return false }` — DB errors indistinguishable from "address not found".

**Fix:** Changed return type to `Result<boolean, DbError>`. Updated test mock accordingly.

### S-83 (Low — Noted) — No Address Validation at DB Layer
**File:** `addressBookRepository.ts:97,124,145,163`

Repository functions accept any string as address. Defense-in-depth only — all callers validate with `isValidBSVAddress()` before calling.

---

## Phase 2: Bug Detection

### B-76 (Medium) — Multi-Recipient NaN/Zero Amounts
**File:** `src/components/modals/SendModal.tsx:256-261`

`handleMultiSubmitClick` validated addresses but not amounts. `executeSendMulti` parsed amounts with `parseFloat(r.amount || '0')` — NaN becomes 0, no per-recipient validation.

**Fix:** Added amount validation loop in `handleMultiSubmitClick` (checks parsed > 0, not NaN). Added NaN guard in `executeSendMulti` amount parsing.

### B-77 (Medium) — Test Mock Path Mismatch
**File:** `src/components/modals/SendModal.test.tsx:56-59`

Test mocked `../../services/wallet` but component imports from `../../adapters/walletAdapter`. Mock didn't intercept actual imports, so fee calculation was unmocked.

**Fix:** Changed mock path to `../../adapters/walletAdapter`. Added missing exports: `calculateMaxSend`, `P2PKH_INPUT_SIZE`, `P2PKH_OUTPUT_SIZE`, `TX_OVERHEAD`.

### B-78 (Low — Noted) — Fee Fallback Heuristic
**File:** `SendModal.tsx:98`

`Math.max(1, Math.ceil(balance / 10000))` overestimates inputs for large balances. Only used briefly before UTXOs load.

### B-79 (Low — Noted) — QR Container ID Collision
**File:** `QRScannerModal.tsx:15`

Hardcoded `'qr-scanner-container'` ID. Single modal design prevents collision.

---

## Phase 3: Architecture Review

### A-37 (Medium) — 54 Inline Styles
**Files:** SendModal (25), QRScannerModal (19), AddressPicker (10)

New components used extensive inline styles instead of CSS classes, inconsistent with codebase convention.

**Fix:** Extracted to 13 CSS classes:
- QR Scanner: `.qr-tab-switcher`, `.qr-tab-btn`, `.qr-tab-btn.active`, `.qr-scanner-container`, `.qr-scanner-hint`, `.qr-upload-area`, `.qr-permission-denied`
- Address Picker: `.address-picker-dropdown`, `.address-picker-section-label`, `.address-picker-divider`, `.address-picker-row`, `.address-picker-empty`

Removed `isHovered` state management from AddressRow (CSS `:hover` handles it).

### A-38 (Low) — Hardcoded Shadows
**Files:** QRScannerModal, AddressPicker

Replaced `rgba(0,0,0,0.1)` and `rgba(0,0,0,0.15)` with `var(--shadow-xs)` and `var(--shadow-md)` design tokens (already defined in `design-tokens.css`).

### A-39 (Low) — Account Modal Focus Ring
**File:** `src/App.css`

`.account-modal-content .form-group input:focus` had `border-color` but no `box-shadow` ring, unlike all other form inputs.

**Fix:** Added `box-shadow: 0 0 0 3px var(--accent-subtle)`.

---

## Phase 4: Code Quality

### Q-59 (Medium) — Thin SendModal Test Coverage
**File:** `src/components/modals/SendModal.test.tsx`

Tests only covered happy path. No edge cases for amount validation.

**Fix:** Added 4 tests:
1. Zero amount → button disabled
2. Negative amount → button disabled
3. Non-numeric "abc" → button disabled
4. Amount exceeding balance → button disabled

### Q-60 (Medium) — No addressBookRepository Tests
**File:** `src/infrastructure/database/addressBookRepository.test.ts` (new)

175-line repository had zero test coverage.

**Fix:** Created 12-test suite:
- `saveAddress` — success + error
- `getAddressBook` — returns entries + error
- `getRecentAddresses` — respects limit
- `updateAddressLabel` — success
- `deleteAddress` — success
- `addressExists` — true, false, error (returns Result, not swallowed)
- `ensureAddressBookTable` — success + error

### Q-61 (Low) — Duplicate Tab Button Styles
**File:** QRScannerModal.tsx

Camera and Upload tab buttons had nearly identical ~15-property inline style objects.

**Fix:** Extracted to `.qr-tab-btn` and `.qr-tab-btn.active` CSS classes.

### Q-62 (Low) — ensureAddressBookTable Error Propagation
**File:** addressBookRepository.ts:46-48

Logged error but returned `void` — caller couldn't know table creation failed.

**Fix:** Returns `Result<void, DbError>` with proper error wrapping.

---

## Post-Review Verification

| Check | Result |
|-------|--------|
| `npm run lint` | 0 errors, 55 warnings (pre-existing) |
| `npm run typecheck` | clean |
| `npm run test:run` | 1762 tests passing (73 files) |
| Migration 027 | Creates compound unique, copies data, drops old table |
| Fresh install schema | Matches final state after all migrations |
| New tests | 16 new (4 SendModal + 12 addressBookRepository) |

## Overall Assessment

The Send modal redesign is well-structured with proper use of the shared Modal component, good accessibility (aria attributes, keyboard handlers, role attributes), and solid domain separation (fee calculation delegated to adapter, validation in hooks). The QR scanner handles camera permissions gracefully with a fallback upload path.

The address book repository follows the Result pattern properly (an improvement over older repositories) and uses parameterized queries throughout.

The main gaps were: the critical schema design bug (UNIQUE on address alone), missing input validation for edge cases (zero/NaN amounts), and the inline style proliferation. All have been addressed.

**Rating: 8.5 / 10** — Maintained from v19. New code is solid, schema bug was caught before production impact, test coverage improved.
