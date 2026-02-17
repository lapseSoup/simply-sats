# README Update Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update `README.md` with accurate current information and create `docs/OVERVIEW.md` as a comprehensive reference doc.

**Architecture:** Two independent file edits — README.md is updated in-place (lean refresh), OVERVIEW.md is a new file written from scratch. No code changes, no tests required.

**Tech Stack:** Markdown only. Verify with `npm run lint` after (ESLint ignores .md but good hygiene).

---

### Task 1: Update README.md

**Files:**
- Modify: `README.md`

**Step 1: Read the current README**

Read `README.md` in full to confirm current content before editing.

**Step 2: Replace README.md with the updated version**

Write the following content to `README.md` exactly:

```markdown
# Simply Sats

A simple, lightweight BSV wallet with BRC-100 support. Built with Tauri 2, React 19, and TypeScript 5.9.

## Features

- **Simple P2PKH addresses** - Standard Bitcoin addresses that work with any BSV wallet
- **BRC-100 compatible** - Works seamlessly with BRC-100 apps and protocols (Wrootz, etc.)
- **BRC-42/43 key derivation** - Receive payments at unique derived addresses with full privacy
- **Contacts** - Save sender public keys for easy payment reception
- **1Sat Ordinals viewer** - View and transfer your 1Sat Ordinal inscriptions
- **Time locks** - Lock sats until a specific block height using OP_PUSH_TX (Wrootz integration)
- **Yours Wallet compatible** - Uses the same derivation paths as Yours Wallet
- **Transaction history** - View your transaction history with WhatsOnChain links
- **QR codes** - Easy to share receive addresses
- **Local database** - UTXOs tracked locally for fast balance queries
- **Multi-account support** - Create multiple accounts from a single seed phrase
- **Token tracking** - View BSV-20/BSV-21 token balances
- **Auto-lock** - Automatically lock wallet after inactivity (10min default, up to 60min or disabled)
- **Overlay Network** - SHIP/SLAP broadcast support for transaction reliability
- **AES-256-GCM encryption** - Wallet keys encrypted locally with PBKDF2-derived key (600k iterations)
- **Optional password** - Leave blank for passwordless mode, or set a 14+ character password

## Derivation Paths

Simply Sats uses BRC-100/Yours Wallet standard derivation paths:

| Purpose | Derivation Path |
|---------|----------------|
| Payment (BSV spending) | m/44'/236'/0'/1/0 |
| Ordinals | m/44'/236'/1'/0/0 |
| Identity (BRC-100 auth) | m/0'/236'/0'/0/0 |

These paths are compatible with Yours Wallet. You can import/export seed phrases between Simply Sats and Yours Wallet.

## BRC-42/43 Derived Addresses

Simply Sats supports receiving payments at unique derived addresses using BRC-42/43 key derivation:

1. Share your Identity Public Key with the sender
2. The sender uses ECDH to derive a unique address
3. Generate a receive address in the app using the sender's public key
4. Only you can spend funds sent to that address
5. Each payment generates a new unique address

This provides better privacy than reusing a single address.

## Time Locks (Wrootz Integration)

Simply Sats can create and unlock time-locked UTXOs using the same OP_PUSH_TX technique as Wrootz:

- Lock sats until a specific block height
- Uses sCrypt-compiled timelock script
- Validates BIP-143 preimage on-chain
- Compatible with Wrootz time lock transactions

## Development

```bash
# Install dependencies
npm install

# Run in browser
npm run dev

# Run as desktop app
npm run tauri:dev

# Build for production (creates DMG on macOS)
npm run tauri:build

# Run tests (1606 tests)
npm run test:run

# Type check
npm run typecheck

# Lint
npm run lint
```

## Tech Stack

- **Tauri 2** - Lightweight desktop app framework (Rust backend, native webview)
- **React 19** - UI framework
- **TypeScript 5.9** - Type safety
- **Rust / Axum** - Backend HTTP server (BRC-100 on port 3322)
- **SQLite** - Local UTXO and transaction storage (sql.js WASM + Tauri plugin)
- **@bsv/sdk** - BSV transaction building and key derivation
- **WhatsOnChain API** - Blockchain data
- **GorillaPool API** - 1Sat Ordinals and fee rate data

## Security

- Private keys encrypted with AES-256-GCM, PBKDF2-derived key (600,000 iterations, OWASP 2024)
- No external servers besides WhatsOnChain/GorillaPool/ARC APIs for blockchain data
- Recovery phrase is the only way to restore your wallet
- Derived address private keys are computed from your seed phrase + sender's public key
- Auto-lock after configurable inactivity period (10min default, up to 60min, or disabled)
- Rate limiting: 5 unlock attempts max, then exponential backoff (1s base, 5min max)
- Optional password — passwordless mode supported for convenience
- CSRF nonces on all BRC-100 state-changing operations
- DNS rebinding protection — BRC-100 HTTP server accepts localhost connections only

For a full security model description see [docs/OVERVIEW.md](docs/OVERVIEW.md).

## License

MIT
```

**Step 3: Verify the file was written correctly**

Read `README.md` back and confirm:
- Optional password feature is listed in Features
- PBKDF2 600k iterations is in the AES-256-GCM bullet
- `npm run tauri:dev` and `npm run tauri:build` match (not `tauri dev`)
- Rate limiting detail is in Security section
- Tech stack has Tauri 2, React 19, TypeScript 5.9 with versions

**Step 4: Commit**

```bash
git add README.md
git commit -m "docs: refresh README with accurate tech stack, security, and commands"
```

---

### Task 2: Create docs/OVERVIEW.md

**Files:**
- Create: `docs/OVERVIEW.md`

**Step 1: Check docs/ directory exists**

Run: `ls /Users/kitclawd/simply-sats/docs/`
Expected: directory listing showing architecture.md, api-surface.md, decisions.md etc.

**Step 2: Write docs/OVERVIEW.md**

Write the following content to `docs/OVERVIEW.md`:

```markdown
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
```

**Step 3: Verify the file was written correctly**

Read `docs/OVERVIEW.md` back and spot-check:
- Security section mentions 600,000 iterations
- BRC-100 section lists the routes
- Development setup has `npm run tauri:dev` (not `tauri dev`)
- Contributing section has the DDL-only migration rule

**Step 4: Commit**

```bash
git add docs/OVERVIEW.md docs/plans/2026-02-17-readme-update-design.md docs/plans/2026-02-17-readme-update.md
git commit -m "docs: add comprehensive OVERVIEW.md reference document"
```

---

### Task 3: Push to GitHub

**Step 1: Verify clean state**

```bash
git status
```

Expected: nothing to commit (both commits landed)

**Step 2: Push**

```bash
git push
```

Expected: `main -> main` pushed successfully

**Step 3: Confirm**

```bash
git log --oneline -3
```

Expected: the two new `docs:` commits appear at top
