# Review Remediation — Design

**Date:** 2026-02-17
**Scope:** Implement all actionable items from the comprehensive code review.

## Tier 1: Quick Fixes
- BUG-6: syncAddress zero-UTXO sweep guard
- BUG-7: useBrc100Handler isTrustedOrigin ref
- BUG-9: LocksContext handleUnlock state ordering
- BUG-10: UIContext toggleTheme callback
- ARCH-4: Error Boundary around AppProviders
- QUAL-10: Remove dead useNetworkStatus hook
- SEC-13: Expand common password list

## Tier 2: Medium Refactors (TypeScript)
- SEC-1: BRC-100 coin selection via domain layer
- QUAL-1: React.memo on key components
- QUAL-2: Incremental tx history sync
- ARCH-1: Result<T,E> migration in services

## Tier 3: Rust Changes
- SEC-5: Rust-side signing for lock/unlock/token ops
- SEC-9: Random HMAC key for rate limiter
- SEC-11: Remove get_mnemonic command
- BUG-8: CSRF nonce on getPublicKey

## Deferred
- SEC-6: SQLite encryption (needs SQLCipher)
- ARCH-2: Offline broadcast queue (new subsystem)
