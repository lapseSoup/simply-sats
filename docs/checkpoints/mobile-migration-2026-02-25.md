# Checkpoint: Mobile Migration (iOS & Android)
**Date:** 2026-02-25
**Branch:** `feature/mobile-ios-android`
**Phase:** Completing Phase 2, starting Phase 3

## Completed
- [x] Phase 0.1: HTTP server conditionally disabled on mobile (`#[cfg]` in lib.rs)
- [x] Phase 0.2: Mobile DB init in setup() using Tauri path resolver
- [x] Phase 0.3: Migration checksums verified (fresh_install_schema.sql has all 25)
- [x] Phase 0.4: iOS platform project initialized (gen/apple/), Android needs SDK
- [x] Phase 0.5: Mobile icons generated (iOS 18 sizes, Android 15 sizes)
- [x] Phase 1.1: usePlatform() hook created (module-level singleton)
- [x] Phase 1.2: data-platform CSS class on html root, keyboard nav disabled on mobile
- [x] Phase 1.3: BRC-100 feature flag gated (FEATURES.BRC100_SERVER: !IS_MOBILE)
- [x] Phase 2.1: All 100vh replaced with 100dvh (4 occurrences)
- [x] Phase 2.2: Safe area insets (viewport-fit=cover, env() padding)
- [x] Phase 2.3: Touch targets expanded (44px min via @media pointer:coarse)
- [x] Phase 2.4: Touch press states (:active, hover:none neutralization)
- [x] Phase 2.5: Account dropdown overflow fix for narrow screens
- [x] Phase 2.6: Mobile design tokens (tighter spacing @media max-width:479px)
- [x] Design doc saved: docs/plans/2026-02-24-mobile-ios-android-design.md
- [x] Deep-link mobile scheme registered: "simplysats"
- [x] Mobile build scripts added to package.json

## In Progress
- [ ] Phase 3: Bottom Tab Bar (AppTabs.tsx)
- [ ] Phase 4: Bottom Sheet Modals (Modal.tsx)

## Pending
- [ ] Phase 5: Touch Gestures (pull-to-refresh, haptics)
- [ ] Phase 6: Mobile Config & Capabilities
- [ ] Phase 7: Build Pipeline & CI
- [ ] Phase 8: Testing

## Key Files Modified
- `src-tauri/src/lib.rs` — HTTP server cfg gate, mobile DB init
- `src-tauri/tauri.conf.json` — deep-link mobile scheme
- `src/hooks/usePlatform.ts` — NEW: platform detection
- `src/hooks/index.ts` — barrel export for usePlatform
- `src/App.tsx` — platform class, keyboard nav gating
- `src/config/index.ts` — IS_MOBILE, BRC100_SERVER feature flag
- `src/App.css` — 100dvh, safe areas, touch targets, press states, mobile tokens
- `index.html` — viewport-fit=cover
- `package.json` — mobile build scripts

## Verification Status
- All 1,749 tests pass
- TypeScript: clean
- ESLint: 0 errors
- Rust cargo check: clean (desktop + aarch64-apple-ios)

## Next Steps
1. Phase 3: Create MobileTabBar component in AppTabs.tsx with bottom fixed nav
2. Phase 3: Android back button handling in App.tsx
3. Phase 4: Convert Modal.tsx to bottom sheet on mobile
4. Phase 4: Create useSwipeDismiss.ts hook
5. After 3+4: Run full verification suite
