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

## Code Quality

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
