# Simply Sats: iOS & Android Mobile Migration

## Context

Simply Sats is a Tauri 2 + React 19 desktop BSV wallet. The user wants to ship it on both iOS and Android. The codebase is surprisingly mobile-ready — correct crate types, mobile entry point, v2 plugins — but has two hard blockers (HTTP server, `dirs` crate) and needs a full mobile UI redesign with responsive layouts.

**Decisions made:**
- BRC-100 SDK: **Skip for v1** (disable HTTP server on mobile)
- Platforms: **Both iOS and Android**
- UI: **Full mobile redesign** (bottom tabs, bottom sheets, gestures, touch-optimized)
- Architecture: **Shared codebase** with responsive layouts via `usePlatform()` hook + CSS

**Approach**: Incremental Mobile Enablement — fix Rust blockers first, then progressively adapt the frontend. One set of components that adapts based on platform detection. ~4-6 weeks total.

---

## Phase 0: Rust Backend — Fix Mobile Blockers (3-5 days)

### 0.1 Conditionally Disable HTTP Server

**Files:** `src-tauri/src/lib.rs` (lines 752-760), top-level `mod http_server` declaration

- Wrap `std::thread::spawn(http_server::start_server(...))` in `#[cfg(not(any(target_os = "android", target_os = "ios")))]`
- Conditionally compile `mod http_server;` the same way
- `axum`/`tower-http`/`governor` deps stay compiled (linker strips dead code with LTO) — avoid Cargo.toml complexity

### 0.2 Replace `dirs` Crate with Tauri App Path API

**Files:** `src-tauri/src/lib.rs` (lines 228-230, 638-650, 660-675)

- Delete `get_app_data_dir()` function and `dirs` dependency
- Move `pre_init_database()` and `configure_database()` calls INTO the `.setup()` closure where `app.handle().path().app_data_dir()` is available
- This is safe because `tauri_plugin_sql` doesn't run migrations until first frontend DB access (after webview loads, which is after `.setup()`)
- Rate limiter integrity key also moves into `.setup()` using the same path

### 0.3 Verify Migration Checksums

**Files:** `src-tauri/migrations/fresh_install_schema.sql`

- Confirm `fresh_install_schema.sql` includes schema from migrations 22/23
- After 0.2, `pre_init_database()` runs correctly on all platforms, so checksum table is seeded properly

### 0.4 Initialize Platform Projects

```bash
npx tauri android init
npx tauri ios init
```

- Creates `src-tauri/gen/android/` and `src-tauri/gen/apple/`
- Post-init: add `INTERNET` permission to AndroidManifest, configure `Info.plist`
- Update `tauri.conf.json` deep-link mobile array: `["simplysats"]`

### 0.5 Generate Mobile Icons

```bash
npx tauri icon src-tauri/icons/icon.png
```

**Verify:** `cargo build --target aarch64-apple-ios` compiles. `npx tauri android build --debug` produces APK. `npx tauri ios build --debug` produces simulator app.

---

## Phase 1: Platform Detection & Feature Gating (2-3 days)

### 1.1 Create `usePlatform()` Hook

**New file:** `src/hooks/usePlatform.ts`

- Detects `ios` / `android` / `desktop` via user agent
- Exposes: `platform`, `isMobile`, `isDesktop`, `isIOS`, `isAndroid`, `hasTouchScreen`
- Safe area inset detection via CSS `env()` values

### 1.2 Add Platform CSS Class to Root

**File:** `src/App.tsx`

- On mount, set `data-platform="ios|android|desktop"` on `<html>`
- Enables platform-conditional CSS: `[data-platform="ios"] .app { ... }`

### 1.3 Gate BRC-100 Features on Mobile

**File:** `src/config/index.ts`

- `BRC100_SERVER: !IS_MOBILE` — disable BRC-100 HTTP features at runtime
- Simple `navigator.userAgent` check (no hook needed in config module)

**Verify:** Platform detected correctly in iOS/Android simulators.

---

## Phase 2: Core CSS Mobile Adaptation (5-7 days)

### 2.1 Fix Viewport Height

**File:** `src/App.css` (lines 54, 1341, 2087, 2174)

- Replace all `100vh` with `100dvh` (dynamic viewport height)
- Handles iOS browser chrome and notch correctly

### 2.2 Add Safe Area Insets

**Files:** `index.html`, `src/App.css`

- `index.html`: add `viewport-fit=cover` to viewport meta tag
- `.app`: add `padding-top/bottom: env(safe-area-inset-*)`
- `.header`: `padding-top: max(var(--space-2), env(safe-area-inset-top))`

### 2.3 Expand Touch Targets

**File:** `src/App.css`

- All interactive elements minimum 44x44px via `@media (pointer: coarse)`
- `.icon-btn`: expand padding so 44px is visible, not just min-height
- `.nav-tab`: min-height 48px with padding
- `.action-btn`: min-height 48px

### 2.4 Add Touch Press States

**File:** `src/App.css`

- `:active` states for all buttons (scale/opacity feedback)
- `touch-action: manipulation` on all buttons (kills 300ms delay)
- `-webkit-tap-highlight-color: transparent`
- `@media (hover: none)` to neutralize stuck hover states

### 2.5 Fix Small-Screen Overflow

**Files:** `src/App.css`, `src/components/wallet/AccountSwitcher.tsx`

- `account-dropdown`: cap at `max-width: calc(100vw - 32px)` on mobile
- Nav tabs: tighter padding on narrow screens

### 2.6 Mobile Design Tokens

**File:** `src/App.css` (or new `src/styles/mobile.css`)

- `@media (max-width: 479px)` with tighter spacing tokens
- Smaller balance font, adjusted heading sizes

**Verify:** iOS Simulator at 375px — no overflow, all buttons tappable, text readable.

---

## Phase 3: Mobile Navigation — Bottom Tab Bar (3-4 days)

### 3.1 Bottom Tab Bar Component

**Files:** `src/AppTabs.tsx`, `src/App.css`

- `AppTabNav` checks `usePlatform().isMobile`
- Desktop: existing horizontal top tabs (unchanged)
- Mobile: renders `MobileTabBar` — fixed bottom bar with icons (lucide-react)
- 5 tabs: Activity, Ordinals, Tokens, Locks, UTXOs — icon + label
- CSS: `position: fixed; bottom: 0; padding-bottom: env(safe-area-inset-bottom)`
- Content area: `padding-bottom: 56px + safe-area` to avoid tab bar overlap

### 3.2 Android Back Button

**File:** `src/App.tsx`

- Push history entry when modal opens, pop on close
- `popstate` handler closes modal instead of navigating

### 3.3 Disable Desktop Keyboard Nav on Mobile

**File:** `src/App.tsx` (existing `useKeyboardNav` call)

- Pass `enabled: !isMobile` — already supported by hook API

**Verify:** Bottom tab bar renders on simulators. Tapping tabs works. Android back button closes modals.

---

## Phase 4: Bottom Sheet Modals (4-5 days)

### 4.1 Adapt Modal Component

**File:** `src/components/shared/Modal.tsx` (86 lines, clean single wrapper)

- On mobile: render as bottom sheet (slides up from bottom)
- Add `.modal-handle` drag indicator at top
- `border-radius: 16px 16px 0 0`, `max-height: 90dvh`
- `animation: slideUp 0.3s ease-out`
- `padding-bottom: env(safe-area-inset-bottom)`
- Desktop: unchanged

### 4.2 Swipe-to-Dismiss Hook

**New file:** `src/hooks/useSwipeDismiss.ts`

- Track `touchstart` Y → `touchmove` delta → apply `transform: translateY()`
- On `touchend`: if delta > 150px, dismiss; else spring back
- Wire into Modal when `isMobile`

### 4.3 Audit Individual Modals

- **SendModal**: needs `overflow-y: auto` on content for scroll in bottom sheet
- **SettingsModal**: same scroll treatment
- **MnemonicModal**: verify word grid wraps at narrow widths
- Most modals need zero changes since they just render inside `<Modal>`

**Verify:** Every modal slides up from bottom on mobile, is scrollable, swipe-to-dismiss works.

---

## Phase 5: Touch Gestures & Mobile UX (3-4 days)

### 5.1 Pull-to-Refresh

**New file:** `src/hooks/usePullToRefresh.ts`

- Detects overscroll at content top → shows pull indicator → triggers sync
- Wire into `AppTabContent` activity tab

### 5.2 Haptic Feedback

**New file:** `src/utils/haptics.ts`

- `hapticTap()`, `hapticSuccess()` using Web Vibration API
- Add to: tab switch, send confirmation, address copy

### 5.3 Document Biometric Unlock as v1.1

- Tauri has `tauri-plugin-biometric` (Face ID / Touch ID / Android BiometricPrompt)
- Skip for v1, document as first v1.1 feature

**Verify:** Pull-to-refresh works on activity tab. Haptics fire on interactions.

---

## Phase 6: Mobile Config & Capabilities (2-3 days)

### 6.1 Mobile Capabilities File

**New file:** `src-tauri/capabilities/mobile.json`

- Platform-scoped permissions for iOS/Android
- Exclude desktop-only permissions (`dialog:allow-save` for arbitrary paths)

### 6.2 Deep Link Setup

**Files:** `tauri.conf.json`, `AndroidManifest.xml`, `Info.plist`

- Register `simplysats://` scheme on both platforms
- Existing `src/services/deeplink.ts` handler works as-is

### 6.3 Update CSP

**File:** `tauri.conf.json`

- `http://localhost:3322` in CSP is harmless on mobile (nothing binds), leave it

---

## Phase 7: Build Pipeline (2-3 days)

### 7.1 NPM Scripts

**File:** `package.json`

- Add `android:dev`, `android:build`, `ios:dev`, `ios:build` scripts

### 7.2 Signing

- **iOS:** Configure in Xcode project (`src-tauri/gen/apple/`) — requires Apple Developer account
- **Android:** Generate keystore, configure in `build.gradle.kts`

### 7.3 CI (GitHub Actions)

**New file:** `.github/workflows/mobile-build.yml`

- Android debug APK on every PR
- iOS simulator build on every PR (macOS runner)
- Release builds on tag push

---

## Phase 8: Testing (ongoing, 3-5 days)

### Existing Tests
- All 657 Vitest tests remain valid — run after every phase

### New Tests
- `usePlatform()` — mock user agents for each platform
- `useSwipeDismiss()` — mock touch events
- `usePullToRefresh()` — mock overscroll
- `Modal` bottom sheet rendering when mobile
- Feature flag gating

### Device Testing Checklist
- iPhone SE (375px) — small screen baseline
- iPhone 15 Pro (393px) — Dynamic Island/notch
- Pixel 7 (412px) — Android baseline
- Samsung Galaxy S24 (360px) — narrow Android

---

## Critical Files Summary

| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | HTTP server gating, `dirs` removal, DB init restructuring |
| `src/components/shared/Modal.tsx` | Bottom sheet on mobile (transforms all 28 modals) |
| `src/App.css` | Viewport fixes, safe areas, touch targets, bottom tab bar, bottom sheets |
| `src/AppTabs.tsx` | Bottom tab bar on mobile |
| `src/App.tsx` | Platform class, back button, disable keyboard nav |
| `src/config/index.ts` | BRC-100 feature gate |
| `src-tauri/tauri.conf.json` | Deep link mobile schemes |
| `src-tauri/Cargo.toml` | Remove `dirs` dep |

## New Files

| File | Purpose |
|------|---------|
| `src/hooks/usePlatform.ts` | Platform detection hook |
| `src/hooks/useSwipeDismiss.ts` | Bottom sheet swipe gesture |
| `src/hooks/usePullToRefresh.ts` | Pull-to-refresh gesture |
| `src/utils/haptics.ts` | Haptic feedback utilities |
| `src-tauri/capabilities/mobile.json` | Mobile permission scoping |
| `.github/workflows/mobile-build.yml` | CI for mobile builds |

## Estimated Timeline

| Phase | Effort | Depends On |
|-------|--------|------------|
| Phase 0: Rust Blockers | 3-5 days | — |
| Phase 1: Platform Detection | 2-3 days | Phase 0 |
| Phase 2: CSS Adaptation | 5-7 days | Phase 1 |
| Phase 3: Bottom Tab Bar | 3-4 days | Phases 1-2 |
| Phase 4: Bottom Sheet Modals | 4-5 days | Phases 1-2 |
| Phase 5: Touch Gestures | 3-4 days | Phases 2-4 |
| Phase 6: Mobile Config | 2-3 days | Phase 0 (parallel w/ frontend) |
| Phase 7: Build Pipeline | 2-3 days | Phases 0, 6 |
| Phase 8: Testing | 3-5 days | All (ongoing) |
| **Total** | **~4-6 weeks** | |

## Risks

1. **Tauri mobile maturity** — GA since Aug 2024, some plugins may have edge cases. Mitigate: test each plugin after Phase 0.
2. **WebView differences** — WKWebView (iOS) vs Chromium WebView (Android). Test both early.
3. **iOS App Store review** — Apple scrutinizes web-wrapper apps. Simply Sats has substantial Rust backend (crypto, tx building, secure storage) which should satisfy requirements.
4. **sql.js WASM memory** — tighter limits on mobile. Monitor during sync operations.

## Verification Strategy

After each phase:
1. `npm run test:run` — all 657 tests pass
2. `npm run typecheck` — no TypeScript errors
3. `npm run lint` — no ESLint errors
4. `npx tauri android dev` — test on Android emulator
5. `npx tauri ios dev` — test on iOS Simulator
6. Visual check on iPhone SE (375px) and Pixel 7 (412px) viewports
