# Simply Sats — Comprehensive Overview

A lightweight BSV desktop wallet with BRC-100 protocol support. Built for users who want full control of their keys without the complexity of a full node.

---

## What Is Simply Sats?

Simply Sats is a non-custodial BSV wallet that runs as a native desktop application (macOS, with Windows/Linux planned). It stores your wallet locally — no accounts, no cloud, no servers. Your seed phrase is the only thing that matters.

**Who it's for:**
- BSV users who want a lightweight alternative to browser extensions
- Developers building BRC-100 apps who need a wallet to test against
- Wrootz users who need timelock-compatible wallet functionality

**What makes it different:**
- BRC-100 protocol server built-in (port 3322) — apps can request signatures, keys, and transactions without browser extension APIs
- Timelocked UTXOs with Wrootz-compatible OP_PUSH_TX scripts
- BRC-42/43 derived address support for payment privacy
- ~10x smaller than Electron-based wallets (Tauri uses native webview, no bundled Chromium)

---

## Features In Depth

### Wallet & Addresses
Simply Sats derives keys using BIP-44 at standard BSV paths (`m/44'/236'/...`), compatible with Yours Wallet. It manages three address types: a standard P2PKH payment address, a dedicated ordinals address, and an identity address used for BRC-100 authentication. Multi-account support lets you create additional accounts from the same seed phrase — each with its own set of addresses and UTXO tracking.

### BRC-42/43 Derived Addresses
When someone wants to pay you privately, they need your identity public key. Using ECDH, they derive a unique address that only you can spend from. Simply Sats stores these derived addresses locally and lets you generate receive addresses by entering the sender's public key. Each payment uses a fresh address — no address reuse.

### 1Sat Ordinals
View inscriptions associated with your ordinals address via GorillaPool API. Transfer ordinals to another address. Ordinals are tracked separately from spendable UTXOs to prevent accidental spending.

### Token Tracking
BSV-20 and BSV-21 token balances are fetched from GorillaPool and displayed in the Tokens tab. Token UTXOs are tracked in their own basket and excluded from standard balance calculations.

### Time Locks (Wrootz Integration)
Lock sats until a specific block height using the same sCrypt-compiled OP_PUSH_TX script as Wrootz. The timelock script validates a BIP-143 preimage on-chain, ensuring the UTXO cannot be spent before the target block. Simply Sats can detect, display, and unlock timelocked UTXOs that were created by either Simply Sats or Wrootz.

### BRC-100 Protocol
An Axum HTTP server runs on port 3322 when the app is open. External apps (like Wrootz) send JSON requests to this server to request wallet operations: signing, key derivation, timelocked outputs, certificates. Each request is shown to the user for approval. Trusted origins can be pre-approved for auto-approval. The `@simply-sats/sdk` npm package wraps the HTTP API for easy integration.

### Multi-Account
Multiple accounts can be created from a single seed phrase, each with its own encrypted mnemonic storage. Switch accounts from the accounts menu — UTXOs, history, and settings are scoped per account.

### Auto-Lock
The wallet locks automatically after a configurable period of inactivity (10min default, 1min–60min range, or disabled). Uses AES-256-GCM re-encryption on lock. Unlock requires re-entering the password (or just clicking unlock for passwordless wallets).

---

## Architecture

Simply Sats uses a strict layered architecture:

```
Components → Hooks → Contexts → Services → Domain / Infrastructure
```

| Layer | Purpose |
|---|---|
| **Domain** (`src/domain/`) | Pure functions and types. No side effects. BIP-44 derivation, fee calculation, coin selection, validation. |
| **Infrastructure** (`src/infrastructure/`) | External service wrappers. WhatsOnChain client, GorillaPool client, SQLite connection, SHIP/SLAP broadcast. |
| **Services** (`src/services/`) | Business logic. Orchestrates domain + infrastructure. 74 files across wallet/, database/, brc100/, and standalone services. |
| **Contexts** (`src/contexts/`) | React state management. 7 providers: Network, UI, Accounts, Tokens, Sync, Locks, Wallet (aggregator). |
| **Components** (`src/components/`) | React UI. 51 files across shared/, wallet/, tabs/, modals/, forms/, onboarding/. |

For the full layer-by-layer breakdown including data flow and database schema, see [docs/architecture.md](architecture.md).

---

## Security Model

### Encryption
Wallet keys are encrypted at rest using AES-256-GCM. The encryption key is derived from your password using PBKDF2 with 600,000 iterations and a random salt (OWASP 2024 recommendation). The encrypted blob is stored in localStorage and never leaves your machine.

### Optional Password
Simply Sats supports passwordless mode — if you leave the password blank during wallet creation, a random key is used instead of a password-derived one. You can set or change a password later in Settings. Passwordless wallets are convenient but rely on your device's physical security.

### Rate Limiting
Failed unlock attempts are rate-limited: 5 attempts are allowed, then exponential backoff kicks in (1 second base, doubling up to 5 minutes max). This prevents brute-force attacks on encrypted wallets.

### BRC-100 Server Security
The HTTP server on port 3322 only accepts connections from `localhost` — DNS rebinding attacks cannot reach it from a remote origin. All state-changing operations (sending BSV, signing) require a fresh CSRF nonce. Each request is shown to the user for explicit approval unless the origin has been trusted.

### Audit Log
Security-relevant events (unlock, lock, password change, BRC-100 approvals/rejections) are written to a local audit log for review.

### No Cloud, No Telemetry
Simply Sats makes no connections except to WhatsOnChain, GorillaPool, and ARC for blockchain data. No analytics, no crash reporting, no update checks.

---

## Derivation Paths

| Purpose | Path | Used For |
|---------|------|---------|
| Payment | `m/44'/236'/0'/1/0` | Receiving BSV, sending change |
| Ordinals | `m/44'/236'/1'/0/0` | Ordinal inscriptions |
| Identity | `m/0'/236'/0'/0/0` | BRC-100 authentication, BRC-42/43 key agreement |

Compatible with Yours Wallet — seed phrases can be imported/exported between the two.

---

## BRC-100 / SDK

### Protocol
BRC-100 is a wallet interop protocol. Apps communicate with Simply Sats via HTTP POST to `localhost:3322`. The server implements 13 routes covering:
- `getPublicKey` / `getIdentityKey`
- `createAction` (send BSV)
- `createTimeLock` / `unlockTimeLock`
- `encrypt` / `decrypt`
- `createCertificate` / `verifyCertificate`
- `createSignature` / `verifySignature`

### SDK
```bash
npm install @simply-sats/sdk
```

```typescript
import { SimplySats } from '@simply-sats/sdk'

const wallet = new SimplySats('http://localhost:3322')
const key = await wallet.getPublicKey({ protocolID: 'my-app', keyID: '1' })
```

See [docs/api-surface.md](api-surface.md) for the full SDK API reference.

---

## Development Setup

### Prerequisites
- Node.js 20+
- Rust (stable) + `cargo`
- Tauri CLI: `npm install -g @tauri-apps/cli`
- On macOS: Xcode Command Line Tools

### Commands

```bash
# Install dependencies
npm install

# Run in browser (Vite dev server, no Tauri features)
npm run dev

# Run as desktop app (Tauri + hot reload)
npm run tauri:dev

# Build for production (creates .app + DMG on macOS)
npm run tauri:build

# Run all tests (1606 tests, single pass)
npm run test:run

# Run tests in watch mode
npm run test

# Type check (zero tolerance — fix all before committing)
npm run typecheck

# Lint
npm run lint

# Test coverage report
npm run test:coverage
```

### Project Structure

```
src/
├── domain/          # Pure business logic (no side effects)
├── infrastructure/  # External API clients, SQLite, broadcast
├── services/        # Business logic (74 files)
│   ├── wallet/      # 8 modules: core, transactions, locks, ordinals...
│   ├── database/    # 10 repositories: utxo, tx, lock, sync...
│   └── brc100/      # 7 modules: RequestManager, signing, crypto...
├── contexts/        # React state (7 providers)
├── components/      # React UI (51 files)
├── hooks/           # Custom hooks
├── adapters/        # Wallet adapter (domain → service bridge)
└── config/          # Feature flags and constants

src-tauri/           # Rust backend
├── src/lib.rs       # App setup + Tauri commands
├── src/http_server.rs  # BRC-100 Axum server (port 3322)
└── migrations/      # SQLite schema migrations (append-only, DDL only)

sdk/                 # @simply-sats/sdk npm package
docs/                # Architecture, API surface, decisions, plans
```

---

## Tech Stack

| Technology | Version | Role |
|---|---|---|
| Tauri | 2.x | Desktop app framework |
| React | 19.x | UI framework |
| TypeScript | 5.9 | Type safety |
| Vite | 7.x | Build tool |
| Tailwind CSS | 4.x | Styling |
| Rust / Axum | stable / 0.8 | Backend HTTP server |
| SQLite (sql.js) | WASM | Local storage in browser |
| SQLite (Tauri plugin) | native | Local storage on desktop |
| @bsv/sdk | latest | BSV transactions + key derivation |
| Vitest | latest | Test runner (1606 tests) |
| @testing-library/react | latest | Component testing |

See [docs/decisions.md](decisions.md) for why these were chosen over alternatives.

---

## Contributing

1. **Branch from `main`**, work in a feature branch
2. **Run before every commit:**
   ```bash
   npm run typecheck   # must be clean
   npm run lint        # 0 errors
   npm run test:run    # all tests pass
   ```
3. **Never modify applied migrations** — add a new one instead
4. **No DML in Tauri migrations** — DDL only (CREATE/ALTER/DROP). The Tauri SQLite plugin hangs on DML.
5. **Commit messages** follow conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `perf:`

For architectural decisions, read [docs/decisions.md](decisions.md) before proposing changes.

---

## License

MIT
