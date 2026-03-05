# BRC Maximum Protocol Coverage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate 15+ BSV BRC standards into Simply Sats via `@bsv/sdk` adapter pattern, making it one of the most BRC-complete wallets in the ecosystem.

**Architecture:** Add `@bsv/sdk` as a JS dependency. Create a `TauriProtoWallet` adapter implementing the SDK's wallet interface while delegating all crypto to Tauri Rust backend via IPC. New protocol services in `src/services/brc/` consume SDK classes through this adapter. Existing `src/services/brc100/` handlers are enhanced to use the new layer.

**Tech Stack:** TypeScript, `@bsv/sdk` v2.0.5, Tauri 2 (Rust/Axum), React 19, SQLite, Vitest

---

## Phase 1: Foundation

### Task 1: Install @bsv/sdk and verify compatibility

**Files:**
- Modify: `package.json`

**Step 1: Install the SDK**

Run: `npm install @bsv/sdk`

**Step 2: Verify it installed correctly**

Run: `npx tsc --noEmit`
Expected: No new type errors from the SDK (it's zero-dependency)

**Step 3: Verify the SDK exports we need**

Create a temporary test file to confirm imports resolve:

```typescript
// src/services/brc/verify-sdk.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';

describe('@bsv/sdk imports', () => {
  it('exports ProtoWallet', async () => {
    const sdk = await import('@bsv/sdk');
    expect(sdk.ProtoWallet).toBeDefined();
  });

  it('exports Beef', async () => {
    const sdk = await import('@bsv/sdk');
    expect(sdk.Beef).toBeDefined();
  });

  it('exports Certificate', async () => {
    const sdk = await import('@bsv/sdk');
    expect(sdk.Certificate).toBeDefined();
  });

  it('exports AuthFetch', async () => {
    const sdk = await import('@bsv/sdk');
    // AuthFetch may be in auth submodule
    expect(sdk.AuthFetch || sdk.Peer).toBeDefined();
  });
});
```

**Step 4: Run the test**

Run: `npx vitest run src/services/brc/verify-sdk.test.ts`
Expected: All tests pass. If any import fails, check the SDK's actual export names via `node -e "console.log(Object.keys(require('@bsv/sdk')))"` and adjust.

**Step 5: Commit**

```bash
git add package.json package-lock.json src/services/brc/verify-sdk.test.ts
git commit -m "feat: install @bsv/sdk for BRC protocol coverage"
```

---

### Task 2: Create TauriProtoWallet adapter — tests first

**Files:**
- Create: `src/services/brc/adapter.test.ts`
- Create: `src/services/brc/adapter.ts`

**Context:** The SDK's `ProtoWallet` is an abstract class with these key methods:
- `getPublicKey(args)` — derive and return a public key
- `createSignature(args)` — sign data with derived key
- `verifySignature(args)` — verify ECDSA signature
- `createHmac(args)` — HMAC with derived key
- `verifyHmac(args)` — verify HMAC
- `encrypt(args)` — ECIES encrypt
- `decrypt(args)` — ECIES decrypt

Our adapter delegates each to existing Tauri commands: `sign_data_from_store`, `encrypt_ecies_from_store`, `decrypt_ecies_from_store`, `brc42_derivation::derive_child_key`, etc.

**Important:** Before writing this adapter, read the actual `ProtoWallet` interface from the installed SDK:
```bash
# Find and read the ProtoWallet definition
grep -r "class ProtoWallet" node_modules/@bsv/sdk/ --include="*.ts" --include="*.d.ts" -l
# Then read the file to get exact method signatures
```

**Step 1: Write failing tests**

```typescript
// src/services/brc/adapter.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri IPC
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { TauriProtoWallet } from './adapter';

const mockedInvoke = vi.mocked(invoke);

describe('TauriProtoWallet', () => {
  let wallet: TauriProtoWallet;

  beforeEach(() => {
    vi.clearAllMocks();
    wallet = new TauriProtoWallet();
  });

  describe('getPublicKey', () => {
    it('returns identity key for self/anyone counterparty', async () => {
      mockedInvoke.mockResolvedValueOnce({
        walletPubKey: '02abc...',
        identityPubKey: '03def...',
        ordPubKey: '02ghi...',
      });
      const result = await wallet.getPublicKey({
        counterparty: 'self',
        protocolID: [2, 'test-protocol'],
        keyID: '1',
      });
      expect(result.publicKey).toBeDefined();
      expect(typeof result.publicKey).toBe('string');
    });

    it('derives child public key for specific counterparty', async () => {
      mockedInvoke.mockResolvedValueOnce({
        pubKey: '02derived...',
        address: '1derived...',
        wif: 'ignored',
      });
      const result = await wallet.getPublicKey({
        counterparty: '03specific_counterparty_pubkey...',
        protocolID: [2, 'test-protocol'],
        keyID: '1',
      });
      expect(result.publicKey).toBe('02derived...');
    });
  });

  describe('createSignature', () => {
    it('signs data via Tauri and returns signature bytes', async () => {
      const mockSigHex = 'deadbeef';
      mockedInvoke.mockResolvedValueOnce(mockSigHex);
      const result = await wallet.createSignature({
        data: [1, 2, 3, 4],
        protocolID: [2, 'test-protocol'],
        keyID: '1',
        counterparty: 'self',
      });
      expect(result.signature).toBeDefined();
      expect(mockedInvoke).toHaveBeenCalled();
    });
  });

  describe('encrypt', () => {
    it('encrypts via Tauri ECIES', async () => {
      mockedInvoke.mockResolvedValueOnce({
        ciphertext: 'abcdef',
        senderPublicKey: '02sender...',
      });
      const result = await wallet.encrypt({
        plaintext: [72, 101, 108, 108, 111],
        protocolID: [2, 'test-protocol'],
        keyID: '1',
        counterparty: 'self',
      });
      expect(result.ciphertext).toBeDefined();
    });
  });

  describe('decrypt', () => {
    it('decrypts via Tauri ECIES', async () => {
      mockedInvoke.mockResolvedValueOnce('Hello');
      const result = await wallet.decrypt({
        ciphertext: [1, 2, 3, 4, 5],
        protocolID: [2, 'test-protocol'],
        keyID: '1',
        counterparty: '03sender_pubkey...',
      });
      expect(result.plaintext).toBeDefined();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/brc/adapter.test.ts`
Expected: FAIL — `TauriProtoWallet` not found

**Step 3: Implement TauriProtoWallet**

```typescript
// src/services/brc/adapter.ts
import { invoke } from '@tauri-apps/api/core';
// Import ProtoWallet and types from SDK — adjust imports based on actual SDK exports
// Read node_modules/@bsv/sdk to find exact export paths

/**
 * Bridges @bsv/sdk's ProtoWallet interface to Tauri Rust backend.
 * Private keys NEVER leave Rust memory — all crypto via IPC.
 */
export class TauriProtoWallet {
  // Implement based on SDK's ProtoWallet interface
  // Each method delegates to existing Tauri commands:
  //
  // getPublicKey → invoke('get_public_keys') for self/anyone,
  //                invoke('derive_child_key') for specific counterparty
  // createSignature → invoke('sign_data_from_store', { data, keyType: 'identity' })
  // verifySignature → invoke('verify_data_signature', { publicKeyHex, data, signatureHex })
  // createHmac → derive key via BRC-42, then HMAC locally with @noble/hashes
  // verifyHmac → same derivation + local verification
  // encrypt → invoke('encrypt_ecies_from_store', { plaintext, recipientPubKey, ... })
  // decrypt → invoke('decrypt_ecies_from_store', { ciphertextBytes, senderPubKey, ... })
  //
  // NOTE: The exact method signatures depend on the SDK version.
  // Read the ProtoWallet class from node_modules/@bsv/sdk before implementing.
  // The implementation must match the SDK's expected return types exactly.
  //
  // Key mapping:
  // - protocolID[0] security level + protocolID[1] protocol name → invoice number
  // - BRC-43 invoice format: "securityLevel-protocolName-keyID"
  // - counterparty "self" → use own identity pubkey as sender
  // - counterparty "anyone" → no key derivation, use raw identity key
  // - specific counterparty → BRC-42 derive child key with that counterparty's pubkey

  private buildInvoiceNumber(protocolID: [number, string], keyID: string): string {
    return `${protocolID[0]}-${protocolID[1]}-${keyID}`;
  }
}
```

**Important implementation notes:**
1. Read the actual ProtoWallet class from `node_modules/@bsv/sdk` to get exact method signatures
2. The adapter must handle the `counterparty` parameter correctly:
   - `'self'` → use identity pubkey as both sender and receiver
   - `'anyone'` → use raw key without derivation
   - specific hex pubkey → BRC-42 derive child key
3. Invoice number format: `{securityLevel}-{protocolName}-{keyID}`
4. All private key operations MUST go through `_from_store` Tauri commands

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/brc/adapter.test.ts`
Expected: All pass

**Step 5: Run full test suite to check for regressions**

Run: `npx vitest run`
Expected: 657+ tests pass

**Step 6: Commit**

```bash
git add src/services/brc/adapter.ts src/services/brc/adapter.test.ts
git commit -m "feat(brc): add TauriProtoWallet adapter bridging SDK to Rust key store"
```

---

### Task 3: Add new Tauri commands for SDK compatibility

**Files:**
- Modify: `src-tauri/src/brc42_derivation.rs`
- Modify: `src-tauri/src/key_store.rs`
- Modify: `src-tauri/src/lib.rs`

**Context:** The SDK's ProtoWallet needs operations that may not have exact Tauri command equivalents:
- `createHmac` — needs BRC-42 key derivation + HMAC-SHA256
- `verifyHmac` — same
- `getPublicKey` with specific counterparty — needs to derive without exposing private key

Check if existing commands cover all cases. If not:

**Step 1: Add `derive_public_key_from_store` command**

This derives a BRC-42 child PUBLIC key without returning the WIF. Needed for `getPublicKey` with specific counterparty.

In `src-tauri/src/brc42_derivation.rs`, add:
```rust
#[tauri::command]
pub async fn derive_public_key_from_store(
    key_type: String,
    sender_pub_key: String,
    invoice_number: String,
    key_store: State<'_, KeyStore>,
) -> Result<String, String> {
    let store = key_store.inner.lock().map_err(|e| e.to_string())?;
    let wif = store.get_wif_by_type(&key_type)?;
    let result = derive_child_key(wif, sender_pub_key, invoice_number)?;
    Ok(result.pub_key) // Only return public key, not WIF
}
```

**Step 2: Add `hmac_sha256_from_store` command**

In `src-tauri/src/key_store.rs`, add:
```rust
#[tauri::command]
pub async fn hmac_sha256_from_store(
    data: Vec<u8>,
    key_type: String,
    sender_pub_key: String,
    invoice_number: String,
    key_store: State<'_, KeyStore>,
) -> Result<Vec<u8>, String> {
    // 1. Derive child key via BRC-42
    // 2. Use derived private key bytes as HMAC key
    // 3. HMAC-SHA256(data) and return
    // 4. Zero the derived key from memory
}
```

**Step 3: Register new commands in lib.rs**

Add to the `.invoke_handler(tauri::generate_handler![...])` list:
```rust
brc42_derivation::derive_public_key_from_store,
key_store::hmac_sha256_from_store,
```

**Step 4: Build the Rust backend**

Run: `cd src-tauri && cargo build`
Expected: Compiles successfully

**Step 5: Commit**

```bash
git add src-tauri/src/brc42_derivation.rs src-tauri/src/key_store.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): add derive_public_key_from_store and hmac_sha256_from_store commands"
```

---

## Phase 2: BEEF Transaction Format (BRC-62/95/96)

### Task 4: BEEF service — tests first

**Files:**
- Create: `src/services/brc/beef.test.ts`
- Create: `src/services/brc/beef.ts`

**Step 1: Write failing tests**

```typescript
// src/services/brc/beef.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { BeefService } from './beef';

describe('BeefService', () => {
  describe('wrapInBeef', () => {
    it('wraps a raw transaction hex in BEEF format', () => {
      const rawTxHex = '0100000001...'; // minimal valid tx hex
      const service = new BeefService();
      const beef = service.wrapInBeef(rawTxHex);
      expect(beef).toBeInstanceOf(Uint8Array);
      // BEEF magic bytes: 0100BEEF
      expect(beef[0]).toBe(0x01);
    });
  });

  describe('parseBeef', () => {
    it('parses BEEF binary back to transaction data', () => {
      const service = new BeefService();
      // Create BEEF, then parse it
      const rawTxHex = '0100000001...';
      const beef = service.wrapInBeef(rawTxHex);
      const parsed = service.parseBeef(beef);
      expect(parsed.txid).toBeDefined();
      expect(parsed.rawTx).toBeDefined();
    });
  });

  describe('isBeef', () => {
    it('returns true for valid BEEF data', () => {
      const service = new BeefService();
      const beef = service.wrapInBeef('0100000001...');
      expect(service.isBeef(beef)).toBe(true);
    });

    it('returns false for raw transaction data', () => {
      const service = new BeefService();
      expect(service.isBeef(new Uint8Array([0x01, 0x00]))).toBe(false);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/brc/beef.test.ts`
Expected: FAIL

**Step 3: Implement BeefService**

```typescript
// src/services/brc/beef.ts
import { Beef, Transaction } from '@bsv/sdk';

/**
 * BEEF transaction format service (BRC-62/95/96).
 * Wraps transactions with SPV proof data for peer-to-peer verification.
 */
export class BeefService {
  /**
   * Wrap a raw transaction hex in BEEF format.
   * For transactions without Merkle proofs yet (unconfirmed),
   * creates a minimal BEEF envelope.
   */
  wrapInBeef(rawTxHex: string): Uint8Array {
    const tx = Transaction.fromHex(rawTxHex);
    const beef = new Beef();
    beef.mergeTx(tx);
    return beef.toBinary();
  }

  /**
   * Parse BEEF binary data back to transaction information.
   */
  parseBeef(data: Uint8Array): { txid: string; rawTx: string } {
    const beef = Beef.fromBinary(data);
    // Get the main transaction (last in topological order)
    const tx = beef.atomicTx;
    return {
      txid: tx.id('hex'),
      rawTx: tx.toHex(),
    };
  }

  /**
   * Check if data is BEEF format (has BEEF magic bytes).
   */
  isBeef(data: Uint8Array): boolean {
    // BEEF v1 magic: 0100BEEF, v2 magic: 0200BEEF
    if (data.length < 4) return false;
    return (data[2] === 0xBE && data[3] === 0xEF);
  }
}
```

**Note:** Adjust based on actual SDK API. Read `node_modules/@bsv/sdk` Beef class for exact methods.

**Step 4: Run tests**

Run: `npx vitest run src/services/brc/beef.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/brc/beef.ts src/services/brc/beef.test.ts
git commit -m "feat(brc-62): add BEEF transaction format service"
```

---

### Task 5: Database migration for BEEF storage

**Files:**
- Create: `src-tauri/migrations/028_brc_beef_support.sql`
- Modify: `src-tauri/src/fresh_install_schema.sql`

**Step 1: Create migration**

```sql
-- 028_brc_beef_support.sql
-- BRC-62/95: Store BEEF-formatted transaction data alongside raw tx
ALTER TABLE transactions ADD COLUMN beef_data BLOB;
```

**Step 2: Update fresh install schema**

Add `beef_data BLOB` to the transactions table in `fresh_install_schema.sql`.

**Step 3: Build to verify migration compiles**

Run: `cd src-tauri && cargo build`
Expected: Compiles (migrations are loaded at runtime)

**Step 4: Commit**

```bash
git add src-tauri/migrations/028_brc_beef_support.sql src-tauri/src/fresh_install_schema.sql
git commit -m "feat(brc-62): add beef_data column to transactions table"
```

---

### Task 6: Integrate BEEF into BRC-100 createAction handler

**Files:**
- Modify: `src/services/brc100/formatting.ts`
- Modify: `src/services/brc100/handlers.ts`
- Create: `src/services/brc/beef.integration.test.ts`

**Step 1: Read current formatting.ts and handlers.ts**

Understand how `buildAndBroadcastAction()` works and where BEEF wrapping should occur.

**Step 2: Write integration test**

Test that `createAction` responses include BEEF data when requested.

**Step 3: Modify formatting.ts**

After building and broadcasting a transaction, wrap the response in BEEF format:
- Import `BeefService` from `../brc/beef`
- In `buildAndBroadcastAction()`, after tx broadcast, call `beefService.wrapInBeef(rawTxHex)`
- Include `beef` field in the response alongside existing `rawTx` and `txid`

**Step 4: Run tests**

Run: `npx vitest run src/services/brc100/formatting.test.ts src/services/brc/beef.integration.test.ts`
Expected: All pass

**Step 5: Commit**

```bash
git add src/services/brc100/formatting.ts src/services/brc100/handlers.ts src/services/brc/beef.integration.test.ts
git commit -m "feat(brc-62): integrate BEEF format into createAction responses"
```

---

## Phase 3: Mutual Authentication (BRC-103/104)

### Task 7: Auth client service — tests first

**Files:**
- Create: `src/services/brc/auth.test.ts`
- Create: `src/services/brc/auth.ts`

**Step 1: Write failing tests**

```typescript
// src/services/brc/auth.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { AuthService } from './auth';
import { TauriProtoWallet } from './adapter';

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    const wallet = new TauriProtoWallet();
    authService = new AuthService(wallet);
  });

  describe('createAuthenticatedClient', () => {
    it('creates an AuthFetch instance', () => {
      const client = authService.getClient();
      expect(client).toBeDefined();
      // AuthFetch should have a fetch-like interface
      expect(typeof client.fetch).toBe('function');
    });
  });

  describe('getIdentityKey', () => {
    it('returns the wallet identity public key', async () => {
      const key = await authService.getIdentityKey();
      expect(typeof key).toBe('string');
    });
  });
});
```

**Step 2: Implement AuthService**

```typescript
// src/services/brc/auth.ts
import { AuthFetch } from '@bsv/sdk';
import type { TauriProtoWallet } from './adapter';

/**
 * Mutual authentication service (BRC-103/104).
 * Enables authenticated HTTP communication with BRC-100 services.
 */
export class AuthService {
  private authFetch: AuthFetch;
  private wallet: TauriProtoWallet;

  constructor(wallet: TauriProtoWallet) {
    this.wallet = wallet;
    this.authFetch = new AuthFetch(wallet);
  }

  /** Get the authenticated HTTP client */
  getClient(): AuthFetch {
    return this.authFetch;
  }

  /** Get the wallet's identity public key */
  async getIdentityKey(): Promise<string> {
    const result = await this.wallet.getPublicKey({
      counterparty: 'self',
      protocolID: [1, 'auth'],
      keyID: '1',
    });
    return result.publicKey;
  }

  /**
   * Make an authenticated HTTP request.
   * Handles BRC-103 nonce exchange and certificate exchange automatically.
   */
  async authenticatedFetch(url: string, options?: RequestInit): Promise<Response> {
    return this.authFetch.fetch(url, options);
  }
}
```

**Step 3: Run tests, verify pass**

Run: `npx vitest run src/services/brc/auth.test.ts`

**Step 4: Commit**

```bash
git add src/services/brc/auth.ts src/services/brc/auth.test.ts
git commit -m "feat(brc-103): add AuthService for mutual authentication"
```

---

### Task 8: Auth server endpoint in Tauri HTTP server

**Files:**
- Modify: `src-tauri/src/http_server.rs`
- Create: `src-tauri/migrations/029_auth_sessions.sql`
- Modify: `src-tauri/src/fresh_install_schema.sql`

**Step 1: Create auth_sessions migration**

```sql
-- 029_auth_sessions.sql
CREATE TABLE IF NOT EXISTS auth_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    peer_identity_key TEXT NOT NULL,
    session_nonce TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    expires_at INTEGER NOT NULL,
    account_id INTEGER NOT NULL DEFAULT 0,
    UNIQUE(peer_identity_key, session_nonce)
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_peer ON auth_sessions(peer_identity_key);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
```

**Step 2: Add `.well-known/auth` route to http_server.rs**

In the router setup (around line 276), add:
```rust
.route("/.well-known/auth", post(handle_auth_request))
```

The `handle_auth_request` handler processes BRC-103 initial auth messages:
1. Parse incoming auth request (identity key + nonce)
2. Verify the signature on the request
3. Generate response nonce
4. Store session in `auth_sessions` table
5. Return signed response with server's identity key

**Note:** This is the most complex Rust change. Read the BRC-103 spec carefully. The SDK's `Peer` class shows the expected message format.

**Step 3: Build**

Run: `cd src-tauri && cargo build`

**Step 4: Commit**

```bash
git add src-tauri/src/http_server.rs src-tauri/migrations/029_auth_sessions.sql src-tauri/src/fresh_install_schema.sql
git commit -m "feat(brc-104): add .well-known/auth endpoint for mutual authentication"
```

---

## Phase 4: Identity Certificates (BRC-52)

### Task 9: Certificate service — tests first

**Files:**
- Create: `src/services/brc/certificates.test.ts`
- Create: `src/services/brc/certificates.ts`

**Step 1: Write failing tests**

```typescript
// src/services/brc/certificates.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { CertificateService } from './certificates';
import { TauriProtoWallet } from './adapter';

describe('CertificateService', () => {
  let certService: CertificateService;

  beforeEach(() => {
    vi.clearAllMocks();
    certService = new CertificateService(new TauriProtoWallet());
  });

  describe('createSelfSignedCert', () => {
    it('creates a certificate signed by the wallet identity key', async () => {
      // Mock Tauri calls
      const cert = await certService.createSelfSignedCert({
        type: 'test-cert',
        fields: { name: 'Alice', email: 'alice@example.com' },
      });
      expect(cert.type).toBe('test-cert');
      expect(cert.fields.name).toBe('Alice');
      expect(cert.signature).toBeDefined();
    });
  });

  describe('proveCertificate', () => {
    it('reveals only requested fields to verifier', async () => {
      const proof = await certService.proveCertificate({
        certificate: { /* mock cert */ },
        verifierPublicKey: '03verifier...',
        fieldsToReveal: ['name'], // reveal name but NOT email
      });
      expect(proof.keyring).toBeDefined();
      // Keyring should only contain key for 'name' field
    });
  });

  describe('listCertificates', () => {
    it('returns certificates from database', async () => {
      const certs = await certService.listCertificates();
      expect(Array.isArray(certs)).toBe(true);
    });
  });
});
```

**Step 2: Implement CertificateService**

Use SDK's `Certificate`, `MasterCertificate`, `VerifiableCertificate` classes.

```typescript
// src/services/brc/certificates.ts
import { Certificate, MasterCertificate, VerifiableCertificate } from '@bsv/sdk';
import type { TauriProtoWallet } from './adapter';

export class CertificateService {
  private wallet: TauriProtoWallet;

  constructor(wallet: TauriProtoWallet) {
    this.wallet = wallet;
  }

  async createSelfSignedCert(args: {
    type: string;
    fields: Record<string, string>;
  }) {
    // Use SDK Certificate class
    // Sign with wallet identity key via TauriProtoWallet
  }

  async acquireCertificate(args: {
    type: string;
    certifierUrl: string;
    fields: Record<string, string>;
  }) {
    // 1. Connect to certifier via BRC-103 authenticated HTTP
    // 2. Request certificate issuance
    // 3. Certifier verifies identity and signs certificate
    // 4. Store in local database
  }

  async proveCertificate(args: {
    certificate: Certificate;
    verifierPublicKey: string;
    fieldsToReveal: string[];
  }) {
    // Use VerifiableCertificate to create selective disclosure keyring
    // Only the specified fields' encryption keys are revealed
  }

  async listCertificates(filter?: { type?: string; certifier?: string }) {
    // Query certificates table with optional filters
  }

  async relinquishCertificate(serialNumber: string) {
    // Delete certificate from local database
  }

  async checkRevocation(revocationOutpoint: string): Promise<boolean> {
    // Check if the revocation UTXO has been spent
    // If spent, certificate is revoked
  }
}
```

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git add src/services/brc/certificates.ts src/services/brc/certificates.test.ts
git commit -m "feat(brc-52): add CertificateService for identity certificates"
```

---

### Task 10: Database migration for enhanced certificates

**Files:**
- Create: `src-tauri/migrations/030_enhanced_certificates.sql`
- Modify: `src-tauri/src/fresh_install_schema.sql`

**Step 1: Create migration**

```sql
-- 030_enhanced_certificates.sql
-- BRC-52: Enhanced certificate support with selective disclosure
ALTER TABLE certificates ADD COLUMN master_certificate TEXT;
ALTER TABLE certificates ADD COLUMN keyring TEXT;
ALTER TABLE certificates ADD COLUMN revocation_outpoint TEXT;
ALTER TABLE certificates ADD COLUMN certifier_identity_key TEXT;
ALTER TABLE certificates ADD COLUMN account_id INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_certificates_type ON certificates(type);
CREATE INDEX IF NOT EXISTS idx_certificates_certifier ON certificates(certifier);
CREATE INDEX IF NOT EXISTS idx_certificates_account ON certificates(account_id);
```

**Step 2: Update fresh install schema**

**Step 3: Build, verify, commit**

```bash
git add src-tauri/migrations/030_enhanced_certificates.sql src-tauri/src/fresh_install_schema.sql
git commit -m "feat(brc-52): enhance certificates table for selective disclosure"
```

---

### Task 11: Add certificate BRC-100 handlers

**Files:**
- Modify: `src/services/brc100/types.ts`
- Modify: `src/services/brc100/handlers.ts`
- Modify: `src/services/brc100/listener.ts`
- Create: `src/services/brc100/handlers.certificates.test.ts`

**Step 1: Add new request types**

In `types.ts`, add to `BRC100_REQUEST_TYPES`:
```typescript
'acquireCertificate',
'proveCertificate',
'listCertificates',
'relinquishCertificate',
```

**Step 2: Add handlers**

In `handlers.ts`, add cases in `executeApprovedRequest`:
```typescript
case 'acquireCertificate': {
  // Validate params: type, certifier, fields
  // Delegate to CertificateService.acquireCertificate()
}
case 'proveCertificate': {
  // Validate params: certificate, verifierPublicKey, fieldsToReveal
  // Delegate to CertificateService.proveCertificate()
}
case 'listCertificates': {
  // Optional filter by type/certifier
  // Delegate to CertificateService.listCertificates()
}
case 'relinquishCertificate': {
  // Validate params: serialNumber
  // Delegate to CertificateService.relinquishCertificate()
}
```

**Step 3: Add listener routes for read-only certificate ops**

In `listener.ts`, add auto-respond path for `listCertificates` (read-only).

**Step 4: Write tests**

Test each new handler validates params correctly and delegates to CertificateService.

**Step 5: Run all BRC-100 tests**

Run: `npx vitest run src/services/brc100/`

**Step 6: Commit**

```bash
git add src/services/brc100/types.ts src/services/brc100/handlers.ts src/services/brc100/listener.ts src/services/brc100/handlers.certificates.test.ts
git commit -m "feat(brc-52): add certificate request handlers to BRC-100"
```

---

## Phase 5: Payments (BRC-29 + BRC-105)

### Task 12: Payment service — tests first

**Files:**
- Create: `src/services/brc/payments.test.ts`
- Create: `src/services/brc/payments.ts`

**Step 1: Write failing tests**

```typescript
// src/services/brc/payments.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { PaymentService } from './payments';
import { TauriProtoWallet } from './adapter';

describe('PaymentService', () => {
  let paymentService: PaymentService;

  beforeEach(() => {
    vi.clearAllMocks();
    paymentService = new PaymentService(new TauriProtoWallet());
  });

  describe('generateDerivationPrefix', () => {
    it('generates a random derivation prefix', () => {
      const prefix = paymentService.generateDerivationPrefix();
      expect(typeof prefix).toBe('string');
      expect(prefix.length).toBeGreaterThan(0);
    });

    it('generates unique prefixes', () => {
      const a = paymentService.generateDerivationPrefix();
      const b = paymentService.generateDerivationPrefix();
      expect(a).not.toBe(b);
    });
  });

  describe('derivePaymentKey', () => {
    it('derives a per-payment public key from prefix and suffix', async () => {
      const key = await paymentService.derivePaymentKey({
        senderPublicKey: '03sender...',
        derivationPrefix: 'prefix123',
        derivationSuffix: 'suffix456',
      });
      expect(key.publicKey).toBeDefined();
      expect(key.address).toBeDefined();
    });
  });

  describe('handleMicropayment (BRC-105)', () => {
    it('rejects payment above auto-pay threshold without confirmation', async () => {
      const result = await paymentService.shouldAutoPayMicropayment(500);
      expect(result).toBe(false); // 500 > default 100 sats threshold
    });

    it('auto-approves payment below threshold', async () => {
      const result = await paymentService.shouldAutoPayMicropayment(50);
      expect(result).toBe(true); // 50 < 100 sats threshold
    });
  });
});
```

**Step 2: Implement PaymentService**

```typescript
// src/services/brc/payments.ts
import type { TauriProtoWallet } from './adapter';

const DEFAULT_AUTO_PAY_THRESHOLD = 100; // sats

export class PaymentService {
  private wallet: TauriProtoWallet;
  private autoPayThreshold: number;

  constructor(wallet: TauriProtoWallet, autoPayThreshold = DEFAULT_AUTO_PAY_THRESHOLD) {
    this.wallet = wallet;
    this.autoPayThreshold = autoPayThreshold;
  }

  generateDerivationPrefix(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  async derivePaymentKey(args: {
    senderPublicKey: string;
    derivationPrefix: string;
    derivationSuffix: string;
  }): Promise<{ publicKey: string; address: string }> {
    // BRC-29: invoice = "prefix.suffix"
    // Derive child key using BRC-42 with this invoice
    const invoice = `${args.derivationPrefix}.${args.derivationSuffix}`;
    const result = await this.wallet.getPublicKey({
      counterparty: args.senderPublicKey,
      protocolID: [2, 'paymail-payment'],
      keyID: invoice,
    });
    return { publicKey: result.publicKey, address: '' }; // derive address from pubkey
  }

  shouldAutoPayMicropayment(satoshis: number): boolean {
    return satoshis <= this.autoPayThreshold;
  }

  // BRC-105: Handle 402 Payment Required response
  async createMicropayment(args: {
    recipientIdentityKey: string;
    satoshisRequired: number;
    derivationPrefix: string;
  }): Promise<{ paymentTransaction: Uint8Array; derivationSuffix: string }> {
    // 1. Generate derivation suffix
    // 2. Derive payment key (BRC-29)
    // 3. Create P2PKH output to derived address
    // 4. Build and sign transaction
    // 5. Return as BEEF
    const derivationSuffix = this.generateDerivationPrefix(); // reuse random generation
    // ... transaction building
    return { paymentTransaction: new Uint8Array(), derivationSuffix };
  }
}
```

**Step 3: Run tests, verify pass**
**Step 4: Commit**

```bash
git add src/services/brc/payments.ts src/services/brc/payments.test.ts
git commit -m "feat(brc-29): add PaymentService for authenticated P2PKH payments and micropayments"
```

---

### Task 13: Config additions for payments

**Files:**
- Modify: `src/config/index.ts`

**Step 1: Add BRC config section**

After the existing `BRC100` constant, add:

```typescript
export const BRC = {
  BEEF_ENABLED: true,
  AUTH_SESSION_TTL_SECONDS: 3600,
  PIKE_TOTP_WINDOW: 30,
  MICROPAYMENT_AUTO_PAY_THRESHOLD: 100,
  MICROPAYMENT_REQUIRE_CONFIRMATION: true,
  PCW_NOTE_DENOMINATIONS: [100, 1000, 10000, 100000],
  PCW_MAX_CONCURRENT_SETTLEMENTS: 5,
} as const;
```

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/config/index.ts
git commit -m "feat(config): add BRC protocol configuration constants"
```

---

## Phase 6: PIKE Key Exchange (BRC-85)

### Task 14: PIKE service — tests first

**Files:**
- Create: `src/services/brc/pike.test.ts`
- Create: `src/services/brc/pike.ts`

**Step 1: Write failing tests**

```typescript
// src/services/brc/pike.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { PIKEService } from './pike';
import { TauriProtoWallet } from './adapter';

describe('PIKEService', () => {
  let pike: PIKEService;

  beforeEach(() => {
    vi.clearAllMocks();
    pike = new PIKEService(new TauriProtoWallet());
  });

  describe('generateVerificationCode', () => {
    it('generates a 6-digit TOTP code from shared secret', async () => {
      const code = await pike.generateVerificationCode('03contact_pubkey...');
      expect(code).toMatch(/^\d{6}$/);
    });
  });

  describe('verifyCode', () => {
    it('returns true when codes match', async () => {
      // Generate our code, then verify the same code
      const code = await pike.generateVerificationCode('03contact_pubkey...');
      const valid = await pike.verifyCode('03contact_pubkey...', code);
      expect(valid).toBe(true);
    });

    it('returns false for wrong code', async () => {
      const valid = await pike.verifyCode('03contact_pubkey...', '000000');
      expect(valid).toBe(false);
    });
  });
});
```

**Step 2: Implement PIKEService**

```typescript
// src/services/brc/pike.ts
import type { TauriProtoWallet } from './adapter';
import { BRC } from '../../config';

export class PIKEService {
  private wallet: TauriProtoWallet;

  constructor(wallet: TauriProtoWallet) {
    this.wallet = wallet;
  }

  async generateVerificationCode(contactPubKey: string): Promise<string> {
    // 1. Derive ECDH shared secret with contact's pubkey via Tauri
    // 2. Use shared secret as TOTP seed
    // 3. Generate 6-digit code with current time window
    // Uses SDK's TOTP module if available, else implement:
    // - time step = floor(timestamp / PIKE_TOTP_WINDOW)
    // - HMAC-SHA1(shared_secret, time_step) → truncate to 6 digits
    return '000000'; // placeholder
  }

  async verifyCode(contactPubKey: string, code: string): Promise<boolean> {
    const expected = await this.generateVerificationCode(contactPubKey);
    // Constant-time comparison
    if (expected.length !== code.length) return false;
    let result = 0;
    for (let i = 0; i < expected.length; i++) {
      result |= expected.charCodeAt(i) ^ code.charCodeAt(i);
    }
    return result === 0;
  }
}
```

**Step 3: Run tests, verify pass**
**Step 4: Commit**

```bash
git add src/services/brc/pike.ts src/services/brc/pike.test.ts
git commit -m "feat(brc-85): add PIKE key exchange service"
```

---

### Task 15: Database migration for PIKE verification + contacts

**Files:**
- Create: `src-tauri/migrations/031_pike_contacts.sql`
- Modify: `src-tauri/src/fresh_install_schema.sql`

**Step 1: Create migration**

```sql
-- 031_pike_contacts.sql
-- BRC-85: PIKE verification status for contacts
-- Also creates proper identity contacts table for BRC-100 peers
CREATE TABLE IF NOT EXISTS identity_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identity_key TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    pike_verified INTEGER NOT NULL DEFAULT 0,
    pike_verified_at INTEGER,
    first_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    trust_level INTEGER NOT NULL DEFAULT 0,
    account_id INTEGER NOT NULL DEFAULT 0,
    UNIQUE(identity_key, account_id)
);
CREATE INDEX IF NOT EXISTS idx_identity_contacts_account ON identity_contacts(account_id);
```

**Step 2: Update fresh install schema**
**Step 3: Build, verify, commit**

```bash
git add src-tauri/migrations/031_pike_contacts.sql src-tauri/src/fresh_install_schema.sql
git commit -m "feat(brc-85): add identity_contacts table with PIKE verification"
```

---

## Phase 7: Messages (BRC-77/78)

### Task 16: Message service — tests first

**Files:**
- Create: `src/services/brc/messages.test.ts`
- Create: `src/services/brc/messages.ts`

**Step 1: Write failing tests**

```typescript
// src/services/brc/messages.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { MessageService } from './messages';
import { TauriProtoWallet } from './adapter';

describe('MessageService', () => {
  let messageService: MessageService;

  beforeEach(() => {
    vi.clearAllMocks();
    messageService = new MessageService(new TauriProtoWallet());
  });

  describe('createSignedMessage (BRC-77)', () => {
    it('creates a signed message with protocol ID', async () => {
      const msg = await messageService.createSignedMessage({
        data: new Uint8Array([1, 2, 3]),
        protocolID: [2, 'test'],
        keyID: '1',
        counterparty: 'self',
      });
      expect(msg).toBeInstanceOf(Uint8Array);
    });
  });

  describe('createEncryptedMessage (BRC-78)', () => {
    it('creates an encrypted message for a counterparty', async () => {
      const msg = await messageService.createEncryptedMessage({
        data: new Uint8Array([1, 2, 3]),
        protocolID: [2, 'test'],
        keyID: '1',
        counterparty: '03recipient_pubkey...',
      });
      expect(msg).toBeInstanceOf(Uint8Array);
    });
  });
});
```

**Step 2: Implement MessageService**

```typescript
// src/services/brc/messages.ts
import { SignedMessage, EncryptedMessage } from '@bsv/sdk';
import type { TauriProtoWallet } from './adapter';

export class MessageService {
  private wallet: TauriProtoWallet;

  constructor(wallet: TauriProtoWallet) {
    this.wallet = wallet;
  }

  async createSignedMessage(args: {
    data: Uint8Array;
    protocolID: [number, string];
    keyID: string;
    counterparty: string;
  }): Promise<Uint8Array> {
    // Use SDK's SignedMessage.create()
    const msg = await SignedMessage.create(this.wallet, args.data, args.protocolID, args.keyID, args.counterparty);
    return msg.toBinary();
  }

  async verifySignedMessage(data: Uint8Array): Promise<{ valid: boolean; payload: Uint8Array }> {
    const msg = SignedMessage.fromBinary(data);
    const valid = await msg.verify(this.wallet);
    return { valid, payload: msg.payload };
  }

  async createEncryptedMessage(args: {
    data: Uint8Array;
    protocolID: [number, string];
    keyID: string;
    counterparty: string;
  }): Promise<Uint8Array> {
    const msg = await EncryptedMessage.create(this.wallet, args.data, args.protocolID, args.keyID, args.counterparty);
    return msg.toBinary();
  }

  async decryptMessage(data: Uint8Array, counterparty: string): Promise<Uint8Array> {
    const msg = EncryptedMessage.fromBinary(data);
    return msg.decrypt(this.wallet, counterparty);
  }
}
```

**Note:** Adjust based on actual SDK SignedMessage/EncryptedMessage API. Read the SDK source.

**Step 3: Run tests, verify pass**
**Step 4: Commit**

```bash
git add src/services/brc/messages.ts src/services/brc/messages.test.ts
git commit -m "feat(brc-77/78): add signed and encrypted message service"
```

---

## Phase 8: Key Linkage (BRC-69/72)

### Task 17: Key linkage service — tests first

**Files:**
- Create: `src/services/brc/keyLinkage.test.ts`
- Create: `src/services/brc/keyLinkage.ts`

**Step 1: Write failing tests**

Test that `revealCounterpartyKeyLinkage` and `revealSpecificKeyLinkage` produce verifiable linkage proofs.

**Step 2: Implement KeyLinkageService**

```typescript
// src/services/brc/keyLinkage.ts
import type { TauriProtoWallet } from './adapter';

export class KeyLinkageService {
  private wallet: TauriProtoWallet;

  constructor(wallet: TauriProtoWallet) {
    this.wallet = wallet;
  }

  /**
   * BRC-69: Reveal the ECDH shared secret between us and a counterparty
   * to a verifier. The shared secret is encrypted for the verifier (BRC-72).
   */
  async revealCounterpartyKeyLinkage(args: {
    counterparty: string;
    verifier: string;
    protocolID: [number, string];
    keyID: string;
  }): Promise<{ encryptedLinkage: Uint8Array; linkageProof: string }> {
    // 1. Compute ECDH shared secret with counterparty (via Tauri)
    // 2. Encrypt the shared secret for the verifier (BRC-72)
    // 3. Generate a proof that the linkage is valid
    // Delegates to ProtoWallet.revealCounterpartyKeyLinkage if available,
    // or implements manually via derive + encrypt
    throw new Error('Not implemented');
  }

  /**
   * BRC-69: Reveal the derivation of a specific key to a verifier.
   */
  async revealSpecificKeyLinkage(args: {
    counterparty: string;
    verifier: string;
    protocolID: [number, string];
    keyID: string;
  }): Promise<{ encryptedLinkage: Uint8Array }> {
    // Reveal the specific HMAC scalar used for this key derivation
    // Encrypted for the verifier
    throw new Error('Not implemented');
  }
}
```

**Step 3: Run tests, verify pass**
**Step 4: Add BRC-100 handler cases**

Add `revealCounterpartyKeyLinkage` and `revealSpecificKeyLinkage` to handlers.ts and types.ts.

**Step 5: Commit**

```bash
git add src/services/brc/keyLinkage.ts src/services/brc/keyLinkage.test.ts
git commit -m "feat(brc-69/72): add key linkage revelation service"
```

---

## Phase 9: Enhanced Baskets (BRC-46/112/114)

### Task 18: Basket enhancements — tests first

**Files:**
- Create: `src/services/brc/baskets.test.ts`
- Create: `src/services/brc/baskets.ts`
- Create: `src-tauri/migrations/032_basket_enhancements.sql`

**Step 1: Write failing tests**

```typescript
// src/services/brc/baskets.test.ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { BasketService } from './baskets';

describe('BasketService', () => {
  describe('getBasketBalance (BRC-112)', () => {
    it('sums satoshis in a named basket', async () => {
      const service = new BasketService();
      // Mock DB query
      const balance = await service.getBasketBalance('default');
      expect(typeof balance).toBe('number');
    });
  });

  describe('relinquishOutput (BRC-46)', () => {
    it('marks an output as relinquished', async () => {
      const service = new BasketService();
      const result = await service.relinquishOutput('default', 'txid.0');
      expect(result.success).toBe(true);
    });
  });

  describe('listActions with time filter (BRC-114)', () => {
    it('filters actions by timestamp range', async () => {
      const service = new BasketService();
      const actions = await service.listActions({
        since: 1700000000,
        until: 1800000000,
      });
      expect(Array.isArray(actions)).toBe(true);
    });
  });
});
```

**Step 2: Implement BasketService**

```typescript
// src/services/brc/baskets.ts
import { getDatabase } from '../../infrastructure/database/connection';

export class BasketService {
  /** BRC-112: Get total satoshis in a basket */
  async getBasketBalance(basketName: string, accountId = 0): Promise<number> {
    const db = getDatabase();
    const result = await db.select<{ total: number }[]>(
      'SELECT COALESCE(SUM(satoshis), 0) as total FROM utxos WHERE basket = ? AND account_id = ? AND spendable = 1 AND relinquished = 0',
      [basketName, accountId]
    );
    return result[0]?.total ?? 0;
  }

  /** BRC-46: Relinquish an output from a basket */
  async relinquishOutput(basketName: string, outpoint: string, accountId = 0): Promise<{ success: boolean }> {
    const [txid, voutStr] = outpoint.split('.');
    const vout = parseInt(voutStr, 10);
    const db = getDatabase();
    await db.execute(
      'UPDATE utxos SET relinquished = 1 WHERE txid = ? AND vout = ? AND basket = ? AND account_id = ?',
      [txid, vout, basketName, accountId]
    );
    return { success: true };
  }

  /** BRC-114: List actions with time-based filtering */
  async listActions(filter: {
    since?: number;
    until?: number;
    labels?: string[];
    limit?: number;
    offset?: number;
  }, accountId = 0) {
    const db = getDatabase();
    let query = 'SELECT * FROM transactions WHERE account_id = ?';
    const params: unknown[] = [accountId];

    if (filter.since) {
      query += ' AND created_at >= ?';
      params.push(filter.since);
    }
    if (filter.until) {
      query += ' AND created_at <= ?';
      params.push(filter.until);
    }
    query += ' ORDER BY created_at DESC';
    if (filter.limit) {
      query += ' LIMIT ?';
      params.push(filter.limit);
    }
    if (filter.offset) {
      query += ' OFFSET ?';
      params.push(filter.offset);
    }

    return db.select(query, params);
  }
}
```

**Step 3: Create migration**

```sql
-- 032_basket_enhancements.sql
-- BRC-46: Track relinquished outputs
ALTER TABLE utxos ADD COLUMN relinquished INTEGER NOT NULL DEFAULT 0;
```

**Step 4: Run tests, verify pass**
**Step 5: Commit**

```bash
git add src/services/brc/baskets.ts src/services/brc/baskets.test.ts src-tauri/migrations/032_basket_enhancements.sql
git commit -m "feat(brc-46/112/114): add basket balance, relinquish, and time filtering"
```

---

## Phase 10: PCW-1 Peer Cash (BRC-109) — Behind Feature Flag

### Task 19: PCW-1 note management — tests first

**Files:**
- Create: `src/services/brc/pcw.test.ts`
- Create: `src/services/brc/pcw.ts`
- Create: `src-tauri/migrations/033_pcw_tables.sql`

**Step 1: Create PCW database tables**

```sql
-- 033_pcw_tables.sql
-- BRC-109: Peer Cash Wallet protocol tables
CREATE TABLE IF NOT EXISTS pcw_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    txid TEXT NOT NULL,
    vout INTEGER NOT NULL,
    satoshis INTEGER NOT NULL,
    denomination INTEGER NOT NULL,
    derivation_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    peer_identity_key TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    account_id INTEGER NOT NULL DEFAULT 0,
    UNIQUE(txid, vout)
);
CREATE INDEX IF NOT EXISTS idx_pcw_notes_status ON pcw_notes(status);
CREATE INDEX IF NOT EXISTS idx_pcw_notes_account ON pcw_notes(account_id);

CREATE TABLE IF NOT EXISTS pcw_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_hash TEXT NOT NULL UNIQUE,
    merkle_root TEXT NOT NULL,
    payment_amount INTEGER NOT NULL,
    peer_identity_key TEXT NOT NULL,
    receipt_data TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'received',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    account_id INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pcw_receipts_peer ON pcw_receipts(peer_identity_key);
CREATE INDEX IF NOT EXISTS idx_pcw_receipts_account ON pcw_receipts(account_id);
```

**Step 2: Write failing tests**

```typescript
// src/services/brc/pcw.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { PeerCashService } from './pcw';
import { TauriProtoWallet } from './adapter';

describe('PeerCashService', () => {
  let pcw: PeerCashService;

  beforeEach(() => {
    vi.clearAllMocks();
    pcw = new PeerCashService(new TauriProtoWallet());
  });

  describe('splitIntoNotes', () => {
    it('splits amount into bounded denomination notes', () => {
      const notes = pcw.splitIntoNotes(15000);
      // Default denominations: [100, 1000, 10000, 100000]
      // 15000 = 1×10000 + 5×1000
      const total = notes.reduce((sum, n) => sum + n.satoshis, 0);
      expect(total).toBe(15000);
      notes.forEach(note => {
        expect([100, 1000, 10000, 100000]).toContain(note.denomination);
      });
    });

    it('handles exact denomination amounts', () => {
      const notes = pcw.splitIntoNotes(1000);
      expect(notes).toHaveLength(1);
      expect(notes[0].denomination).toBe(1000);
    });

    it('handles amounts smaller than minimum denomination', () => {
      const notes = pcw.splitIntoNotes(50);
      expect(notes).toHaveLength(1);
      expect(notes[0].satoshis).toBe(50);
    });
  });

  describe('disjointCoinSelection', () => {
    it('selects UTXOs not used in other concurrent payments', async () => {
      const utxos = [
        { txid: 'a', vout: 0, satoshis: 5000 },
        { txid: 'b', vout: 0, satoshis: 3000 },
        { txid: 'c', vout: 0, satoshis: 2000 },
      ];
      const reserved = new Set(['a.0']); // already reserved
      const selected = pcw.disjointCoinSelection(utxos, 4000, reserved);
      // Should NOT select 'a.0' since it's reserved
      expect(selected.find(u => u.txid === 'a')).toBeUndefined();
    });
  });

  describe('createReceipt', () => {
    it('creates a Merkle-committed receipt', () => {
      const receipt = pcw.createReceipt({
        amount: 15000,
        peerIdentityKey: '03peer...',
        noteOutpoints: ['txid1.0', 'txid2.0'],
      });
      expect(receipt.merkleRoot).toBeDefined();
      expect(receipt.hash).toBeDefined();
    });
  });
});
```

**Step 3: Implement PeerCashService**

```typescript
// src/services/brc/pcw.ts
import type { TauriProtoWallet } from './adapter';
import { BRC } from '../../config';

interface Note {
  satoshis: number;
  denomination: number;
}

interface CoinInput {
  txid: string;
  vout: number;
  satoshis: number;
}

export class PeerCashService {
  private wallet: TauriProtoWallet;
  private denominations: number[];
  private reservedOutpoints = new Set<string>();

  constructor(wallet: TauriProtoWallet) {
    this.wallet = wallet;
    this.denominations = [...BRC.PCW_NOTE_DENOMINATIONS].sort((a, b) => b - a);
  }

  /** Split an amount into bounded-denomination notes */
  splitIntoNotes(satoshis: number): Note[] {
    const notes: Note[] = [];
    let remaining = satoshis;

    for (const denom of this.denominations) {
      while (remaining >= denom) {
        notes.push({ satoshis: denom, denomination: denom });
        remaining -= denom;
      }
    }
    // Handle remainder smaller than minimum denomination
    if (remaining > 0) {
      notes.push({ satoshis: remaining, denomination: remaining });
    }
    return notes;
  }

  /** Select UTXOs not reserved by other concurrent payments */
  disjointCoinSelection(
    utxos: CoinInput[],
    targetSatoshis: number,
    reserved: Set<string>
  ): CoinInput[] {
    const available = utxos.filter(u => !reserved.has(`${u.txid}.${u.vout}`));
    available.sort((a, b) => b.satoshis - a.satoshis);

    const selected: CoinInput[] = [];
    let total = 0;
    for (const utxo of available) {
      if (total >= targetSatoshis) break;
      selected.push(utxo);
      total += utxo.satoshis;
    }

    if (total < targetSatoshis) {
      throw new Error(`Insufficient non-reserved UTXOs: need ${targetSatoshis}, have ${total}`);
    }
    return selected;
  }

  /** Create a Merkle-committed payment receipt */
  createReceipt(args: {
    amount: number;
    peerIdentityKey: string;
    noteOutpoints: string[];
  }): { merkleRoot: string; hash: string; data: string } {
    // Canonical JSON for deterministic hashing
    const receiptData = JSON.stringify({
      amount: args.amount,
      notes: args.noteOutpoints.sort(),
      peer: args.peerIdentityKey,
      timestamp: Math.floor(Date.now() / 1000),
    });

    // Simple hash for now — production should use Merkle tree
    // Use SHA256 via crypto.subtle
    const hash = receiptData; // placeholder — implement proper SHA256
    return {
      merkleRoot: hash,
      hash,
      data: receiptData,
    };
  }

  /** Reserve outpoints for a concurrent payment */
  reserveOutpoints(outpoints: string[]): void {
    outpoints.forEach(op => this.reservedOutpoints.add(op));
  }

  /** Release reserved outpoints after payment completes/fails */
  releaseOutpoints(outpoints: string[]): void {
    outpoints.forEach(op => this.reservedOutpoints.delete(op));
  }
}
```

**Step 4: Run tests, verify pass**
**Step 5: Commit**

```bash
git add src/services/brc/pcw.ts src/services/brc/pcw.test.ts src-tauri/migrations/033_pcw_tables.sql
git commit -m "feat(brc-109): add PeerCashService with note splitting and disjoint coin selection"
```

---

## Phase 11: Barrel Export, Feature Flags, and Integration

### Task 20: Create barrel export and add feature flags

**Files:**
- Create: `src/services/brc/index.ts`
- Modify: `src/config/index.ts`

**Step 1: Create barrel export**

```typescript
// src/services/brc/index.ts
export { TauriProtoWallet } from './adapter';
export { BeefService } from './beef';
export { AuthService } from './auth';
export { CertificateService } from './certificates';
export { PaymentService } from './payments';
export { PIKEService } from './pike';
export { MessageService } from './messages';
export { KeyLinkageService } from './keyLinkage';
export { PeerCashService } from './pcw';
export { BasketService } from './baskets';
```

**Step 2: Add feature flags**

In `src/config/index.ts`, add to FEATURES:
```typescript
BRC_AUTH: true,           // BRC-103/104 mutual authentication
BRC_CERTIFICATES: true,   // BRC-52 identity certificates
BRC_PAYMENTS: true,        // BRC-29/105 authenticated payments
BRC_PIKE: true,            // BRC-85 key exchange
BRC_MESSAGES: true,        // BRC-77/78 signed/encrypted messages
BRC_KEY_LINKAGE: false,    // BRC-69/72 key linkage (advanced)
BRC_PCW: false,            // BRC-109 peer cash (experimental)
```

**Step 3: Run typecheck and full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All pass

**Step 4: Commit**

```bash
git add src/services/brc/index.ts src/config/index.ts
git commit -m "feat(brc): add barrel export and feature flags for all BRC protocols"
```

---

### Task 21: Update SDK (@simply-sats/sdk) with new capabilities

**Files:**
- Modify: `sdk/src/index.ts`

**Step 1: Add new SDK methods**

Add methods to the `SimplySats` class for each new BRC capability:
```typescript
// Certificate methods (BRC-52)
async acquireCertificate(type: string, certifier: string, fields: Record<string, string>): Promise<CertificateResult>
async proveCertificate(serialNumber: string, verifier: string, fieldsToReveal: string[]): Promise<ProveResult>
async listCertificates(filter?: { type?: string }): Promise<Certificate[]>

// Key linkage (BRC-69)
async revealCounterpartyKeyLinkage(counterparty: string, verifier: string): Promise<LinkageResult>
async revealSpecificKeyLinkage(counterparty: string, protocolID: [number, string], keyID: string, verifier: string): Promise<LinkageResult>

// Basket enhancements (BRC-46/112)
async getBasketBalance(basketName: string): Promise<number>
async relinquishOutput(basketName: string, outpoint: string): Promise<void>
```

**Step 2: Add corresponding HTTP routes in Tauri server**

For each new method, add a route in `http_server.rs` that emits the corresponding `brc100-request` event.

**Step 3: Run SDK tests if they exist**

**Step 4: Commit**

```bash
git add sdk/src/index.ts src-tauri/src/http_server.rs
git commit -m "feat(sdk): expose BRC-52/46/69/112 capabilities in @simply-sats/sdk"
```

---

### Task 22: Delete SDK verification test, run full suite

**Files:**
- Delete: `src/services/brc/verify-sdk.test.ts` (temporary test from Task 1)

**Step 1: Remove temp test**

```bash
rm src/services/brc/verify-sdk.test.ts
```

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All 657+ original tests pass + ~100-150 new BRC tests

**Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Run lint**

Run: `npm run lint`
Expected: No errors

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: cleanup temp test, verify full suite passes with BRC integration"
```

---

## Summary

| Phase | BRCs | Tasks | Key Deliverables |
|-------|------|-------|-----------------|
| 1 Foundation | — | 1-3 | @bsv/sdk installed, TauriProtoWallet adapter, new Tauri commands |
| 2 BEEF | 62/95/96 | 4-6 | BeefService, beef_data migration, createAction integration |
| 3 Auth | 103/104 | 7-8 | AuthService, .well-known/auth endpoint, auth_sessions table |
| 4 Identity | 52 | 9-11 | CertificateService, enhanced certificates table, BRC-100 handlers |
| 5 Payments | 29/105 | 12-13 | PaymentService, micropayment client, config |
| 6 PIKE | 85 | 14-15 | PIKEService, identity_contacts table |
| 7 Messages | 77/78 | 16 | MessageService (signed + encrypted) |
| 8 Key Linkage | 69/72 | 17 | KeyLinkageService, BRC-100 handlers |
| 9 Baskets | 46/112/114 | 18 | BasketService, relinquished column, time filtering |
| 10 PCW | 109 | 19 | PeerCashService (behind feature flag) |
| 11 Integration | — | 20-22 | Barrel export, feature flags, SDK update, full suite verification |

**Total: 22 tasks, ~150-200 new tests, 6 database migrations, 10 new TypeScript modules**

**Testing approach:** TDD throughout. Each service has unit tests with mocked Tauri IPC. Integration tests verify BRC-100 handler wiring. `// @vitest-environment node` for all crypto-dependent tests.

**Risk mitigation:** PCW-1 (BRC-109) and key linkage (BRC-69/72) ship behind feature flags (off by default). All other BRCs are additive and backwards compatible.
