# BRC Maximum Protocol Coverage Design

**Date:** 2026-03-05
**Goal:** Make Simply Sats one of the most BRC-complete wallets in the BSV ecosystem by integrating 15+ BRC standards via `@bsv/sdk` adapter pattern.

## Approach: SDK Integration Layer

Add `@bsv/sdk` (v2.0.5) as a JS dependency. Create a `TauriProtoWallet` adapter that bridges the SDK's protocol classes with Simply Sats' Rust key store. Private keys never leave Rust memory.

### What stays custom
- Wallet state management (React contexts, SQLite repos)
- UTXO tracking, ordinals, tokens, multi-account, auto-lock
- Tauri security model (Rust key storage, PBKDF2 600k, rate limiting)
- UI layer

### What comes from SDK
- BEEF transaction format (BRC-62/95/96)
- Mutual authentication protocol (BRC-103/104)
- Identity certificates (BRC-52)
- Payment protocol (BRC-29, BRC-105)
- Key exchange (BRC-85/PIKE)
- Signed/encrypted messages (BRC-77/78)
- Key linkage (BRC-69/72)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Simply Sats App (React + Contexts)                 │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  src/services/brc/         (NEW)              │  │
│  │  ┌─────────────┐  ┌──────────────────────┐   │  │
│  │  │TauriProto   │  │ Protocol Services     │   │  │
│  │  │Wallet       │  │ ┌──────┐ ┌─────────┐ │   │  │
│  │  │(implements  │  │ │BEEF  │ │Auth     │ │   │  │
│  │  │ SDK Proto-  │──▶│ │62/95 │ │103/104  │ │   │  │
│  │  │ Wallet,     │  │ └──────┘ └─────────┘ │   │  │
│  │  │ delegates   │  │ ┌──────┐ ┌─────────┐ │   │  │
│  │  │ crypto to   │  │ │Pay   │ │Certs    │ │   │  │
│  │  │ Tauri IPC)  │  │ │29/105│ │52       │ │   │  │
│  │  └─────────────┘  │ └──────┘ └─────────┘ │   │  │
│  │                    │ ┌──────┐ ┌─────────┐ │   │  │
│  │                    │ │PIKE  │ │Messages │ │   │  │
│  │                    │ │85    │ │77/78    │ │   │  │
│  │                    │ └──────┘ └─────────┘ │   │  │
│  │                    │ ┌──────┐ ┌─────────┐ │   │  │
│  │                    │ │Key   │ │PCW-1    │ │   │  │
│  │                    │ │Link  │ │109      │ │   │  │
│  │                    │ │69/72 │ │         │ │   │  │
│  │                    │ └──────┘ └─────────┘ │   │  │
│  │                    └──────────────────────┘   │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  src/services/brc100/     (EXISTING, enhanced)│  │
│  │  Handlers, Validation, Formatting, Listener   │  │
│  │  Now delegates BEEF/auth/certs to brc/ layer  │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Existing Services (wallet, database, sync)   │  │
│  └───────────────────────────────────────────────┘  │
│                         │ Tauri IPC                 │
├─────────────────────────┼───────────────────────────┤
│  Tauri Rust Backend     │                           │
│  ┌──────────────────────▼────────────────────────┐  │
│  │  key_store | brc42_derivation | brc100_signing │  │
│  │  http_server (port 3322, add .well-known/auth) │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### New directory structure

```
src/services/brc/
├── adapter.ts          # TauriProtoWallet — implements SDK's ProtoWallet via Tauri IPC
├── beef.ts             # BEEF transaction format (BRC-62/95/96)
├── auth.ts             # Mutual authentication client/server (BRC-103/104)
├── certificates.ts     # Identity certificates (BRC-52)
├── payments.ts         # Authenticated payments (BRC-29) + micropayments (BRC-105)
├── pike.ts             # Proven Identity Key Exchange (BRC-85)
├── messages.ts         # Signed/encrypted messages (BRC-77/78)
├── keyLinkage.ts       # Key linkage revelation (BRC-69/72)
├── pcw.ts              # Peer Cash Wallet protocol (BRC-109)
├── baskets.ts          # Enhanced baskets (BRC-46/112/114)
└── index.ts            # Barrel exports
```

---

## BRC Implementation Details

### 1. TauriProtoWallet Adapter (`adapter.ts`)

The SDK's `ProtoWallet` interface expects:
- `createSignature(args)` — sign data with a derived key
- `verifySignature(args)` — verify ECDSA signature
- `createHmac(args)` — HMAC using derived key
- `verifyHmac(args)` — verify HMAC
- `encrypt(args)` — ECIES encrypt
- `decrypt(args)` — ECIES decrypt
- `getPublicKey(args)` — derive and return public key (never private)

**Our implementation** delegates each to existing Tauri commands:
- `createSignature` → `invoke('brc100_sign', { data, keyType, protocolId, keyId, counterparty })`
- `encrypt/decrypt` → `invoke('brc100_encrypt/decrypt', ...)`
- `getPublicKey` → `invoke('brc42_derive_public_key', ...)`
- Keys stay in Rust; only public keys and ciphertexts cross the IPC boundary.

```typescript
import { ProtoWallet } from '@bsv/sdk';
import { invoke } from '@tauri-apps/api/core';

export class TauriProtoWallet implements ProtoWallet {
  async createSignature(args: CreateSignatureArgs): Promise<CreateSignatureResult> {
    const signature = await invoke<number[]>('brc100_sign', {
      data: Array.from(args.data),
      protocolId: args.protocolID,
      keyId: args.keyID,
      counterparty: args.counterparty,
    });
    return { signature };
  }
  // ... each method delegates to Tauri
}
```

### 2. BEEF Transaction Format — BRC-62/95/96 (`beef.ts`)

**Purpose:** SPV-compliant transaction format with embedded Merkle proofs.

**Implementation:**
- Use SDK's `Beef` class for serialization/deserialization
- `toBeef(tx, merklePath)` — wrap a transaction with its Merkle proof
- `fromBeef(data)` — parse and verify incoming BEEF data
- `Transaction.toBEEF()` — SDK method for conversion

**Integration points:**
- `brc100/formatting.ts` — wrap `createAction` outputs in BEEF when responding to BRC-100 apps
- `infrastructure/broadcast/` — option to broadcast via ARC as BEEF
- Store BEEF data: new column `beef_data BLOB` on `transactions` table

**Migration:**
```sql
ALTER TABLE transactions ADD COLUMN beef_data BLOB;
```

### 3. Mutual Authentication — BRC-103/104 (`auth.ts`)

**Purpose:** Cryptographic mutual authentication so Simply Sats can talk to remote BRC-100 services (and they can talk to it).

**As client (AuthenticatedHttpClient):**
```typescript
import { AuthFetch } from '@bsv/sdk';

export function createAuthenticatedClient(wallet: TauriProtoWallet): AuthFetch {
  return new AuthFetch(wallet);
}

// Usage: const response = await authClient.fetch('https://api.example.com/data');
// AuthFetch handles x-bsv-auth-* headers, nonce exchange, certificate exchange automatically
```

**As server (enhance Tauri HTTP server):**
- Add `/.well-known/auth` POST endpoint in `http_server.rs`
- Store auth session nonces: new `auth_sessions` table
- Route authenticated requests through existing BRC-100 handler pipeline
- Backwards compatible: existing local session-token auth continues working

**Migration:**
```sql
CREATE TABLE auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  peer_identity_key TEXT NOT NULL,
  session_nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  expires_at INTEGER NOT NULL,
  account_id INTEGER REFERENCES accounts(id),
  UNIQUE(peer_identity_key, session_nonce)
);
CREATE INDEX idx_auth_sessions_peer ON auth_sessions(peer_identity_key);
```

### 4. Identity Certificates — BRC-52 (`certificates.ts`)

**Purpose:** Privacy-centric identity with selective field disclosure.

**Implementation using SDK classes:**
- `Certificate` — base certificate with subject, certifier, type, serialNumber, fields, signature
- `MasterCertificate` — encrypted fields with per-field symmetric keys
- `VerifiableCertificate` — selective disclosure via verifier-specific keyrings

**Key flows:**
1. **Acquire:** Request cert from a certifier via BRC-103 authenticated HTTP
2. **Store:** Persist in existing `certificates` table (enhanced schema)
3. **Prove:** Generate keyring revealing only requested fields to a verifier
4. **Revoke:** Monitor `revocationOutpoint` UTXO; if spent, cert is revoked
5. **List/Delete:** Query and manage local certificate store

**Migration (enhance existing certificates table):**
```sql
ALTER TABLE certificates ADD COLUMN master_certificate TEXT;
ALTER TABLE certificates ADD COLUMN keyring TEXT;
ALTER TABLE certificates ADD COLUMN revocation_outpoint TEXT;
ALTER TABLE certificates ADD COLUMN certifier_identity_key TEXT;
ALTER TABLE certificates ADD COLUMN serial_number TEXT;
```

**BRC-100 handler additions:**
- `acquireCertificate` request type
- `proveCertificate` request type
- `listCertificates` request type (enhance existing)
- `relinquishCertificate` request type

### 5. Payments — BRC-29 + BRC-105 (`payments.ts`)

**BRC-29 (Authenticated P2PKH Payments):**

The SDK's `BasicBRC29` module handles derivation-based payment creation:
1. Server sends `derivationPrefix` (random nonce) to client
2. Client chooses `derivationSuffix` (random nonce)
3. Both derive per-payment key: `HMAC(senderPriv × receiverPub, prefix.suffix)`
4. Client creates P2PKH to the derived public key hash
5. Server uses `internalizeAction` to accept

```typescript
import { BasicBRC29 } from '@bsv/sdk';

export class PaymentService {
  private brc29: BasicBRC29;

  constructor(wallet: TauriProtoWallet) {
    this.brc29 = new BasicBRC29(wallet);
  }

  async createPayment(recipientKey: string, satoshis: number): Promise<PaymentResult> {
    // Creates BEEF-wrapped payment tx with derivation prefix/suffix
  }

  async acceptPayment(beefData: Uint8Array, prefix: string, suffix: string): Promise<AcceptResult> {
    // Verifies and internalizes incoming payment
  }
}
```

**BRC-105 (HTTP 402 Micropayments — client side):**

The SDK's `AuthFetch` already handles 402 responses automatically:
1. Makes authenticated request (BRC-103/104)
2. If 402: reads satoshi price from headers
3. Creates BRC-29 payment transaction
4. Retries with `x-bsv-payment` header

**Simply Sats additions:**
- User confirmation before paying (configurable auto-pay threshold in config)
- Payment history tracking in `transactions` table with `micropayment` label
- UI notification when a 402 payment is made

**Config addition:**
```typescript
PAYMENTS: {
  AUTO_PAY_THRESHOLD_SATS: 100,  // Auto-approve payments under this amount
  REQUIRE_CONFIRMATION: true,      // Always confirm payments > threshold
}
```

### 6. PIKE — BRC-85 (`pike.ts`)

**Purpose:** Secure key exchange when adding contacts. Prevents MITM attacks.

**Flow:**
1. Alice and Bob establish a shared secret (ECDH)
2. Both generate a 6-digit TOTP code from the shared secret
3. They verify codes match out-of-band (phone call, in person, etc.)
4. If codes match, they've confirmed each other's identity keys

**Implementation:**
```typescript
import { TOTP } from '@bsv/sdk';

export class PIKEService {
  async initiateKeyExchange(contactPubKey: string): Promise<{ code: string; expiresAt: number }> {
    // Derive shared secret via ECDH (Tauri backend)
    // Generate TOTP code
    // Return code for out-of-band verification
  }

  async verifyKeyExchange(contactPubKey: string, theirCode: string): Promise<boolean> {
    // Verify their TOTP matches our computation
    // If match, mark contact as PIKE-verified
  }
}
```

**Database:** Add `pike_verified BOOLEAN DEFAULT 0` to contacts table.

### 7. Signed/Encrypted Messages — BRC-77/78 (`messages.ts`)

**Purpose:** Standardized portable format for encrypted and signed peer-to-peer messages.

**Implementation:**
- `SignedMessage.create(wallet, data, protocolId, keyId, counterparty)` — create signed message with BRC-3 signature
- `EncryptedMessage.create(wallet, data, protocolId, keyId, counterparty)` — encrypt with BRC-2 ECDH key
- Both produce self-contained binary blobs that any BRC-compliant wallet can verify/decrypt

**Integration:** Enhance existing `encrypt`/`decrypt` BRC-100 handlers to produce BRC-77/78 formatted output when interacting with remote peers.

### 8. Key Linkage Revelation — BRC-69/72 (`keyLinkage.ts`)

**Purpose:** Prove the relationship between keys for audit/compliance.

**Two methods:**
- `revealCounterpartyKeyLinkage(counterpartyKey, verifierKey)` — reveal the ECDH shared secret to a verifier (encrypted with BRC-72)
- `revealSpecificKeyLinkage(counterpartyKey, protocolId, keyId, verifierKey)` — reveal a specific derived key's linkage

**Implementation:** Delegates to `TauriProtoWallet` which computes linkage in Rust and encrypts for the verifier. SDK provides the protocol framing.

**BRC-100 handler additions:**
- `revealCounterpartyKeyLinkage` request type
- `revealSpecificKeyLinkage` request type

### 9. Peer Cash Wallet — BRC-109/PCW-1 (`pcw.ts`)

**Purpose:** Direct IP-to-IP payments using bounded P2PKH "notes" with deterministic key derivation.

**This is the most complex BRC.** Key concepts:
- Payments are split into bounded denominations ("notes") for privacy
- Disjoint coin selection ensures no UTXO is used in multiple concurrent payments
- Merkle-committed receipts provide non-repudiation
- Canonical JSON for deterministic hashing
- Uses only standard Bitcoin primitives (no new opcodes)

**Implementation (7 sub-modules):**
1. **NoteManager** — create and manage bounded-denomination notes
2. **CoinSelector** — disjoint coin selection (marks UTXOs as reserved)
3. **ReceiptBuilder** — Merkle-committed payment receipts
4. **SettlementProtocol** — IP-to-IP settlement handshake
5. **NoteVerifier** — verify incoming notes from peers
6. **ReceiptStore** — persist receipts for non-repudiation
7. **PCWServer** — HTTP endpoint for receiving direct payments

**Database:**
```sql
CREATE TABLE pcw_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txid TEXT NOT NULL,
  vout INTEGER NOT NULL,
  satoshis INTEGER NOT NULL,
  denomination TEXT NOT NULL,
  derivation_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  peer_identity_key TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  account_id INTEGER REFERENCES accounts(id)
);

CREATE TABLE pcw_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_hash TEXT NOT NULL UNIQUE,
  merkle_root TEXT NOT NULL,
  payment_amount INTEGER NOT NULL,
  peer_identity_key TEXT NOT NULL,
  receipt_data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  account_id INTEGER REFERENCES accounts(id)
);
```

**Note:** PCW-1 will be implemented last due to complexity. The SDK does not currently include a PCW-1 module, so this requires the most custom implementation.

### 10. Enhanced Baskets — BRC-46/112/114 (`baskets.ts`)

**BRC-46 (Output Baskets) — enhance existing:**
- Add `relinquishOutput(basketName, outpoint)` — remove output from basket tracking
- Enforce per-basket permissions (which apps can access which baskets)
- Already have baskets in DB; add permission enforcement in BRC-100 handlers

**BRC-112 (Balance Baskets):**
- New `getBasketBalance(basketName)` method — sum satoshis in a basket
- Expose via BRC-100 handler for apps to query basket totals

**BRC-114 (Time Labels):**
- Add `since` and `until` timestamp filters to `listActions` queries
- Filter transactions by creation time in existing database queries
- Enhancement to existing `listOutputs` and activity tab

**Migrations:**
```sql
ALTER TABLE utxos ADD COLUMN relinquished BOOLEAN DEFAULT 0;
ALTER TABLE utxo_tags ADD COLUMN permission_group TEXT;
```

---

## Implementation Phases

### Phase 1: Foundation (adapter + BEEF + baskets)
1. Install `@bsv/sdk` dependency
2. Create `TauriProtoWallet` adapter
3. Implement BEEF format support (BRC-62/95)
4. Enhance baskets (BRC-46/112/114)
5. Add new Tauri commands for SDK-compatible crypto ops if needed

### Phase 2: Authentication & Identity
6. Implement mutual auth client (BRC-103/104)
7. Add `.well-known/auth` server endpoint
8. Implement certificate lifecycle (BRC-52)
9. Add PIKE key exchange (BRC-85)

### Phase 3: Payments & Messaging
10. Implement BRC-29 payment protocol
11. Add BRC-105 micropayment client (402 handling)
12. Implement signed/encrypted messages (BRC-77/78)
13. Add key linkage revelation (BRC-69/72)

### Phase 4: Advanced
14. Implement PCW-1 peer cash protocol (BRC-109)
15. Integration testing across all BRC layers
16. Update SDK (`@simply-sats/sdk`) to expose new capabilities

---

## Database Migrations Summary

New migration file: `028_brc_protocol_support.sql`

```sql
-- BRC-62: BEEF transaction storage
ALTER TABLE transactions ADD COLUMN beef_data BLOB;

-- BRC-103: Auth sessions
CREATE TABLE IF NOT EXISTS auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  peer_identity_key TEXT NOT NULL,
  session_nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  expires_at INTEGER NOT NULL,
  account_id INTEGER REFERENCES accounts(id),
  UNIQUE(peer_identity_key, session_nonce)
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_peer ON auth_sessions(peer_identity_key);

-- BRC-52: Enhanced certificates
ALTER TABLE certificates ADD COLUMN master_certificate TEXT;
ALTER TABLE certificates ADD COLUMN keyring TEXT;
ALTER TABLE certificates ADD COLUMN revocation_outpoint TEXT;
ALTER TABLE certificates ADD COLUMN certifier_identity_key TEXT;
ALTER TABLE certificates ADD COLUMN serial_number TEXT;

-- BRC-85: PIKE verification
ALTER TABLE contacts ADD COLUMN pike_verified BOOLEAN DEFAULT 0;

-- BRC-46: Basket permissions
ALTER TABLE utxos ADD COLUMN relinquished BOOLEAN DEFAULT 0;

-- BRC-109: PCW-1 notes and receipts
CREATE TABLE IF NOT EXISTS pcw_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txid TEXT NOT NULL,
  vout INTEGER NOT NULL,
  satoshis INTEGER NOT NULL,
  denomination TEXT NOT NULL,
  derivation_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  peer_identity_key TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  account_id INTEGER REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS pcw_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_hash TEXT NOT NULL UNIQUE,
  merkle_root TEXT NOT NULL,
  payment_amount INTEGER NOT NULL,
  peer_identity_key TEXT NOT NULL,
  receipt_data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  account_id INTEGER REFERENCES accounts(id)
);
```

---

## Config Additions

```typescript
// src/config/index.ts additions
BRC: {
  BEEF_ENABLED: true,
  AUTH_SESSION_TTL_SECONDS: 3600,
  PIKE_TOTP_WINDOW: 30,  // seconds
  MICROPAYMENT_AUTO_PAY_THRESHOLD: 100,  // sats
  MICROPAYMENT_REQUIRE_CONFIRMATION: true,
  PCW_NOTE_DENOMINATIONS: [100, 1000, 10000, 100000],  // sats
  PCW_MAX_CONCURRENT_SETTLEMENTS: 5,
}
```

---

## Testing Strategy

- Unit tests for each `src/services/brc/*.ts` module (vitest, `// @vitest-environment node` for crypto)
- Integration tests for TauriProtoWallet adapter with mocked Tauri IPC
- Protocol conformance tests comparing output against SDK's expected formats
- End-to-end tests for auth handshake, payment flow, certificate exchange
- Target: maintain 657+ test count, add ~150-200 new tests

## Risk Mitigation

- **SDK size (27MB):** Acceptable for desktop app, no impact on bundle
- **Key security:** TauriProtoWallet never exposes private keys to JS — all crypto via Tauri IPC
- **Backwards compatibility:** Existing BRC-100 local app flow unchanged; new auth is additive
- **PCW-1 complexity:** Implemented last, behind feature flag, independent of other BRCs
- **Migration safety:** DDL only (learned lesson), append-only, no DML in Tauri migrations
