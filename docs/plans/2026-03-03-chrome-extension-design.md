# Chrome Extension Port — Simply Sats

## Context

Simply Sats is a BSV wallet desktop app built with Tauri 2 + React 19 + TypeScript. The user wants a **full standalone Chrome extension** version that shares core logic with the desktop app via a **monorepo** structure. The extension should be a **Manifest V3** popup (400x600) with BRC-100 support via **native messaging** to a companion process.

~80% of the codebase (React UI, contexts, API clients, sql.js database, Web Crypto) is already browser-compatible. The 20% that needs porting is the Rust backend: transaction building/signing, key derivation, secure key storage, BRC-100 HTTP server, and rate limiting.

## Architecture Overview

```
simply-sats/                          # Monorepo root
├── packages/
│   ├── shared/                       # Extracted shared code (NEW)
│   │   ├── src/
│   │   │   ├── domain/              # ← moved from src/domain/
│   │   │   ├── services/            # ← moved from src/services/
│   │   │   ├── infrastructure/      # ← moved from src/infrastructure/
│   │   │   ├── config/              # ← moved from src/config/
│   │   │   ├── utils/               # ← moved from src/utils/
│   │   │   ├── platform/            # Platform abstraction layer (NEW)
│   │   │   │   ├── types.ts         # PlatformAdapter interface
│   │   │   │   ├── tauri.ts         # Tauri implementation
│   │   │   │   ├── chrome.ts        # Chrome extension implementation
│   │   │   │   └── index.ts         # Platform detection + singleton
│   │   │   └── crypto/              # Pure TS crypto (NEW - replaces Rust)
│   │   │       ├── secp256k1.ts     # ECDSA sign/verify via @noble/secp256k1
│   │   │       ├── keyDerivation.ts # BIP-32/44 HD key derivation
│   │   │       ├── transaction.ts   # P2PKH tx builder + signer
│   │   │       └── brc42.ts         # BRC-42/43 key derivation
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── desktop/                      # Existing Tauri app (MOVED from root)
│   │   ├── src/
│   │   │   ├── components/          # React UI (stays here)
│   │   │   ├── contexts/            # React contexts (stays here)
│   │   │   ├── hooks/               # React hooks (stays here)
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── src-tauri/               # Rust backend (unchanged)
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── extension/                    # Chrome extension (NEW)
│       ├── src/
│       │   ├── popup/               # Popup UI (400x600)
│       │   │   ├── App.tsx          # Extension-specific App shell
│       │   │   ├── main.tsx         # Popup entry point
│       │   │   └── components/      # Extension-specific UI overrides
│       │   ├── background/          # Service worker
│       │   │   └── service-worker.ts
│       │   ├── content/             # Content script (for dApp injection)
│       │   │   └── content.ts
│       │   └── native-host/         # Native messaging host (BRC-100)
│       │       ├── host.ts          # Node.js stdio bridge
│       │       └── install.sh       # Host manifest installer
│       ├── public/
│       │   └── manifest.json        # Manifest V3
│       ├── package.json
│       └── vite.config.ts
│
├── package.json                      # Workspace root
└── tsconfig.base.json               # Shared TS config
```

## Platform Abstraction Layer

The key architectural pattern: a `PlatformAdapter` interface that abstracts all platform-specific operations. Both Tauri and Chrome extension provide implementations.

```typescript
// packages/shared/src/platform/types.ts
interface PlatformAdapter {
  // Key operations (currently Rust-only)
  deriveWalletKeys(mnemonic: string): Promise<WalletKeys>
  deriveWalletKeysForAccount(mnemonic: string, accountIndex: number): Promise<WalletKeys>
  keysFromWif(wif: string): Promise<KeyPair>

  // Transaction building (currently Rust-only)
  buildP2PKHTx(params: BuildP2PKHTxParams): Promise<BuiltTransaction>
  buildMultiKeyP2PKHTx(params: BuildMultiKeyP2PKHTxParams): Promise<BuiltTransaction>
  buildConsolidationTx(params: BuildConsolidationTxParams): Promise<BuiltConsolidationTransaction>
  buildMultiOutputP2PKHTx(params: BuildMultiOutputP2PKHTxParams): Promise<BuiltMultiOutputTransaction>

  // Secure key storage
  storeKeys(keys: WalletKeys, password: string): Promise<void>
  getWifForOperation(): Promise<string>
  getMnemonicOnce(): Promise<string>

  // BRC-100 signing
  createSignature(message: string): Promise<string>

  // Rate limiting
  recordFailedUnlock(): Promise<{ locked: boolean; retryAfterMs: number }>
  checkUnlockRateLimit(): Promise<{ allowed: boolean; retryAfterMs: number }>

  // Storage
  secureSet(key: string, value: string): Promise<void>
  secureGet(key: string): Promise<string | null>

  // Platform detection
  readonly platform: 'tauri' | 'chrome-extension' | 'browser'
}
```

**Tauri adapter** (`platform/tauri.ts`): delegates to existing `tauriInvoke()` calls — zero behavior change for desktop.

**Chrome adapter** (`platform/chrome.ts`): uses pure TypeScript crypto + `chrome.storage.local` + Web Crypto encryption.

## Pure TypeScript Crypto Layer

The biggest porting effort. Currently these operations are Rust-only:

### 1. Key Derivation (`packages/shared/src/crypto/keyDerivation.ts`)
- BIP-39 mnemonic → seed (already have `bip39` npm package)
- BIP-32 HD key derivation using `@noble/secp256k1` + `@noble/hashes`
- BIP-44 paths: `m/44'/236'/N'/1/0` (wallet), `m/44'/236'/(N*2+1)'/0/0` (ordinals), `m/0'/236'/N'/0/0` (identity)
- Output: WIF, compressed pubkey, P2PKH address

### 2. Transaction Builder (`packages/shared/src/crypto/transaction.ts`)
- Pure P2PKH transaction construction (inputs, outputs, serialization)
- ECDSA signing with `@noble/secp256k1`
- SIGHASH_ALL signing for each input
- Change output calculation (reuses existing `calculateChangeAndFee`)
- ~400-500 lines of TypeScript

### 3. BRC-42 Derivation (`packages/shared/src/crypto/brc42.ts`)
- ECDH key agreement using secp256k1
- HMAC-SHA256 for child key derivation
- Port from `src-tauri/src/bsv_sdk_adapter.rs`

### New Dependencies
- `@noble/secp256k1` — pure JS secp256k1 (ECDSA, ECDH)
- `@noble/hashes` — pure JS SHA-256, HMAC, RIPEMD-160, PBKDF2
- `@noble/curves` — may be needed for BIP-32 derivation helpers

## Chrome Extension Components

### Manifest V3 (`manifest.json`)
```json
{
  "manifest_version": 3,
  "name": "Simply Sats",
  "version": "0.1.0",
  "action": { "default_popup": "popup.html" },
  "background": { "service_worker": "service-worker.js" },
  "permissions": ["storage", "nativeMessaging", "alarms"],
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"]
  }]
}
```

### Service Worker (`background/service-worker.ts`)
- Manages wallet state persistence (popup can close/reopen)
- Handles `chrome.alarms` for auto-lock timer
- Routes native messaging for BRC-100
- Manages `chrome.storage.local` for encrypted wallet data
- Badge text for balance display

### Popup (`popup/App.tsx`)
- Reuses all existing React contexts from `packages/shared`
- Reuses all components from desktop (they're already flex-based, adapt with CSS)
- On popup open: hydrate state from service worker via `chrome.runtime.sendMessage`
- On popup close: state persists in service worker

### Content Script (`content/content.ts`)
- Injects `window.simplySats` provider for dApp integration
- Relays messages between page and service worker
- Minimal — just a message bridge

### Native Messaging Host (`native-host/`)
- Small Node.js process for BRC-100 HTTP server on port 3322
- Reads/writes stdio per Chrome native messaging protocol
- Runs the same Axum-equivalent HTTP routes (Express/Fastify)
- Installed separately — `install.sh` registers the native messaging host manifest

## Popup UI Adaptations

The existing UI is designed for a desktop window. For 400x600 popup:

1. **Tab bar** — already horizontal, fits fine at 400px width
2. **Modals** — render full-screen within the popup instead of overlay
3. **Settings** — use back-navigation instead of sidebar layout
4. **QR scanner** — request camera permission, works in extension popup
5. **Scrolling** — add `overflow-y: auto` to main content area

Most components need minimal CSS changes. The heavy-lifting UI components (BalanceDisplay, SendModal, ReceiveModal, ActivityTab) are already responsive.

## State Persistence Strategy

Desktop app: state lives in React contexts, persisted via sql.js + localStorage.

Extension: popup unmounts when closed. Solution:
1. **Service worker** holds authoritative wallet state (locked/unlocked, current account)
2. **Popup** hydrates from service worker on mount, syncs changes back
3. **sql.js database** persisted to `chrome.storage.local` as a blob (OPFS or IndexedDB)
4. **Auto-lock timer** runs in service worker via `chrome.alarms`

## Secure Storage in Extension

Replace Tauri OS keychain with:
1. Encrypted mnemonic stored in `chrome.storage.local` using AES-256-GCM
2. Encryption key derived from user password via PBKDF2 (600K iterations — same as desktop)
3. Decrypted keys held in service worker memory only (never in popup)
4. Service worker clears keys on lock/timeout
5. `chrome.storage.session` for session-scoped data (cleared when browser closes)

## Implementation Phases

### Phase 1: Monorepo Setup + Platform Abstraction (Foundation)
1. Set up npm/pnpm workspaces at repo root
2. Create `packages/shared/` — move `domain/`, `services/`, `infrastructure/`, `config/`, `utils/`
3. Create `packages/desktop/` — move existing app, update imports to use `@simply-sats/shared`
4. Define `PlatformAdapter` interface
5. Create Tauri adapter (wraps existing `tauriInvoke` calls)
6. Wire up `PlatformProvider` context at top of provider hierarchy
7. Verify desktop app still works identically

### Phase 2: Pure TypeScript Crypto (Core Porting)
1. Implement BIP-32 HD key derivation using `@noble/secp256k1` + `@noble/hashes`
2. Implement P2PKH transaction builder + ECDSA signing in pure TypeScript
3. Implement BRC-42/43 key derivation
4. Write parity tests: TS output must match Rust output for same inputs
5. Create Chrome platform adapter using new crypto layer

### Phase 3: Chrome Extension Shell (MVP)
1. Create `packages/extension/` with Vite + React + Manifest V3
2. Build service worker with state management + auto-lock
3. Build popup shell that hydrates from service worker
4. Implement `chrome.storage.local` encrypted storage
5. Wire up shared contexts + components in popup
6. Implement rate limiting in pure TypeScript

### Phase 4: Full Feature Parity
1. Port all 33 modals to work in 400x600 popup
2. Implement content script for dApp injection
3. Build native messaging host for BRC-100 HTTP server
4. QR code scanning in extension popup
5. Backup/restore via file download/upload (no native FS)

### Phase 5: Polish + Testing
1. Extension-specific E2E tests
2. Parity tests (desktop vs extension produce same transactions)
3. Security audit of extension-specific attack surface
4. Chrome Web Store submission preparation

## Critical Files to Modify

| File | Change |
|------|--------|
| `src/domain/wallet/keyDerivation.ts` | Replace `isTauri()` guard with `platform.deriveWalletKeys()` |
| `src/domain/transaction/builder.ts` | Replace `tauriInvoke` calls with `platform.buildP2PKHTx()` etc. |
| `src/services/secureStorage.ts` | Replace `localStorage` with platform-aware storage |
| `src/services/rateLimiter.ts` | Replace `tauriInvoke` with pure JS implementation |
| `src/utils/tauri.ts` | Generalize to `platform.ts` detection |
| `src/AppProviders.tsx` | Add `PlatformProvider` as outermost provider |
| `src/App.tsx` | Extract popup-compatible app shell |

## Reusable Existing Code (No Changes Needed)
- All React contexts (`src/contexts/` — 7 providers)
- All React components (`src/components/` — 51 files)
- All API clients (`src/infrastructure/api/`)
- Crypto service (`src/services/crypto.ts` — Web Crypto API)
- sql.js database layer (`src/infrastructure/database/`)
- All domain types (`src/domain/types.ts`)
- Fee calculation (`src/domain/transaction/fees.ts`)
- Coin selection (`src/domain/transaction/coinSelection.ts`)
- Logger, sync service, accounts service

## Verification Plan

1. **Desktop regression**: After monorepo restructure, run `npm run test:run` (657 tests), `npm run typecheck`, `npm run build`, `npm run tauri:dev` — all must pass
2. **Crypto parity**: Generate test vectors from Rust (known mnemonic → keys, known inputs → signed tx), verify TypeScript produces identical output
3. **Extension build**: `cd packages/extension && npm run build` produces valid `dist/` with manifest.json
4. **Extension load**: Load unpacked extension in Chrome, open popup, create wallet, verify balance display
5. **Send/receive**: Send BSV from extension wallet, verify tx broadcasts and confirms
6. **State persistence**: Close popup, reopen, verify wallet is still unlocked (within timeout)
7. **Auto-lock**: Wait for timeout, verify wallet locks automatically
8. **BRC-100**: Install native messaging host, verify BRC-100 requests are handled
