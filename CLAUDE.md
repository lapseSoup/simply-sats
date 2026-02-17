## Simply Sats

Lightweight BSV wallet desktop app. Tauri 2 (Rust backend) + React 19 + TypeScript 5.9 + Vite 7 + Tailwind CSS 4. SQLite for local storage. BRC-100 protocol support for app interop.

## Quick Commands

```
npm run dev            # Vite dev server (browser)
npm run build          # tsc + vite build
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run test           # Vitest (watch mode)
npm run test:run       # Vitest (single run, 657 tests)
npm run test:coverage  # Vitest + v8 coverage
npm run tauri:dev      # Run as desktop app
npm run tauri:build    # Build desktop app (macOS/Windows)
```

## Architecture

Layered architecture: **Components → Hooks → Contexts → Services → Domain / Infrastructure**

```
src/
├── domain/            # Pure business logic, types, no side effects
│   ├── types.ts       # Core types: WalletKeys, UTXO, LockedUTXO, Ordinal, Result<T,E>
│   ├── wallet/        # Key derivation (BIP-44), address validation
│   ├── transaction/   # Fee calculation, coin selection
│   └── brc100/        # BRC-100 protocol types
├── infrastructure/    # External service integrations
│   ├── api/           # HTTP clients: wocClient, feeService, httpClient (retry/backoff)
│   ├── database/      # SQLite connection layer
│   ├── broadcast/     # SHIP/SLAP overlay broadcast
│   └── storage/       # localStorage wrapper
├── services/          # Business logic (74 files)
│   ├── wallet/        # 8 modules: core, transactions, locks, ordinals, balance, storage, fees, types
│   ├── database/      # 10 repositories: utxo, tx, lock, sync, basket, address, contact, action, backup, connection
│   ├── brc100/        # 7 modules: types, RequestManager, state, signing, crypto, script, utils
│   └── (standalone)   # crypto, keyDerivation, secureStorage, autoLock, rateLimiter, logger, sync, accounts
├── contexts/          # React Context state management (7 providers)
├── components/        # React UI (51 files): shared/, wallet/, tabs/, modals/, forms/, onboarding/
├── hooks/             # Custom hooks: useKeyboardNav, useFocusTrap, useModalKeyboard, useBRC100, useBrc100Handler
├── adapters/          # Wallet adapter implementations
├── config/            # Centralized constants (src/config/index.ts)
├── utils/             # Utility functions
└── test/              # Test setup, mocks, custom matchers
```

**Tauri backend** (`src-tauri/`): Rust — lib.rs (setup), http_server.rs (BRC-100 Axum server on port 3322), rate_limiter.rs, secure_storage.rs

**SDK** (`sdk/`): Node.js package `@simply-sats/sdk` — SimplySats class with RPC-style HTTP-JSON to Tauri backend

## Key Files by Task

**Wallet operations:** `src/services/wallet/core.ts`, `transactions.ts`, `locks.ts`, `ordinals.ts`, `balance.ts`, `storage.ts`, `fees.ts`
**State management:** `src/contexts/WalletContext.tsx`, `SyncContext.tsx`, `LocksContext.tsx`, `AccountsContext.tsx`
**UI:** `src/App.tsx`, `src/AppProviders.tsx`, `src/AppTabs.tsx`, `src/AppModals.tsx`
**Database:** `src/services/database/` (10 repository files), `src/infrastructure/database/`
**Config:** `src/config/index.ts` (SECURITY, NETWORK, TRANSACTION, WALLET, UI, API, FEATURES constants)
**BRC-100:** `src/services/brc100/`, `src-tauri/src/http_server.rs`
**Tests:** `src/**/*.test.ts`, `src/test/setup.ts`, `vitest.config.ts`

## Context Provider Hierarchy

Order matters — outer providers are available to inner ones (defined in `src/AppProviders.tsx`):

```
ScreenReaderAnnounceProvider  # Accessibility announcements
  NetworkProvider             # Block height, sync state, USD price
    UIProvider                # Display unit toggle, toasts, clipboard, formatting
      AccountsProvider        # Multi-account CRUD, account switching
        TokensProvider        # BSV-20/21 token balances
          SyncProvider        # UTXOs, ordinals, tx history, basket balances
            LocksProvider     # Time-locked UTXO state
              WalletProvider  # Core wallet state, aggregates all contexts
```

Access via hooks: `useWallet()`, `useNetwork()`, `useUI()`, `useAccounts()`, `useTokens()`, `useSync()`, `useLocks()`

## Conventions

- **Components:** PascalCase files (`BalanceDisplay.tsx`), functional only, `useCallback` for handlers
- **Services/hooks:** camelCase files (`wallet.ts`, `useKeyboardNav.ts`), `use*` prefix for hooks
- **Contexts:** PascalCase + "Context" suffix (`WalletContext.tsx`)
- **Barrel exports:** `src/contexts/index.ts` re-exports all contexts
- **Unused vars:** Underscore prefix (`_err`, `_unused`)
- **Navigation:** Tab-based (no React Router) — 5 tabs: activity, ordinals, tokens, locks, utxos
- **Error handling:** Ad-hoc `{ success: boolean; error?: string }` return pattern (planned migration to `Result<T, E>`)
- **Strict TypeScript:** `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` enabled
- **ESLint:** v9 flat config, `@typescript-eslint/no-explicit-any: warn`, auto-fix on save via `.claude/settings.json`

## External APIs

- **WhatsOnChain:** `https://api.whatsonchain.com/v1/bsv/main` — block height, UTXOs, tx history, broadcasting
- **GorillaPool:** `https://ordinals.gorillapool.io/api` — ordinals, token balances, fee rates
- **ARC/Taal:** Transaction broadcasting
- **Babbage overlay:** SHIP/SLAP message handling

## Feature Flags

In `src/config/index.ts` FEATURES object:
- BRC100_SERVER: **on** | TOKENS: **on** | ORDINALS: **on** | MULTI_ACCOUNT: **on**
- LOCKS: **off** | AUDIT_LOG: **on** | BACKUP_VERIFICATION: **on** | AUTO_CONSOLIDATION: **on**

## Database

SQLite via sql.js (WASM for browser) + Tauri plugin (desktop). Repository pattern in `src/services/database/`.
Key tables: `utxos`, `transactions`, `locks`, `accounts`, `addresses`, `contacts`, `action_requests`, `certificates`
Migrations: `src-tauri/migrations/` — append-only, DDL only (see Critical Lessons below)

## Security Model

- AES-GCM 256-bit encryption for wallet keys (local storage only)
- PBKDF2 key derivation: 600,000 iterations (OWASP 2025)
- BIP-39 12-word seed phrases, BRC-42/43 derived addresses
- Password: 14 char minimum, 16 recommended
- Auto-lock: default 10min, max 60min
- Rate limiting: 5 max unlock attempts, exponential backoff (1s base, 5min max)
- CSRF nonces for state-changing BRC-100 operations
- Content Security Policy in Tauri restricts origins

## Critical Lessons (from tasks/lessons.md)

1. **Migration checksums are immutable** — NEVER modify an applied migration. Create a new one.
2. **No DML in Tauri migrations** — tauri_plugin_sql hangs on DELETE/UPDATE/INSERT. DDL only (CREATE/ALTER/DROP).
3. **Fresh installs need pre-initialized DB** — Use `pre_init_database()` in lib.rs with `fresh_install_schema.sql`.
4. **jsdom realm mismatch** — Use `// @vitest-environment node` for tests using Node.js crypto APIs.

## Efficient Review Tips

- **Use diffs, not full reads:** `git diff HEAD~3` or `gh pr diff` shows exactly what changed
- **Scope reviews:** "Review `src/services/wallet/`" is far cheaper than "review the project"
- **Structure first:** `tree -L 2 src/` gives layout without reading content
- **This file is context:** CLAUDE.md loads every session — no need to re-explore the codebase

## Deep Dives

- `docs/architecture.md` — Layer-by-layer architecture, data flow, database schema
- `docs/api-surface.md` — All public service methods, context APIs, SDK, HTTP endpoints
- `docs/decisions.md` — Why Tauri, why Context over Redux, security parameter choices
- `tasks/todo.md` — Future improvements by phase and priority
- `tasks/lessons.md` — Hard-won lessons from production issues
