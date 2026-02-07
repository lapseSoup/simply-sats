# Architecture

## Layer Diagram

```
┌─────────────────────────────────────────────────┐
│  Components (51 files)                          │
│  shared/ wallet/ tabs/ modals/ forms/ onboarding│
├─────────────────────────────────────────────────┤
│  Hooks (6)                                      │
│  useKeyboardNav, useFocusTrap, useBRC100, ...   │
├─────────────────────────────────────────────────┤
│  Contexts (7 providers)                         │
│  Wallet, Network, UI, Accounts, Tokens,         │
│  Sync, Locks                                    │
├─────────────────────────────────────────────────┤
│  Services (74 files)                            │
│  wallet/ database/ brc100/ crypto sync logger   │
├──────────────────────┬──────────────────────────┤
│  Domain              │  Infrastructure          │
│  types, wallet/,     │  api/ database/          │
│  transaction/,       │  broadcast/ storage/     │
│  brc100/             │                          │
└──────────────────────┴──────────────────────────┘
```

Rules: Domain has zero external dependencies. Infrastructure wraps external APIs/storage. Services orchestrate domain + infrastructure. Contexts hold React state. Components render UI.

## Domain Layer (`src/domain/`)

Pure functions and types. No side effects, no imports from services/infrastructure.

- **`types.ts`** — Core types: `WalletKeys`, `UTXO`, `DBUtxo`, `LockedUTXO`, `Ordinal`, `TokenBalance`, `Account`, `TransactionRecord`, `NetworkInfo`, `Result<T, E>`, `BASKETS` const
- **`wallet/keyDerivation.ts`** — BIP-44 derivation via `@bsv/sdk`. `WALLET_PATHS` constant (wallet: `m/44'/236'/0'/1/0`, ordinals: `m/44'/236'/1'/0/0`, identity: `m/0'/236'/0'/0/0`). `deriveKeysFromPath(mnemonic, path) → KeyPair`
- **`wallet/validation.ts`** — Address and transaction validation functions
- **`transaction/fees.ts`** — Fee calculation from byte sizes and fee rates
- **`transaction/coinSelection.ts`** — Coin selection algorithm for building transactions
- **`brc100/types.ts`** — BRC-100 request/response type definitions

## Infrastructure Layer (`src/infrastructure/`)

Wraps external services with consistent interfaces.

- **`api/httpClient.ts`** — Base HTTP client: 30s timeout, 3 retries with exponential backoff, request/response logging
- **`api/wocClient.ts`** — WhatsOnChain client: `getBlockHeight()`, `getUtxos(address)`, `getBalance(address)`, `broadcastTransaction(hex)`, plus "Safe" variants returning `Result<T, ApiError>`
- **`api/feeService.ts`** — Fee rate from GorillaPool
- **`api/requestCache.ts`** — Request-level caching layer
- **`database/`** — SQLite connection management (sql.js for WASM, Tauri plugin for desktop)
- **`broadcast/`** — SHIP/SLAP overlay network broadcast
- **`storage/localStorage.ts`** — localStorage wrapper with cleanup on exit

## Services Layer (`src/services/`)

Business logic that orchestrates domain and infrastructure. 74 files total.

### Wallet Service (`src/services/wallet/`)
Split from a 2,267-line monolith into 8 modules (Feb 2026):
- **`core.ts`** — `createWallet()`, `restoreWallet(mnemonic)`, `importFromJSON(json)`
- **`transactions.ts`** — `sendBSV()`, `sendBSVMultiKey()`, `consolidateUtxos()`, `broadcastTransaction()`
- **`locks.ts`** — `lockBSV()`, `unlockBSV()`, `detectLockedUtxos()`, `generateUnlockTxHex()`
- **`ordinals.ts`** — `getOrdinals()`, `transferOrdinal()`, `scanHistoryForOrdinals()`
- **`balance.ts`** — `getBalance()`, `getUTXOs()`, `getTransactionHistory()`, `calculateTxAmount()`
- **`storage.ts`** — `saveWallet()`, `loadWallet()`, `hasWallet()`, `clearWallet()`, `changePassword()`
- **`fees.ts`** — `fetchDynamicFeeRate()`, `calculateTxFee()`, `calculateMaxSend()`, `calculateExactFee()`
- **`types.ts`** — Shared type definitions for wallet modules

### Database Service (`src/services/database/`)
Split from a 1,604-line monolith into 10 repositories:
- **`connection.ts`** — `initDatabase()`, `getDatabase()`, `withTransaction()`, `closeDatabase()`
- **`utxoRepository.ts`** — UTXO CRUD, spend tracking, pending spend management, frozen UTXOs
- **`transactionRepository.ts`** — Transaction history, labels, status updates
- **`lockRepository.ts`** — Time-locked UTXO management
- **`syncStateRepository.ts`** — Per-address sync height tracking
- **`basketRepository.ts`** — Address grouping (default, ordinals, identity, locks, derived)
- **`addressRepository.ts`** — BRC-42/43 derived addresses, invoice numbering
- **`contactRepository.ts`** — Address book CRUD
- **`actionRepository.ts`** — BRC-100 action request logging
- **`backupRepository.ts`** — Database export/import/reset

### BRC-100 Service (`src/services/brc100/`)
Split from a 1,808-line monolith into 7 modules:
- **`RequestManager.ts`** — Class managing incoming BRC-100 requests, approval flow
- **`types.ts`** — Protocol type definitions
- **`state.ts`** — Connected app and trusted origin state
- **`signing.ts`** — Request signing and verification
- **`cryptography.ts`** — ECDH, encryption, certificate management
- **`script.ts`** — sCrypt timelock script building
- **`utils.ts`** — Shared utilities

### Standalone Services
- **`sync.ts`** — Blockchain sync: fetches UTXOs/history from WoC, updates local DB
- **`accounts.ts`** — Multi-account management with encrypted mnemonic storage
- **`crypto.ts`** — AES-GCM encrypt/decrypt, PBKDF2 key derivation
- **`keyDerivation.ts`** — High-level key derivation orchestration
- **`secureStorage.ts`** — Encrypted localStorage for sensitive data (trusted origins, connected apps)
- **`autoLock.ts`** — Inactivity-based wallet locking
- **`rateLimiter.ts`** — Unlock attempt rate limiting with exponential backoff
- **`logger.ts`** — Structured logging (replaces 315+ console.log statements)
- **`auditLog.ts`** — Security audit event logging
- **`config.ts`** — Feature flag and configuration service

## State Flow

```
External APIs (WoC, GorillaPool)
       ↓
  sync.ts (fetches blockchain data)
       ↓
  database/ repositories (persist locally)
       ↓
  SyncContext (holds UTXOs, ordinals, history, balances in React state)
       ↓
  WalletContext (aggregates all contexts for backward compat)
       ↓
  Components (render via useWallet(), useSync(), etc.)
```

User actions flow in reverse: Component → Context handler → Service → Infrastructure → External API

## Database Schema

SQLite with tables:

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `utxos` | UTXO tracking | txid, vout, satoshis, lockingScript, basket, spendable, spentAt |
| `transactions` | TX history | txid, rawTx, amount, fee, blockHeight, status, labels |
| `locks` | Time-locked outputs | txid, vout, satoshis, unlockBlock, unlocked |
| `accounts` | Multi-account | id, name, encryptedMnemonic, walletAddress, ordAddress, identityAddress |
| `addresses` | BRC-42/43 derived | address, senderPubKey, derivationPath, invoiceNumber |
| `contacts` | Address book | pubkey, label, paymail |
| `action_requests` | BRC-100 logging | origin, method, result, timestamp |
| `certificates` | Certificate storage | type, subject, certifier, fields |

Migrations in `src-tauri/migrations/` — append-only, DDL only. Fresh installs use `fresh_install_schema.sql` via Rust pre-init.

## SDK Architecture (`sdk/`)

Separate npm package `@simply-sats/sdk`. Communicates with the Tauri HTTP server via JSON-RPC style POST requests to `localhost:3322`.

- **SimplySats class** — 20+ public methods covering auth, keys, transactions, timelocks
- **Authentication:** Session token (`X-Simply-Sats-Token` header), CSRF nonces for state-changing ops
- **Error handling:** `SimplySatsError` class with typed error codes
- **Trusted origins:** Apps can be pre-approved for auto-approval of requests

## Tauri Backend (`src-tauri/`)

Rust-based desktop backend:

- **`lib.rs`** — App setup, Tauri commands, `pre_init_database()` for fresh installs
- **`http_server.rs`** (23KB) — Axum HTTP server on port 3322 implementing BRC-100 protocol. 13 POST routes. Rate limited (60 req/min). DNS rebinding protection (localhost only).
- **`rate_limiter.rs`** — Per-session request rate limiting
- **`secure_storage.rs`** — AES-GCM encrypted key storage via Tauri secure storage
- **`build.rs`** — Build configuration

Window: 420x640px (mobile-like), resizable, min 380x640. Deep linking: `simplysats://` protocol.
