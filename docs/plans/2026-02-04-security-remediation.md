# Simply Sats Security Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix critical security vulnerabilities and improve code quality in the Simply Sats Bitcoin SV wallet application.

**Architecture:** This plan addresses security issues in priority order: password policy, encryption requirements, signature verification, HTTP authentication, UTXO race conditions, and test coverage. Each task is isolated and can be committed independently.

**Tech Stack:** TypeScript, React, Rust (Tauri), Vitest, @bsv/sdk, Web Crypto API

---

## Task 1: Strengthen Password Policy

**Files:**
- Modify: `/Users/kitclawd/simply-sats/src/services/wallet.ts:923-925`
- Modify: `/Users/kitclawd/simply-sats/src/services/wallet.ts:1012-1014`
- Create: `/Users/kitclawd/simply-sats/src/services/wallet.test.ts`

**Context:** Currently accepts 4-character passwords which are trivially brute-forceable for a crypto wallet.

**Step 1: Write the failing test for password validation**

Create `/Users/kitclawd/simply-sats/src/services/wallet.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { saveWallet, changePassword } from './wallet'

describe('Password Policy', () => {
  const mockWalletKeys = {
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    walletWif: 'L1234567890abcdef',
    walletAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    walletPubKey: '02abcdef1234567890',
    ordWif: 'L1234567890abcdef',
    ordAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    ordPubKey: '02abcdef1234567890',
    identityWif: 'L1234567890abcdef',
    identityAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    identityPubKey: '02abcdef1234567890'
  }

  it('should reject passwords shorter than 8 characters', async () => {
    await expect(saveWallet(mockWalletKeys, 'short')).rejects.toThrow('Password must be at least 8 characters')
    await expect(saveWallet(mockWalletKeys, '1234567')).rejects.toThrow('Password must be at least 8 characters')
  })

  it('should accept passwords with 8 or more characters', async () => {
    // This should not throw
    await expect(saveWallet(mockWalletKeys, 'securepassword123')).resolves.not.toThrow()
  })

  it('should reject empty passwords', async () => {
    await expect(saveWallet(mockWalletKeys, '')).rejects.toThrow('Password must be at least 8 characters')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/kitclawd/simply-sats && npm test -- src/services/wallet.test.ts`

Expected: FAIL - test expects 8 characters but code accepts 4

**Step 3: Update password validation in saveWallet**

In `/Users/kitclawd/simply-sats/src/services/wallet.ts`, change lines 923-925:

```typescript
// Before:
if (!password || password.length < 4) {
  throw new Error('Password must be at least 4 characters')
}

// After:
if (!password || password.length < 8) {
  throw new Error('Password must be at least 8 characters')
}
```

**Step 4: Update password validation in changePassword**

In `/Users/kitclawd/simply-sats/src/services/wallet.ts`, change lines 1012-1014:

```typescript
// Before:
if (!newPassword || newPassword.length < 4) {
  throw new Error('New password must be at least 4 characters')
}

// After:
if (!newPassword || newPassword.length < 8) {
  throw new Error('New password must be at least 8 characters')
}
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/kitclawd/simply-sats && npm test -- src/services/wallet.test.ts`

Expected: PASS

**Step 6: Commit**

```bash
cd /Users/kitclawd/simply-sats
git add src/services/wallet.ts src/services/wallet.test.ts
git commit -m "feat(security): increase minimum password length to 8 characters

BREAKING CHANGE: Users with passwords shorter than 8 characters will need
to update their password on next login.

- Update saveWallet() to require 8+ character passwords
- Update changePassword() to require 8+ character passwords
- Add unit tests for password policy"
```

---

## Task 2: Require Password for All Wallet Storage

**Files:**
- Modify: `/Users/kitclawd/simply-sats/src/services/accounts.ts:78-85`
- Modify: `/Users/kitclawd/simply-sats/src/services/accounts.test.ts` (create)

**Context:** When no password is provided, wallet keys are stored as plain JSON in the database - a severe vulnerability.

**Step 1: Write the failing test**

Create `/Users/kitclawd/simply-sats/src/services/accounts.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAccount } from './accounts'

// Mock the database
vi.mock('./database', () => ({
  getDatabase: () => ({
    execute: vi.fn().mockResolvedValue({ lastInsertId: 1 }),
    select: vi.fn().mockResolvedValue([])
  })
}))

// Mock crypto
vi.mock('./crypto', () => ({
  encrypt: vi.fn().mockResolvedValue({
    version: 1,
    ciphertext: 'encrypted',
    iv: 'iv',
    salt: 'salt',
    iterations: 100000
  })
}))

describe('Account Creation', () => {
  const mockKeys = {
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    walletWif: 'L1234567890abcdef',
    walletAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    walletPubKey: '02abcdef1234567890',
    ordWif: 'L1234567890abcdef',
    ordAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    ordPubKey: '02abcdef1234567890',
    identityWif: 'L1234567890abcdef',
    identityAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    identityPubKey: '02abcdef1234567890'
  }

  it('should reject empty passwords', async () => {
    await expect(createAccount('Test Account', mockKeys, '')).rejects.toThrow(
      'Password is required for wallet encryption'
    )
  })

  it('should reject null/undefined passwords', async () => {
    await expect(createAccount('Test Account', mockKeys, null as any)).rejects.toThrow(
      'Password is required for wallet encryption'
    )
    await expect(createAccount('Test Account', mockKeys, undefined as any)).rejects.toThrow(
      'Password is required for wallet encryption'
    )
  })

  it('should require password to be at least 8 characters', async () => {
    await expect(createAccount('Test Account', mockKeys, 'short')).rejects.toThrow(
      'Password must be at least 8 characters'
    )
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/kitclawd/simply-sats && npm test -- src/services/accounts.test.ts`

Expected: FAIL - current code allows empty passwords

**Step 3: Add password requirement to createAccount**

In `/Users/kitclawd/simply-sats/src/services/accounts.ts`, add validation at the start of `createAccount` function (after line ~60):

```typescript
export async function createAccount(
  name: string,
  keys: WalletKeys,
  password: string
): Promise<number> {
  // Password is required - no unencrypted storage allowed
  if (!password) {
    throw new Error('Password is required for wallet encryption')
  }
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }

  const database = getDatabase()
  // ... rest of function
```

**Step 4: Remove the unencrypted storage path**

In `/Users/kitclawd/simply-sats/src/services/accounts.ts`, change lines 78-85:

```typescript
// Before:
let encryptedKeysStr: string
if (password) {
  const encryptedData = await encrypt(keysJson, password)
  encryptedKeysStr = JSON.stringify(encryptedData)
} else {
  encryptedKeysStr = keysJson
}

// After:
// Always encrypt - password is required (validated above)
const encryptedData = await encrypt(keysJson, password)
const encryptedKeysStr = JSON.stringify(encryptedData)
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/kitclawd/simply-sats && npm test -- src/services/accounts.test.ts`

Expected: PASS

**Step 6: Commit**

```bash
cd /Users/kitclawd/simply-sats
git add src/services/accounts.ts src/services/accounts.test.ts
git commit -m "feat(security): require password for all wallet storage

BREAKING CHANGE: Passwordless wallet creation is no longer supported.

- Add password requirement validation in createAccount()
- Remove unencrypted storage code path
- Add unit tests for password requirements

This prevents wallet keys from ever being stored as plain JSON."
```

---

## Task 3: Implement Real Signature Verification

**Files:**
- Modify: `/Users/kitclawd/simply-sats/src/services/brc100.ts:505-513`
- Create: `/Users/kitclawd/simply-sats/src/services/brc100.test.ts`

**Context:** The `verifySignature` function is a security no-op - it just checks if the signature string is non-empty.

**Step 1: Write the failing test**

Create `/Users/kitclawd/simply-sats/src/services/brc100.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { verifySignature, createSignature } from './brc100'
import { PrivateKey } from '@bsv/sdk'

describe('Signature Verification', () => {
  // Generate a test key pair
  const privateKey = PrivateKey.fromRandom()
  const publicKeyHex = privateKey.toPublicKey().toString()
  const testMessage = 'Hello, Simply Sats!'

  it('should verify a valid signature', async () => {
    const signature = await createSignature(privateKey, testMessage)
    const isValid = verifySignature(publicKeyHex, testMessage, signature)
    expect(isValid).toBe(true)
  })

  it('should reject an invalid signature', () => {
    const fakeSignature = '304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    const isValid = verifySignature(publicKeyHex, testMessage, fakeSignature)
    expect(isValid).toBe(false)
  })

  it('should reject signature for wrong message', async () => {
    const signature = await createSignature(privateKey, testMessage)
    const isValid = verifySignature(publicKeyHex, 'Different message', signature)
    expect(isValid).toBe(false)
  })

  it('should reject signature with wrong public key', async () => {
    const signature = await createSignature(privateKey, testMessage)
    const differentKey = PrivateKey.fromRandom().toPublicKey().toString()
    const isValid = verifySignature(differentKey, testMessage, signature)
    expect(isValid).toBe(false)
  })

  it('should reject empty signature', () => {
    const isValid = verifySignature(publicKeyHex, testMessage, '')
    expect(isValid).toBe(false)
  })

  it('should reject malformed signature', () => {
    const isValid = verifySignature(publicKeyHex, testMessage, 'not-a-valid-signature')
    expect(isValid).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/kitclawd/simply-sats && npm test -- src/services/brc100.test.ts`

Expected: FAIL - current implementation returns true for any non-empty string

**Step 3: Implement real signature verification**

In `/Users/kitclawd/simply-sats/src/services/brc100.ts`, replace lines 505-513:

```typescript
// Before:
export function verifySignature(_publicKeyHex: string, _message: string, signatureHex: string): boolean {
  try {
    // This would need proper implementation with @bsv/sdk verification
    // For now, return true if signature exists
    return signatureHex.length > 0
  } catch {
    return false
  }
}

// After:
import { PublicKey, Signature, BigNumber } from '@bsv/sdk'
import { SHA256 } from '@bsv/sdk'

/**
 * Verify a signature using the BSV SDK
 * @param publicKeyHex - The public key in hex format
 * @param message - The original message that was signed
 * @param signatureHex - The signature in DER hex format
 * @returns true if signature is valid, false otherwise
 */
export function verifySignature(publicKeyHex: string, message: string, signatureHex: string): boolean {
  try {
    // Reject empty or obviously invalid inputs
    if (!publicKeyHex || !message || !signatureHex || signatureHex.length < 8) {
      return false
    }

    // Parse the public key
    const publicKey = PublicKey.fromString(publicKeyHex)

    // Parse the DER-encoded signature
    const signatureBytes = Buffer.from(signatureHex, 'hex')
    const signature = Signature.fromDER(Array.from(signatureBytes))

    // Hash the message (BSV uses double SHA256 for message signing)
    const messageHash = SHA256.hash(SHA256.hash(Buffer.from(message)))

    // Verify the signature
    const msgHashBN = BigNumber.fromArray(Array.from(messageHash))
    return publicKey.verify(msgHashBN, signature)
  } catch (error) {
    // Any parsing or verification error means invalid signature
    console.debug('Signature verification failed:', error)
    return false
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/kitclawd/simply-sats && npm test -- src/services/brc100.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
cd /Users/kitclawd/simply-sats
git add src/services/brc100.ts src/services/brc100.test.ts
git commit -m "feat(security): implement real cryptographic signature verification

- Replace no-op verifySignature with actual ECDSA verification
- Use @bsv/sdk PublicKey.verify() for signature validation
- Add comprehensive unit tests for signature verification
- Reject empty, malformed, and invalid signatures

Previously verifySignature() returned true for any non-empty string,
which was a critical security vulnerability."
```

---

## Task 4: Add Session Token Authentication to HTTP Server

**Files:**
- Modify: `/Users/kitclawd/simply-sats/src-tauri/src/http_server.rs`
- Modify: `/Users/kitclawd/simply-sats/src-tauri/src/lib.rs`

**Context:** The HTTP server on port 3322 is accessible to any local process. CORS only protects browser requests - native apps can bypass it.

**Step 1: Generate session token on app startup**

In `/Users/kitclawd/simply-sats/src-tauri/src/lib.rs`, add session token generation:

```rust
// Add to imports
use rand::Rng;

// Add new struct for session state
pub struct SessionState {
    pub token: String,
}

impl SessionState {
    pub fn new() -> Self {
        let mut rng = rand::thread_rng();
        let token: String = (0..32)
            .map(|_| {
                let idx = rng.gen_range(0..36);
                if idx < 10 {
                    (b'0' + idx) as char
                } else {
                    (b'a' + idx - 10) as char
                }
            })
            .collect();

        Self { token }
    }
}

pub type SharedSessionState = std::sync::Arc<tokio::sync::Mutex<SessionState>>;
```

**Step 2: Pass session state to HTTP server**

Update the `start_server` call in `lib.rs` to include session state:

```rust
// In run() function, create session state
let session_state = std::sync::Arc::new(tokio::sync::Mutex::new(SessionState::new()));

// Pass to HTTP server
tauri::async_runtime::spawn(async move {
    if let Err(e) = http_server::start_server(app_handle_clone, brc100_state_clone, session_state_clone).await {
        eprintln!("HTTP server error: {}", e);
    }
});
```

**Step 3: Add token validation middleware to HTTP server**

In `/Users/kitclawd/simply-sats/src-tauri/src/http_server.rs`:

```rust
use axum::{
    middleware::{self, Next},
    http::{Request, StatusCode, HeaderMap},
    response::Response,
    body::Body,
};

const SESSION_TOKEN_HEADER: &str = "X-Simply-Sats-Token";

// Add session state to AppState
#[derive(Clone)]
struct AppState {
    app_handle: AppHandle,
    brc100_state: SharedBRC100State,
    session_state: SharedSessionState,
}

// Middleware to validate session token
async fn validate_session_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    // Allow getVersion without token (for connection testing)
    if request.uri().path() == "/getVersion" {
        return Ok(next.run(request).await);
    }

    // Check for session token header
    let token_header = headers
        .get(SESSION_TOKEN_HEADER)
        .and_then(|v| v.to_str().ok());

    let session = state.session_state.lock().await;

    match token_header {
        Some(token) if token == session.token => {
            drop(session);
            Ok(next.run(request).await)
        }
        _ => {
            eprintln!("Rejected request: invalid or missing session token");
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

// Update start_server signature
pub async fn start_server(
    app_handle: AppHandle,
    brc100_state: SharedBRC100State,
    session_state: SharedSessionState,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state = AppState {
        app_handle,
        brc100_state,
        session_state,
    };

    // ... existing CORS setup ...

    let app = Router::new()
        .route("/getVersion", post(handle_get_version))
        // ... other routes ...
        .layer(middleware::from_fn_with_state(state.clone(), validate_session_token))
        .layer(cors)
        .with_state(state);

    // ... rest of function
}
```

**Step 4: Add endpoint to retrieve session token (for Tauri frontend only)**

Add a Tauri command in `lib.rs`:

```rust
#[tauri::command]
async fn get_session_token(
    session_state: tauri::State<'_, SharedSessionState>,
) -> Result<String, String> {
    let session = session_state.lock().await;
    Ok(session.token.clone())
}

// Register in builder
.invoke_handler(tauri::generate_handler![
    respond_to_brc100,
    get_session_token,  // Add this
])
```

**Step 5: Update SDK to include session token**

In `/Users/kitclawd/simply-sats/sdk/src/index.ts`, add token header:

```typescript
private async request<T>(endpoint: string, args: object = {}): Promise<T> {
  const response = await fetch(`${this.baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Simply-Sats-Token': this.sessionToken,  // Add token header
    },
    body: JSON.stringify(args),
  })
  // ... rest of method
}
```

**Step 6: Commit**

```bash
cd /Users/kitclawd/simply-sats
git add src-tauri/src/http_server.rs src-tauri/src/lib.rs sdk/src/index.ts
git commit -m "feat(security): add session token authentication to HTTP server

- Generate cryptographically secure session token on app startup
- Add middleware to validate X-Simply-Sats-Token header on all requests
- Allow /getVersion without token for connection testing
- Add get_session_token Tauri command for frontend
- Update SDK to include session token in requests

This prevents unauthorized local processes from accessing the wallet API.
CORS only protects browser requests; native apps could previously bypass it."
```

---

## Task 5: Fix UTXO Spending Race Condition

**Files:**
- Modify: `/Users/kitclawd/simply-sats/src/services/wallet.ts:720-750`
- Modify: `/Users/kitclawd/simply-sats/src/services/database.ts`

**Context:** If the app crashes after broadcast but before marking UTXOs spent, they could be double-spent.

**Step 1: Add pending_spend status to UTXOs**

In `/Users/kitclawd/simply-sats/src/services/database.ts`, add functions:

```typescript
/**
 * Mark UTXOs as pending spend (before broadcast)
 * This provides optimistic locking to prevent double-spend race conditions
 */
export async function markUtxosPendingSpend(
  utxos: Array<{ txid: string; vout: number }>,
  pendingTxid: string
): Promise<void> {
  const db = getDatabase()

  for (const utxo of utxos) {
    await db.execute(
      `UPDATE utxos
       SET spending_status = 'pending',
           pending_spending_txid = $1,
           pending_since = $2
       WHERE txid = $3 AND vout = $4 AND spending_status = 'unspent'`,
      [pendingTxid, Date.now(), utxo.txid, utxo.vout]
    )
  }
}

/**
 * Confirm UTXOs as spent (after successful broadcast)
 */
export async function confirmUtxosSpent(
  utxos: Array<{ txid: string; vout: number }>,
  spendingTxid: string
): Promise<void> {
  const db = getDatabase()

  for (const utxo of utxos) {
    await db.execute(
      `UPDATE utxos
       SET spending_status = 'spent',
           spending_txid = $1,
           pending_spending_txid = NULL,
           pending_since = NULL
       WHERE txid = $2 AND vout = $3`,
      [spendingTxid, utxo.txid, utxo.vout]
    )
  }
}

/**
 * Rollback pending spend (if broadcast fails)
 */
export async function rollbackPendingSpend(
  utxos: Array<{ txid: string; vout: number }>
): Promise<void> {
  const db = getDatabase()

  for (const utxo of utxos) {
    await db.execute(
      `UPDATE utxos
       SET spending_status = 'unspent',
           pending_spending_txid = NULL,
           pending_since = NULL
       WHERE txid = $1 AND vout = $2 AND spending_status = 'pending'`,
      [utxo.txid, utxo.vout]
    )
  }
}
```

**Step 2: Add migration for new columns**

Create `/Users/kitclawd/simply-sats/src-tauri/migrations/006_utxo_pending_status.sql`:

```sql
-- Add columns for tracking pending spend status
ALTER TABLE utxos ADD COLUMN spending_status TEXT DEFAULT 'unspent' CHECK(spending_status IN ('unspent', 'pending', 'spent'));
ALTER TABLE utxos ADD COLUMN pending_spending_txid TEXT;
ALTER TABLE utxos ADD COLUMN pending_since INTEGER;

-- Index for finding pending UTXOs (for recovery)
CREATE INDEX idx_utxos_pending ON utxos(spending_status) WHERE spending_status = 'pending';
```

**Step 3: Update sendTransaction to use optimistic locking**

In `/Users/kitclawd/simply-sats/src/services/wallet.ts`, update the transaction flow:

```typescript
// Before (lines 720-750):
await tx.sign()
const txid = await broadcastTransaction(tx)

try {
  await withTransaction(async () => {
    await recordSentTransaction(...)
    await markUtxosSpent(...)
  })
} catch (error) {
  console.error('CRITICAL: Failed to track transaction locally...')
}

return txid

// After:
import {
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend
} from './database'

await tx.sign()

// Step 1: Mark UTXOs as pending BEFORE broadcast
const utxoRefs = inputsToUse.map(u => ({ txid: u.txid, vout: u.vout }))
const pendingTxid = tx.id('hex')  // Get txid before broadcast

try {
  await markUtxosPendingSpend(utxoRefs, pendingTxid)
} catch (error) {
  throw new Error(`Failed to lock UTXOs for spending: ${error}`)
}

// Step 2: Broadcast transaction
let txid: string
try {
  txid = await broadcastTransaction(tx)
} catch (broadcastError) {
  // Broadcast failed - rollback the pending status
  console.error('Broadcast failed, rolling back UTXO locks:', broadcastError)
  await rollbackPendingSpend(utxoRefs)
  throw broadcastError
}

// Step 3: Confirm spent status after successful broadcast
try {
  await withTransaction(async () => {
    await recordSentTransaction(
      txid,
      tx.toHex(),
      `Sent ${satoshis} sats to ${toAddress}`,
      ['send']
    )
    await confirmUtxosSpent(utxoRefs, txid)
  })
  console.log('Transaction tracked locally:', txid)
} catch (error) {
  // Log but don't fail - tx is already broadcast
  // UTXOs remain in 'pending' state for manual recovery
  console.error('CRITICAL: Failed to confirm UTXO spend status. TXID:', txid, 'Error:', error)
}

return txid
```

**Step 4: Add recovery function for stale pending UTXOs**

In `/Users/kitclawd/simply-sats/src/services/database.ts`:

```typescript
/**
 * Recover stale pending UTXOs (older than 10 minutes)
 * Call this on app startup to handle crash recovery
 */
export async function recoverStalePendingUtxos(): Promise<void> {
  const db = getDatabase()
  const staleThreshold = Date.now() - (10 * 60 * 1000) // 10 minutes

  // Find stale pending UTXOs
  const staleUtxos = await db.select<Array<{ txid: string; vout: number; pending_spending_txid: string }>>(
    `SELECT txid, vout, pending_spending_txid
     FROM utxos
     WHERE spending_status = 'pending' AND pending_since < $1`,
    [staleThreshold]
  )

  for (const utxo of staleUtxos) {
    // Check if the pending transaction was actually broadcast
    try {
      const txExists = await checkTransactionExists(utxo.pending_spending_txid)
      if (txExists) {
        // Transaction was broadcast - confirm as spent
        await db.execute(
          `UPDATE utxos SET spending_status = 'spent', spending_txid = $1, pending_spending_txid = NULL, pending_since = NULL WHERE txid = $2 AND vout = $3`,
          [utxo.pending_spending_txid, utxo.txid, utxo.vout]
        )
        console.log(`Recovered UTXO ${utxo.txid}:${utxo.vout} - marked as spent`)
      } else {
        // Transaction was not broadcast - rollback to unspent
        await db.execute(
          `UPDATE utxos SET spending_status = 'unspent', pending_spending_txid = NULL, pending_since = NULL WHERE txid = $1 AND vout = $2`,
          [utxo.txid, utxo.vout]
        )
        console.log(`Recovered UTXO ${utxo.txid}:${utxo.vout} - rolled back to unspent`)
      }
    } catch (error) {
      console.error(`Failed to recover UTXO ${utxo.txid}:${utxo.vout}:`, error)
    }
  }
}
```

**Step 5: Commit**

```bash
cd /Users/kitclawd/simply-sats
git add src/services/wallet.ts src/services/database.ts src-tauri/migrations/006_utxo_pending_status.sql
git commit -m "fix(security): prevent UTXO double-spend race condition

- Add 'pending' status for UTXOs during transaction broadcast
- Mark UTXOs as pending BEFORE broadcast, confirm AFTER
- Rollback to unspent if broadcast fails
- Add recovery function for stale pending UTXOs on app startup
- Add database migration for new status columns

Previously, a crash between broadcast and database update could cause
UTXOs to be double-spent in subsequent transactions."
```

---

## Task 6: Add Core Cryptographic Tests

**Files:**
- Create: `/Users/kitclawd/simply-sats/src/services/crypto.test.ts`

**Context:** The crypto module handles sensitive wallet encryption but has no tests.

**Step 1: Create comprehensive crypto tests**

Create `/Users/kitclawd/simply-sats/src/services/crypto.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  encrypt,
  decrypt,
  isEncryptedData,
  isLegacyEncrypted,
  migrateLegacyData,
  encryptWithSharedSecret,
  decryptWithSharedSecret,
  generateRandomKey,
  bytesToHex,
  EncryptedData
} from './crypto'

describe('Password-based Encryption', () => {
  const testPassword = 'securepassword123'
  const testPlaintext = 'sensitive wallet data'

  it('should encrypt and decrypt string data', async () => {
    const encrypted = await encrypt(testPlaintext, testPassword)
    const decrypted = await decrypt(encrypted, testPassword)
    expect(decrypted).toBe(testPlaintext)
  })

  it('should encrypt and decrypt object data', async () => {
    const testObject = { mnemonic: 'test words', walletWif: 'L123456' }
    const encrypted = await encrypt(testObject, testPassword)
    const decrypted = await decrypt(encrypted, testPassword)
    expect(JSON.parse(decrypted)).toEqual(testObject)
  })

  it('should produce different ciphertext for same plaintext (random IV/salt)', async () => {
    const encrypted1 = await encrypt(testPlaintext, testPassword)
    const encrypted2 = await encrypt(testPlaintext, testPassword)
    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext)
    expect(encrypted1.iv).not.toBe(encrypted2.iv)
    expect(encrypted1.salt).not.toBe(encrypted2.salt)
  })

  it('should fail decryption with wrong password', async () => {
    const encrypted = await encrypt(testPlaintext, testPassword)
    await expect(decrypt(encrypted, 'wrongpassword')).rejects.toThrow('Decryption failed')
  })

  it('should fail decryption with tampered ciphertext', async () => {
    const encrypted = await encrypt(testPlaintext, testPassword)
    const tampered: EncryptedData = {
      ...encrypted,
      ciphertext: encrypted.ciphertext.slice(0, -4) + 'XXXX'
    }
    await expect(decrypt(tampered, testPassword)).rejects.toThrow('Decryption failed')
  })

  it('should include version and iterations in encrypted data', async () => {
    const encrypted = await encrypt(testPlaintext, testPassword)
    expect(encrypted.version).toBe(1)
    expect(encrypted.iterations).toBe(100000)
  })
})

describe('Encrypted Data Type Guard', () => {
  it('should identify valid encrypted data', () => {
    const valid: EncryptedData = {
      version: 1,
      ciphertext: 'abc123',
      iv: 'def456',
      salt: 'ghi789',
      iterations: 100000
    }
    expect(isEncryptedData(valid)).toBe(true)
  })

  it('should reject invalid encrypted data', () => {
    expect(isEncryptedData(null)).toBe(false)
    expect(isEncryptedData(undefined)).toBe(false)
    expect(isEncryptedData('string')).toBe(false)
    expect(isEncryptedData({ version: 1 })).toBe(false)
    expect(isEncryptedData({ version: '1', ciphertext: 'a', iv: 'b', salt: 'c', iterations: 100 })).toBe(false)
  })
})

describe('Legacy Format Detection', () => {
  it('should detect legacy base64-encoded wallet data', () => {
    const legacyData = btoa(JSON.stringify({
      mnemonic: 'test words here',
      walletWif: 'L1234567890'
    }))
    expect(isLegacyEncrypted(legacyData)).toBe(true)
  })

  it('should reject non-legacy data', () => {
    expect(isLegacyEncrypted('not base64')).toBe(false)
    expect(isLegacyEncrypted(btoa('not json'))).toBe(false)
    expect(isLegacyEncrypted(btoa(JSON.stringify({ other: 'data' })))).toBe(false)
  })
})

describe('Legacy Migration', () => {
  it('should migrate legacy data to new encrypted format', async () => {
    const legacyData = btoa(JSON.stringify({
      mnemonic: 'test mnemonic phrase',
      walletWif: 'L1234567890abcdef'
    }))
    const password = 'migrationpassword'

    const migrated = await migrateLegacyData(legacyData, password)
    expect(isEncryptedData(migrated)).toBe(true)

    // Verify we can decrypt it
    const decrypted = await decrypt(migrated, password)
    const parsed = JSON.parse(decrypted)
    expect(parsed.mnemonic).toBe('test mnemonic phrase')
  })
})

describe('Shared Secret Encryption (ECIES-like)', () => {
  it('should encrypt and decrypt with shared secret', async () => {
    const sharedSecret = await generateRandomKey()
    const message = 'Secret message for derived key holder'

    const encrypted = await encryptWithSharedSecret(message, sharedSecret)
    const decrypted = await decryptWithSharedSecret(encrypted, sharedSecret)

    expect(decrypted).toBe(message)
  })

  it('should fail with wrong shared secret', async () => {
    const secret1 = await generateRandomKey()
    const secret2 = await generateRandomKey()
    const message = 'Secret message'

    const encrypted = await encryptWithSharedSecret(message, secret1)
    await expect(decryptWithSharedSecret(encrypted, secret2)).rejects.toThrow()
  })
})

describe('Utility Functions', () => {
  it('should generate random 32-byte keys', async () => {
    const key1 = await generateRandomKey()
    const key2 = await generateRandomKey()

    expect(key1.length).toBe(64) // 32 bytes = 64 hex chars
    expect(key2.length).toBe(64)
    expect(key1).not.toBe(key2)
  })

  it('should convert bytes to hex correctly', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x0f, 0xff])
    expect(bytesToHex(bytes)).toBe('00010fff')
  })
})
```

**Step 2: Run tests**

Run: `cd /Users/kitclawd/simply-sats && npm test -- src/services/crypto.test.ts`

Expected: PASS (all tests should pass against existing crypto implementation)

**Step 3: Commit**

```bash
cd /Users/kitclawd/simply-sats
git add src/services/crypto.test.ts
git commit -m "test(crypto): add comprehensive encryption unit tests

- Test password-based encryption/decryption
- Test random IV/salt generation
- Test wrong password rejection
- Test tampered ciphertext detection
- Test encrypted data type guard
- Test legacy format detection
- Test legacy migration
- Test shared secret encryption
- Test utility functions

These tests verify the security properties of the crypto module."
```

---

## Task 7: Add Domain Layer Tests

**Files:**
- Create: `/Users/kitclawd/simply-sats/src/domain/wallet/validation.test.ts`
- Create: `/Users/kitclawd/simply-sats/src/domain/wallet/keyDerivation.test.ts`
- Create: `/Users/kitclawd/simply-sats/src/domain/transaction/fees.test.ts`

**Context:** The domain layer contains pure functions that are easy to test but have no coverage.

**Step 1: Create validation tests**

Create `/Users/kitclawd/simply-sats/src/domain/wallet/validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  normalizeMnemonic,
  validateMnemonic,
  isValidBSVAddress,
  isValidTxid,
  isValidSatoshiAmount
} from './validation'

describe('Mnemonic Normalization', () => {
  it('should lowercase and trim', () => {
    expect(normalizeMnemonic('  WORD One TWO  ')).toBe('word one two')
  })

  it('should collapse multiple spaces', () => {
    expect(normalizeMnemonic('word   one    two')).toBe('word one two')
  })
})

describe('Mnemonic Validation', () => {
  const validMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

  it('should accept valid 12-word mnemonic', () => {
    const result = validateMnemonic(validMnemonic)
    expect(result.isValid).toBe(true)
    expect(result.normalizedMnemonic).toBe(validMnemonic)
  })

  it('should reject wrong word count', () => {
    const result = validateMnemonic('abandon abandon abandon')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Expected 12 or 24 words')
  })

  it('should reject invalid words', () => {
    const result = validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon notaword')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Invalid mnemonic phrase')
  })
})

describe('BSV Address Validation', () => {
  it('should accept valid P2PKH address', () => {
    expect(isValidBSVAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(true)
  })

  it('should accept valid P2SH address', () => {
    expect(isValidBSVAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(true)
  })

  it('should reject too short', () => {
    expect(isValidBSVAddress('1BvBMSE')).toBe(false)
  })

  it('should reject invalid characters', () => {
    expect(isValidBSVAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN0')).toBe(false) // 0 is invalid
    expect(isValidBSVAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVNO')).toBe(false) // O is invalid
  })

  it('should reject wrong prefix', () => {
    expect(isValidBSVAddress('5BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(false)
  })
})

describe('Transaction ID Validation', () => {
  it('should accept valid 64-char hex txid', () => {
    expect(isValidTxid('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')).toBe(true)
  })

  it('should reject wrong length', () => {
    expect(isValidTxid('0123456789abcdef')).toBe(false)
  })

  it('should reject non-hex characters', () => {
    expect(isValidTxid('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg')).toBe(false)
  })
})

describe('Satoshi Amount Validation', () => {
  it('should accept valid amounts', () => {
    expect(isValidSatoshiAmount(1)).toBe(true)
    expect(isValidSatoshiAmount(100000000)).toBe(true) // 1 BSV
  })

  it('should reject zero and negative', () => {
    expect(isValidSatoshiAmount(0)).toBe(false)
    expect(isValidSatoshiAmount(-1)).toBe(false)
  })

  it('should reject non-integers', () => {
    expect(isValidSatoshiAmount(1.5)).toBe(false)
  })

  it('should reject amounts exceeding max supply', () => {
    expect(isValidSatoshiAmount(21_000_001_00_000_000)).toBe(false)
  })
})
```

**Step 2: Run validation tests**

Run: `cd /Users/kitclawd/simply-sats && npm test -- src/domain/wallet/validation.test.ts`

Expected: PASS

**Step 3: Commit**

```bash
cd /Users/kitclawd/simply-sats
git add src/domain/wallet/validation.test.ts
git commit -m "test(domain): add validation function unit tests

- Test mnemonic normalization and validation
- Test BSV address format validation
- Test transaction ID validation
- Test satoshi amount validation

Pure functions in domain layer are now tested."
```

---

## Task 8: Remove localStorage Duplication for Locks

**Files:**
- Modify: `/Users/kitclawd/simply-sats/src/contexts/WalletContext.tsx`

**Context:** Locks are stored in both SQLite and localStorage, creating potential data inconsistency.

**Step 1: Remove localStorage writes for locks**

In `/Users/kitclawd/simply-sats/src/contexts/WalletContext.tsx`, search for `localStorage.setItem('simply_sats_locks'` and remove all occurrences. Replace with database-only operations.

```typescript
// Before (around line 691-693):
const newLocks = [...locks, result.lockedUtxo]
setLocks(newLocks)
localStorage.setItem('simply_sats_locks', JSON.stringify(newLocks))

// After:
const newLocks = [...locks, result.lockedUtxo]
setLocks(newLocks)
// Database is updated in lockBSV() - no localStorage needed
```

**Step 2: Remove localStorage reads for locks**

Find where locks are initialized from localStorage and change to database-only:

```typescript
// Before:
const storedLocks = localStorage.getItem('simply_sats_locks')
if (storedLocks) {
  setLocks(JSON.parse(storedLocks))
}

// After:
// Locks are loaded from database in loadLocksFromDatabase()
// No localStorage fallback needed
```

**Step 3: Add cleanup on app startup**

```typescript
// In initialization, clean up any stale localStorage data
useEffect(() => {
  // Migration: remove old localStorage locks (database is source of truth)
  localStorage.removeItem('simply_sats_locks')
}, [])
```

**Step 4: Commit**

```bash
cd /Users/kitclawd/simply-sats
git add src/contexts/WalletContext.tsx
git commit -m "refactor: use database as single source of truth for locks

- Remove localStorage writes for lock data
- Remove localStorage reads for lock data
- Add migration cleanup for old localStorage entries
- Database is now the only storage for time-locked outputs

This prevents data inconsistency between localStorage and SQLite."
```

---

## Task 9: Add Trusted Origin Validation

**Files:**
- Modify: `/Users/kitclawd/simply-sats/src/contexts/WalletContext.tsx`
- Create: `/Users/kitclawd/simply-sats/src/utils/validation.ts`

**Context:** Trusted origins are stored without URL validation, which could cause issues.

**Step 1: Create URL validation utility**

Create `/Users/kitclawd/simply-sats/src/utils/validation.ts`:

```typescript
/**
 * Validate that a string is a properly formatted origin URL
 * Origins should be: protocol://hostname[:port]
 */
export function isValidOrigin(origin: string): boolean {
  if (!origin || typeof origin !== 'string') {
    return false
  }

  try {
    const url = new URL(origin)

    // Origin should only have protocol and host (no path, query, or fragment)
    const reconstructed = `${url.protocol}//${url.host}`
    if (origin !== reconstructed) {
      return false
    }

    // Only allow http and https protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false
    }

    // Hostname should not be empty
    if (!url.hostname) {
      return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * Normalize an origin URL (ensure consistent format)
 */
export function normalizeOrigin(origin: string): string {
  const url = new URL(origin)
  return `${url.protocol}//${url.host}`
}
```

**Step 2: Add validation to addTrustedOrigin**

In `/Users/kitclawd/simply-sats/src/contexts/WalletContext.tsx`:

```typescript
import { isValidOrigin, normalizeOrigin } from '../utils/validation'

const addTrustedOrigin = useCallback((origin: string) => {
  // Validate origin format
  if (!isValidOrigin(origin)) {
    console.warn('Invalid origin format:', origin)
    return false
  }

  // Normalize to consistent format
  const normalized = normalizeOrigin(origin)

  if (!trustedOrigins.includes(normalized)) {
    const newOrigins = [...trustedOrigins, normalized]
    localStorage.setItem('simply_sats_trusted_origins', JSON.stringify(newOrigins))
    setTrustedOrigins(newOrigins)
  }

  return true
}, [trustedOrigins])
```

**Step 3: Create test for validation**

Create `/Users/kitclawd/simply-sats/src/utils/validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isValidOrigin, normalizeOrigin } from './validation'

describe('Origin Validation', () => {
  it('should accept valid HTTP origins', () => {
    expect(isValidOrigin('http://localhost')).toBe(true)
    expect(isValidOrigin('http://localhost:3000')).toBe(true)
    expect(isValidOrigin('http://example.com')).toBe(true)
  })

  it('should accept valid HTTPS origins', () => {
    expect(isValidOrigin('https://example.com')).toBe(true)
    expect(isValidOrigin('https://sub.example.com:8443')).toBe(true)
  })

  it('should reject origins with paths', () => {
    expect(isValidOrigin('https://example.com/path')).toBe(false)
    expect(isValidOrigin('https://example.com/')).toBe(false)
  })

  it('should reject non-http protocols', () => {
    expect(isValidOrigin('ftp://example.com')).toBe(false)
    expect(isValidOrigin('file:///path/to/file')).toBe(false)
  })

  it('should reject invalid URLs', () => {
    expect(isValidOrigin('not-a-url')).toBe(false)
    expect(isValidOrigin('')).toBe(false)
    expect(isValidOrigin(null as any)).toBe(false)
  })
})

describe('Origin Normalization', () => {
  it('should normalize origins consistently', () => {
    expect(normalizeOrigin('https://EXAMPLE.COM')).toBe('https://example.com')
    expect(normalizeOrigin('https://example.com:443')).toBe('https://example.com')
    expect(normalizeOrigin('http://localhost:80')).toBe('http://localhost')
  })
})
```

**Step 4: Run tests**

Run: `cd /Users/kitclawd/simply-sats && npm test -- src/utils/validation.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
cd /Users/kitclawd/simply-sats
git add src/utils/validation.ts src/utils/validation.test.ts src/contexts/WalletContext.tsx
git commit -m "feat: add validation for trusted origins

- Create isValidOrigin() to validate URL format
- Create normalizeOrigin() for consistent storage
- Add validation before storing trusted origins
- Add unit tests for origin validation

This prevents malformed origin strings from being stored."
```

---

## Summary

| Task | Priority | Security Impact | Effort |
|------|----------|-----------------|--------|
| 1. Password Policy | Critical | High | Low |
| 2. Require Password | Critical | High | Low |
| 3. Signature Verification | Critical | High | Medium |
| 4. HTTP Session Token | High | High | Medium |
| 5. UTXO Race Condition | High | Medium | Medium |
| 6. Crypto Tests | Medium | Low (verification) | Low |
| 7. Domain Tests | Medium | Low (verification) | Low |
| 8. Remove localStorage Duplication | Low | Low | Low |
| 9. Origin Validation | Low | Low | Low |

**Total Estimated Tasks:** 9
**Critical Security Fixes:** Tasks 1-4
**Important Fixes:** Task 5
**Code Quality:** Tasks 6-9

---

Plan complete and saved to `docs/plans/2026-02-04-security-remediation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
