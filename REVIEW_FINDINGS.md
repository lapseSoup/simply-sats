# Simply Sats Post-Migration Code Review

**Date:** 2026-02-10
**Reviewer:** Claude Opus 4.6
**Codebase:** Simply Sats BSV Wallet v0.1.0 — post Rust migration (commit `833594e`)
**Stack:** Tauri 2 + React 19 + TypeScript 5.9 + Vite 7 + Rust backend
**Baseline:** 0 type errors, 0 lint errors, 814/814 tests passing
**Previous Review:** 54 findings (7.5/10) — all remediated

---

## Overall Health Rating: 7/10

The Rust migration is architecturally sound — crypto operations now run in native memory, the TS fallback path is preserved for dev/tests, and the wire format is byte-compatible with Web Crypto. Critical gaps: secret material never zeroed from Rust memory, sighash lacks test vectors, ECDH has a panic path, Tauri IPC has no timeout, and 5 signing tests are skipped due to a real bug.

**Totals:** 27 findings (2 CRITICAL, 7 HIGH, 12 MEDIUM, 6 LOW)

---

## Phase 1: Security (12 findings)

### CRITICAL (2)

| ID | Issue | File:Line | Fix | Effort |
|----|-------|-----------|-----|--------|
| S1 | ECDH `.expect()` panic on invalid scalar — crashes app, may leak secrets in stack trace | `brc100_signing.rs:163` | Replace with `map_err()?` | Quick fix |
| S2 | Secret material never zeroed — private keys, mnemonics, passwords, seeds remain in Rust stack/heap memory after use | `crypto.rs:43-47`, `key_derivation.rs:166-205`, `transaction.rs:107-130`, `brc100_signing.rs:23-46` | Add `zeroize` crate; implement `Drop` on `WalletKeys` | Medium |

### HIGH (4)

| ID | Issue | File:Line | Fix | Effort |
|----|-------|-----------|-----|--------|
| S3 | No address prefix validation — accepts testnet/P2SH addresses | `transaction.rs:178-189` | Check `decoded[0] == 0x00` | Quick fix |
| S4 | Sighash not validated against test vectors — custom BIP-143 impl | `transaction.rs:232-284` | Add tests with known BSV vectors | Medium |
| S5 | No input length limits on Tauri commands — DoS via large payloads | `brc100_signing.rs:199+`, `crypto.rs:56`, `transaction.rs:376+` | Add `MAX_INPUT_SIZE` guards | Quick fix |
| S6 | `rand::thread_rng()` for IV/salt — `OsRng` is more robust for crypto | `crypto.rs:60-62` | Use `rand::rngs::OsRng` | Quick fix |

### MEDIUM (4)

| ID | Issue | File:Line | Effort |
|----|-------|-----------|--------|
| S7 | ECIES wire format Rust↔Rust only — no assertion prevents cross-platform use | `brc100_signing.rs:173-186` | Quick fix |
| S8 | Verbose Rust error messages may leak implementation details | `crypto.rs:101`, `transaction.rs:396` | Quick fix |
| S9 | No Tauri command rate limiting (only HTTP is rate-limited) | `lib.rs:428-457` | Medium |
| S10 | Crypto dependency versions unpinned in Cargo.toml | `Cargo.toml:30-38` | Quick fix |

### LOW (2)

- S11. WalletKeys derives `Debug` — prints mnemonics/WIFs (`key_derivation.rs:21`)
- S12. `panic = "abort"` doesn't prevent `.expect()` crashes (`Cargo.toml:53`)

---

## Phase 2: Bug Detection (7 findings)

### HIGH (2)

| ID | Issue | File:Line | Fix | Effort |
|----|-------|-----------|-----|--------|
| B1 | 5 signing tests skipped — `signData` has `Buffer.from()` type issue; critical path untested | `brc100.test.ts:128-172` | Fix DER encoding in `brc100/signing.ts:36-37` | Quick fix |
| B2 | No timeout on Tauri command invocations — app freezes if Rust hangs | `crypto.ts:38-41` | Wrap with `Promise.race()` + 30s timeout | Quick fix |

### MEDIUM (3)

| ID | Issue | File:Line | Effort |
|----|-------|-----------|--------|
| B3 | Builder returns `tx: null` from Rust but tests assert `tx` defined | `builder.ts:217`, `builder.test.ts:116,188` | Quick fix |
| B4 | Rust tx tests don't verify signature validity — only check non-empty | `transaction.rs:635-809` | Medium |
| B5 | Decrypt fallback: unexpected Rust errors silently fall through to Web Crypto | `crypto.ts:198-206` | Quick fix |

### LOW (2)

- B6. Dead code: `keysFromWif()` wrapper in `core.ts:20-22`
- B7. Builder tests don't cover Rust path — all run JS fallback

---

## Phase 3: Architecture (4 findings)

### MEDIUM (3)

| ID | Issue | File:Line | Effort |
|----|-------|-----------|--------|
| A1 | No Rust↔JS parity test — can't verify both produce identical keys | Tests | Medium |
| A2 | Tauri return types not runtime-validated — trusts `invoke<T>` generic | `crypto.ts:38-41` | Medium |
| A3 | Validation rules duplicated in TS domain layer and Rust | Multiple | Quick fix |

### LOW (1)

- A4. Inconsistent error handling patterns across TS modules

---

## Phase 4: Code Quality (4 findings)

### HIGH (1)

| ID | Issue | File:Line | Fix | Effort |
|----|-------|-----------|-----|--------|
| Q1 | 5 skipped tests = hidden bug in `signData()` DER encoding | `brc100.test.ts:128-172`, `brc100/signing.ts:36-37` | Fix `Buffer.from(Uint8Array.from(sigDER))` | Quick fix |

### MEDIUM (2)

| ID | Issue | File:Line | Effort |
|----|-------|-----------|--------|
| Q2 | Rust tests all happy-path — no edge case tests | `transaction.rs:635+`, `key_derivation.rs:330+` | Medium |
| Q3 | No integration test with real (broadcastable) tx vector | `transaction.rs` | Medium |

### LOW (1)

- Q4. Dead code: `keysFromWif` wrapper in `core.ts:20-22`

---

## Positive Findings

- Wire-format compatibility: Rust AES-256-GCM matches Web Crypto byte-for-byte
- Correct BIP-44 derivation paths for wallet/ordinals/identity
- Correct BSV sighash type: `0x41` (SIGHASH_ALL | FORKID)
- DER signature encoding with sighash byte appended correctly
- Base58Check validation on WIF and address decoding
- WIF prefix validation (`0x80` for mainnet)
- Clean Tauri command interface with proper `#[tauri::command]` annotations
- Web Crypto fallback preserved for dev/test environments
- `subtle` crate used for constant-time session token comparison
- Release profile: `panic = "abort"`, LTO, single codegen unit, stripping

---

## Remediation Plan

### Sprint 1: Critical Security & Signing Fix (1-2 days)
1. **S1** — Replace `.expect()` with `map_err()?` in ECDH
2. **S2** — Add `zeroize` crate; zero keys, passwords, mnemonics after use
3. **S3** — Add P2PKH mainnet prefix check in address validation
4. **B1/Q1** — Fix `signData()` Buffer.from type issue; un-skip 5 tests
5. **B2** — Add 30s timeout wrapper to `tauriInvoke()`

### Sprint 2: Validation & Robustness (1-2 days)
6. **S4** — Add sighash test with known BSV transaction vector
7. **S5** — Add input length limits to Tauri commands
8. **S6** — Switch `thread_rng()` to `OsRng` in crypto.rs
9. **B4** — Add signature verification in Rust transaction tests
10. **B5** — Fail fast on unexpected Rust decrypt errors
11. **B3** — Fix builder tests to handle `tx: null` from Rust path

### Sprint 3: Quality & Hardening (1-2 days)
12. **A1** — Add Rust↔JS parity test for key derivation
13. **Q2** — Add negative test cases (malformed WIF, empty inputs)
14. **S7** — Add zero-padding validation on ECIES decrypt
15. **S10** — Pin crypto dependency versions in Cargo.toml
16. **S11** — Remove `Debug` derive from `WalletKeys`
17. **Q4** — Remove dead `keysFromWif` wrapper
