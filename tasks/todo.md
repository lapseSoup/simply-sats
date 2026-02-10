# Simply Sats - Future Improvements

## High Priority

### Task 6.1: Transaction Builder Extraction
- [x] Move TX building logic from wallet.ts to domain layer (in progress via domain extraction)
- [ ] Create pure functions for building unsigned transactions
- [ ] Separate signing step from transaction construction
- [ ] Add comprehensive tests for transaction building

### Task 6.2: Database Repository Pattern ✅ (Completed in Refactoring Sprint)
- [x] Create repositories in `src/services/database/`
- [x] Abstract SQLite operations with clean interfaces
- [x] Create repositories for: UTXOs, Transactions, Locks, Ordinals, etc. (10 repos)
- [x] Add unit tests with mock database

### Task 6.3: Error Handling Standardization
- [ ] Create unified error type system in `src/domain/errors.ts`
- [ ] Define typed errors: `InsufficientFundsError`, `NetworkError`, `ValidationError`, etc.
- [ ] Update services to throw/catch typed errors
- [x] Add error boundary components for graceful UI handling (done in Refactoring Sprint)

## Medium Priority

### Task 7.1: Ordinals Service Extraction (In Progress)
- [x] Create `src/domain/ordinals/` module
- [ ] Extract ordinal inscription logic from wallet.ts
- [x] Add pure functions for ordinal validation and parsing
- [ ] Add tests for ordinal operations

### Task 7.2: Lock/Timelock Domain (In Progress)
- [x] Create `src/domain/locks/` module
- [ ] Extract timelock script building into pure functions
- [ ] Add `buildTimelockScript()`, `parseTimelockScript()` functions
- [ ] Add comprehensive tests

### Task 7.3: React Query Integration (Deferred)
- [ ] Replace manual sync state management with React Query
- [ ] Add caching for balance, UTXOs, ordinals
- [ ] Implement optimistic updates for transactions
- [ ] Add automatic refetching and stale data handling

## High Priority (Phase 9) - Code Review Findings

### Task 9.1: App.tsx Decomposition ✅ (Completed in Refactoring Sprint)
- [x] Extract modal rendering to `src/AppModals.tsx`
- [x] Extract tab management to `src/AppTabs.tsx`
- [x] Create `src/hooks/useBrc100Handler.ts` hook for BRC-100 logic
- [x] Create `src/AppProviders.tsx` wrapper component
- [x] Refactor App.tsx to use new components

### Task 9.2: HTTP Server Rate Limiting ✅ (Already Implemented)
- [x] Add rate limiting middleware to Axum server (`src-tauri/src/http_server.rs`)
- [x] Rate limiter implemented in `src-tauri/src/rate_limiter.rs`

### Task 9.3: CI Pipeline Enhancement ✅ (Already Implemented)
- [x] Add test execution step (`npm run test:run`) to `.github/workflows/build.yml`
- [x] Add linting step (`npm run lint`)
- [x] Add coverage reporting
- [x] Add `npm audit` for security scanning

## Medium Priority (Phase 10) - Code Review Findings

### Task 10.1: Base HTTP Client ✅ (Already Implemented)
- [x] Create shared HTTP client in `src/infrastructure/api/httpClient.ts`
- [x] Add consistent error handling
- [x] Add retry logic with exponential backoff
- [x] Refactor wocClient.ts to use base client

### Task 10.2: Result Type Pattern
- [x] Create `Result<T, E>` type in `src/domain/types.ts`
- [x] Add helper functions: `ok()`, `err()`, `isOk()`, `isErr()`
- [ ] Migrate wallet.ts critical paths to use Result pattern
- [ ] Migrate sync.ts to use Result pattern

### Task 10.3: Database Timestamp Audit
- [ ] Audit tables for missing created_at/updated_at columns
- [ ] Create migration for timestamp columns
- [ ] Update repositories to populate timestamps on insert/update

## Code Quality (Phase 11) - Code Review Findings

### Task 11.1: JSDoc Documentation
- [ ] Add JSDoc to all domain functions in `src/domain/`
- [ ] Add JSDoc to service public methods
- [ ] Document SDK exports in `sdk/src/index.ts`
- [ ] Add parameter descriptions and examples

### Task 11.2: TypeScript Strictness ✅ (Completed Feb 10 2026)
- [x] Enable `noImplicitAny` in tsconfig.json (already enabled via `strict: true`)
- [x] Enable `strictNullChecks` (already enabled via `strict: true`)
- [x] Enable `noUncheckedIndexedAccess` — 240 errors fixed across 41 files
- [x] Fix all resulting type errors

---

## Code Quality (Phase 8)

### Task 8.1: Reduce Bundle Size (Partially Done)
- [ ] Analyze bundle with `npm run build -- --analyze`
- [x] Add dynamic imports for modals (SendModal, LockModal, ReceiveModal, etc.) — 9 modals lazy-loaded
- [x] Lazy load settings and advanced features (SettingsModal, AccountModal lazy-loaded)
- [ ] Target: reduce main chunk further (currently 1,993 kB → needs manual chunks config)

### Task 8.2: Type Safety Improvements (Partially Done)
- [x] Audit and remove `any` types in wallet.ts (8+ fixed in Refactoring Sprint)
- [ ] Add strict typing to API responses
- [ ] Create Zod schemas for runtime validation (Deferred)
- [x] Enable stricter TypeScript compiler options (`noUncheckedIndexedAccess`)

### Task 8.3: Test Coverage Expansion
- [ ] Add integration tests for new context providers
- [ ] Add E2E tests for critical flows (send, receive, lock)
- [ ] Increase coverage target to 80%+ (currently 20.25% statements)
- [ ] Add visual regression tests for UI components

---

## Code Review Remediation (Feb 8-10 2026) ✅

- [x] Fix NaN propagation in SendModal.tsx (parseFloat guard)
- [x] Add address + amount validation in transactions.ts (defense-in-depth)
- [x] Replace simpleHash with SHA-256 in keyDerivation.ts (BRC-43 paths)
- [x] Use Promise.allSettled in SyncContext.tsx (ordinal fetching)
- [x] Coin selection dedup in transactions.ts (use domain module)
- [x] Make session key non-extractable in secureStorage.ts

## Cross-Platform Polish (Feb 10 2026) ✅

- [x] NSIS installer config for Windows in tauri.conf.json
- [x] CSP fix for BRC-100 localhost in tauri.conf.json
- [x] Simplified Rust platform branches in lib.rs
- [ ] Code signing certificates (deferred — macOS + Windows)

---

## Completed Phases

### Phase 1: Domain Layer ✅
- Task 1.1: Domain directory structure
- Task 1.2: Fee calculation functions
- Task 1.3: Key derivation functions
- Task 1.4: Mnemonic validation
- Task 1.5: Coin selection logic

### Phase 2: Infrastructure Layer ✅
- Task 2.1: Infrastructure directory structure
- Task 2.2: WhatsOnChain API client
- Task 2.3: Fee rate service

### Phase 3: Adapter Layer ✅
- Task 3.1: Wallet adapter
- Task 3.2: Domain exports

### Phase 4: Split WalletContext ✅
- Task 4.1: NetworkContext
- Task 4.2: UIContext
- Task 4.3: AccountsContext
- Task 4.4: TokensContext
- Task 4.5: Slim down WalletContext (1099 → 884 lines)

### Phase 5: Migrate Components ✅
- Task 5.1: SendModal → domain layer
- Task 5.2: LockModal → domain layer
- Task 5.3: sync.ts → infrastructure layer
- Task 5.4: wallet.ts → adapters

### Refactoring Sprint (Feb 2026) ✅
- Split wallet.ts (2,267 lines) into 8 modules: types, core, transactions, locks, ordinals, balance, storage, fees
- Split database.ts (1,604 lines) into 10 repositories: connection, utxo, tx, lock, sync, basket, address, contact, action, backup
- Split brc100.ts (1,808 lines) into 7 modules: types, RequestManager (class), state, signing, cryptography, script, utils
- Added SyncMutex to cancellation.ts for preventing concurrent sync race conditions
- Migrated 315+ console.log statements to structured logger across 38+ files
- Added ErrorBoundary coverage to all 4 tabs and 10 modals with custom fallback UI
- Fixed 8+ production `any` types with proper TypeScript interfaces
- Added 38 new tests for RequestManager (21) and script utilities (17)
- Total test count: 657 passing tests (up from 619)

## Phase 10: Error Handling Migration (Future)

Track files using ad-hoc `{ success: boolean; error?: string }` pattern that should migrate to a consistent Result type:

- [ ] `src/services/overlay.ts`
- [ ] `src/services/tokens.ts`
- [ ] `src/services/backupRecovery.ts`
- [ ] `src/contexts/LocksContext.tsx`
- [ ] `src/contexts/WalletContext.tsx`
- [ ] `src/contexts/TokensContext.tsx`
- [ ] `src/contexts/ConnectedAppsContext.tsx`
- [ ] `src/domain/types.ts` (SendResult type)

Note: The unused comprehensive `src/domain/result.ts` was removed in the code review remediation. When migrating, design a simpler Result type that fits the actual patterns used.
