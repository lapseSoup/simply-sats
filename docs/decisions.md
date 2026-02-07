# Architectural Decisions

Why things are the way they are. Read this before suggesting alternatives.

## Tauri over Electron

**Decision:** Use Tauri 2 with Rust backend instead of Electron.

**Why:**
- ~10x smaller binary size (Tauri uses native webview, no bundled Chromium)
- Rust backend for crypto operations — AES-GCM encryption, PBKDF2 key derivation run natively, not in JS
- Better security model — Rust's memory safety for handling private keys, CSP enforced at framework level
- Tauri plugins for SQLite, secure storage, deep linking, file system — all native performance
- Trade-off: Smaller ecosystem than Electron, some web APIs unavailable (mitigated by Tauri plugin system)

## React Context over Redux/Zustand

**Decision:** Use React Context API with 7 focused providers instead of a state management library.

**Why:**
- Tab-based SPA with no routing — state complexity is bounded, not growing
- 7 contexts with clear ownership (Network, UI, Accounts, Tokens, Sync, Locks, Wallet) keep each provider focused
- WalletContext aggregates all others for backward compatibility — components that need everything get it from one hook
- No need for middleware, devtools, or time-travel debugging in a wallet app
- Context split happened in Feb 2026 refactor — original monolithic WalletContext (1,099 lines) was the problem, not the pattern
- Trade-off: No built-in caching/deduplication (React Query integration is planned in tasks/todo.md Task 7.3)

## Tab-Based Navigation over React Router

**Decision:** Custom tab navigation with 5 tabs (activity, ordinals, tokens, locks, utxos) instead of URL-based routing.

**Why:**
- Wallet is a single-screen app — no concept of "pages" or URL paths
- Desktop app via Tauri — URLs are meaningless to users
- Keyboard navigation (arrow keys to switch tabs, Escape to close modals) is more natural for a desktop wallet
- Simpler state management — active tab is just a `useState<Tab>`, no router context needed
- Tab order defined in `App.tsx`: `const TAB_ORDER: Tab[] = ['activity', 'ordinals', 'tokens', 'locks', 'utxos']`

## SQLite + sql.js

**Decision:** SQLite for local persistence, with sql.js (WASM) for browser and Tauri plugin for desktop.

**Why:**
- Offline-first wallet — must work without internet for balance queries, UTXO selection
- UTXO tracking requires relational queries (JOIN baskets, filter by spendable, group by account)
- sql.js provides identical SQL interface in browser dev mode and Tauri desktop builds
- localStorage is insufficient for structured UTXO/transaction data at scale
- Trade-off: Migration complexity with Tauri plugin (see lessons.md — DDL only, checksums immutable, fresh install pre-init needed)

## @bsv/sdk

**Decision:** Use the official BSV SDK (`@bsv/sdk`) for all Bitcoin operations.

**Why:**
- Official SDK with BRC-42/43 key derivation support (ECDH-derived addresses)
- HD key derivation (BIP-32/44) with Yours Wallet compatible paths
- Transaction building with sCrypt timelock script support
- P2PKH, custom locking scripts, signature generation all in one package
- Maintained by BSV ecosystem developers

## BRC-100 Protocol

**Decision:** Implement BRC-100 HTTP-JSON protocol for app interoperability.

**Why:**
- Interop with Yours Wallet ecosystem — apps that work with Yours Wallet work with Simply Sats
- Identity-based authentication via certificates — no passwords shared with apps
- CSRF nonces for state-changing operations prevent replay attacks
- Trusted origins system allows pre-approved apps to skip user confirmation
- SDK (`@simply-sats/sdk`) gives developers a clean API to integrate
- HTTP server on localhost:3322 — apps communicate locally, no network exposure

## Security Parameters

**Decision:** Conservative security defaults that exceed industry minimums.

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| PBKDF2 iterations | 100,000 | OWASP 2024 recommendation |
| Min password length | 14 chars | Above NIST SP 800-63B minimum (8) |
| Recommended password | 16 chars | Stronger default suggestion |
| Encryption | AES-GCM 256-bit | Authenticated encryption, prevents tampering |
| Auto-lock default | 10 minutes | Balance between security and convenience |
| Auto-lock max | 60 minutes | Upper bound to prevent indefinite unlock |
| Max unlock attempts | 5 | Before exponential backoff kicks in |
| Lockout backoff | 1s base, 5min max | Exponential: 1s, 2s, 4s, 8s... capped at 5min |
| CSRF nonce expiry | 5 minutes | Short-lived to limit replay window |
| Mnemonic auto-clear | 5 minutes | Cleared from memory after display |

All configurable in `src/config/index.ts` SECURITY object.

## Feb 2026 Refactoring Sprint

**Decision:** Split three monolithic files and add structured logging.

**What was split and why:**
- **wallet.ts** (2,267 lines → 8 modules) — Too many concerns: create, send, lock, ordinals, balance, storage, fees all in one file. Impossible to review or test in isolation.
- **database.ts** (1,604 lines → 10 repositories) — Moving toward repository pattern. Each table gets its own file with focused CRUD operations.
- **brc100.ts** (1,808 lines → 7 modules) — RequestManager class was tangled with signing, crypto, and script building. Extracted into focused modules.

**Structured logger:** Replaced 315+ `console.log` statements across 38+ files with `src/services/logger.ts`. Enables filtering by module and log level.

**ErrorBoundary:** Added to all 4 tabs and 10 modals with custom fallback UI. Prevents white-screen crashes.

**Test expansion:** 38 new tests (619 → 657 total) for RequestManager (21) and script utilities (17).

**What's still planned:** Transaction builder extraction (Task 6.1), database repository interfaces (Task 6.2), error handling standardization with Result types (Task 6.3). See `tasks/todo.md`.
