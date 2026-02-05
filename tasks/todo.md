# Simply Sats - Future Improvements

## High Priority

### Task 6.1: Transaction Builder Extraction
- [ ] Move TX building logic from wallet.ts to domain layer
- [ ] Create pure functions for building unsigned transactions
- [ ] Separate signing step from transaction construction
- [ ] Add comprehensive tests for transaction building

### Task 6.2: Database Repository Pattern
- [ ] Create `src/infrastructure/database/utxoRepository.ts`
- [ ] Abstract SQLite operations with clean interfaces
- [ ] Create repositories for: UTXOs, Transactions, Locks, Ordinals
- [ ] Add unit tests with mock database

### Task 6.3: Error Handling Standardization
- [ ] Create unified error type system in `src/domain/errors.ts`
- [ ] Define typed errors: `InsufficientFundsError`, `NetworkError`, `ValidationError`, etc.
- [ ] Update services to throw/catch typed errors
- [ ] Add error boundary components for graceful UI handling

## Medium Priority

### Task 7.1: Ordinals Service Extraction
- [ ] Create `src/domain/ordinals/` module
- [ ] Extract ordinal inscription logic from wallet.ts
- [ ] Add pure functions for ordinal validation and parsing
- [ ] Add tests for ordinal operations

### Task 7.2: Lock/Timelock Domain
- [ ] Create `src/domain/locks/` module
- [ ] Extract timelock script building into pure functions
- [ ] Add `buildTimelockScript()`, `parseTimelockScript()` functions
- [ ] Add comprehensive tests

### Task 7.3: React Query Integration
- [ ] Replace manual sync state management with React Query
- [ ] Add caching for balance, UTXOs, ordinals
- [ ] Implement optimistic updates for transactions
- [ ] Add automatic refetching and stale data handling

## High Priority (Phase 9) - Code Review Findings

### Task 9.1: App.tsx Decomposition
- [ ] Extract modal rendering to `src/AppModals.tsx`
- [ ] Extract tab management to `src/AppTabs.tsx`
- [ ] Create `src/hooks/useBrc100Handler.ts` hook for BRC-100 logic
- [ ] Create `src/AppProviders.tsx` wrapper component
- [ ] Refactor App.tsx to use new components
- [ ] Target: Reduce App.tsx from 558 lines to ~150

### Task 9.2: HTTP Server Rate Limiting
- [ ] Add rate limiting middleware to Axum server (`src-tauri/src/http_server.rs`)
- [ ] Limit requests per session token (e.g., 60/minute)
- [ ] Add logging for rate limit violations
- [ ] May need `tower-governor` crate in Cargo.toml

### Task 9.3: CI Pipeline Enhancement
- [ ] Add test execution step (`npm run test:run`) to `.github/workflows/build.yml`
- [ ] Add linting step (`npm run lint`)
- [ ] Add coverage reporting
- [ ] Add `npm audit` for security scanning

## Medium Priority (Phase 10) - Code Review Findings

### Task 10.1: Base HTTP Client
- [ ] Create shared HTTP client in `src/infrastructure/api/httpClient.ts`
- [ ] Add consistent error handling
- [ ] Add request/response logging (dev mode)
- [ ] Add retry logic with exponential backoff
- [ ] Refactor wocClient.ts to use base client
- [ ] Refactor feeService.ts to use base client

### Task 10.2: Result Type Pattern
- [ ] Create `Result<T, E>` type in `src/domain/types.ts`
- [ ] Add helper functions: `ok()`, `err()`, `isOk()`, `isErr()`
- [ ] Migrate wallet.ts critical paths to use Result pattern
- [ ] Migrate sync.ts to use Result pattern

### Task 10.3: Database Timestamp Audit
- [ ] Audit tables for missing created_at/updated_at columns
- [ ] Create migration 007 for timestamp columns
- [ ] Update database.ts to populate timestamps on insert/update

## Code Quality (Phase 11) - Code Review Findings

### Task 11.1: JSDoc Documentation
- [ ] Add JSDoc to all domain functions in `src/domain/`
- [ ] Add JSDoc to service public methods
- [ ] Document SDK exports in `sdk/src/index.ts`
- [ ] Add parameter descriptions and examples

### Task 11.2: TypeScript Strictness
- [ ] Enable `noImplicitAny` in tsconfig.json
- [ ] Enable `strictNullChecks`
- [ ] Enable `noUncheckedIndexedAccess`
- [ ] Fix all resulting type errors

---

## Code Quality (Phase 8)

### Task 8.1: Reduce Bundle Size
- [ ] Analyze bundle with `npm run build -- --analyze`
- [ ] Add dynamic imports for modals (SendModal, LockModal, ReceiveModal)
- [ ] Lazy load settings and advanced features
- [ ] Target: reduce 922KB bundle by 30%+

### Task 8.2: Type Safety Improvements
- [ ] Audit and remove `any` types in wallet.ts
- [ ] Add strict typing to API responses
- [ ] Create Zod schemas for runtime validation
- [ ] Enable stricter TypeScript compiler options

### Task 8.3: Test Coverage Expansion
- [ ] Add integration tests for new context providers
- [ ] Add E2E tests for critical flows (send, receive, lock)
- [ ] Increase coverage target to 80%+
- [ ] Add visual regression tests for UI components

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
