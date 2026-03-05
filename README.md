# Simply Sats

A lightweight BSV wallet with broad BRC protocol support. Built with Tauri 2, React 19, and TypeScript 5.9.

## Features

- **Simple P2PKH addresses** — Standard Bitcoin addresses compatible with any BSV wallet
- **BRC-100 compatible** — Works seamlessly with BRC-100 apps and protocols (Wrootz, etc.)
- **BRC-42/43 key derivation** — Receive payments at unique derived addresses with full privacy
- **Mutual authentication** — Cryptographically authenticated HTTP sessions (BRC-103/104)
- **Identity certificates** — Issue and prove selective-disclosure identity certificates (BRC-52)
- **Authenticated payments** — Per-payment key derivation and HTTP 402 micropayment handling (BRC-29/105)
- **PIKE contact verification** — TOTP-based contact verification to prevent MITM attacks (BRC-85)
- **Signed & encrypted messages** — Send and verify signed or encrypted peer messages (BRC-77/78)
- **BEEF transactions** — SPV-friendly transaction envelopes with embedded Merkle proofs (BRC-62/95/96)
- **Key linkage revelation** — Prove key derivation relationships to verifiers (BRC-69/72)
- **Enhanced baskets** — Named UTXO buckets with balance queries and relinquish support (BRC-46/112/114)
- **1Sat Ordinals viewer** — View and transfer your 1Sat Ordinal inscriptions
- **Time locks** — Lock sats until a specific block height using OP_PUSH_TX (Wrootz integration)
- **Multi-account support** — Create multiple accounts from a single seed phrase
- **Token tracking** — View BSV-20/BSV-21 token balances
- **Transaction history** — View your transaction history with WhatsOnChain links
- **QR codes** — Easy to share receive addresses
- **Local database** — UTXOs tracked locally for fast balance queries
- **Auto-lock** — Automatically lock wallet after inactivity (10min default, up to 60min)
- **Overlay Network** — SHIP/SLAP broadcast support for transaction reliability
- **AES-256-GCM encryption** — Wallet keys encrypted locally with PBKDF2-derived key (600k iterations)
- **Yours Wallet compatible** — Same derivation paths; import/export seed phrases freely

## BRC Protocol Support

Simply Sats implements one of the most complete sets of BSV BRC standards available in a wallet:

| BRC | Protocol | Description |
|-----|----------|-------------|
| 29 | Authenticated P2PKH | Per-payment key derivation for private, unlinkable payments |
| 42 | Key Derivation | ECDH-based child key derivation from sender public key |
| 43 | Invoice Numbers | Deterministic invoice numbering for key derivation |
| 46 | UTXO Baskets | Named UTXO buckets with relinquish support |
| 52 | Identity Certificates | Selective-disclosure verifiable credentials |
| 62 | BEEF Transactions | SPV-friendly envelopes with embedded Merkle proofs |
| 69 | Key Linkage | Reveal ECDH key derivation relationships to verifiers |
| 72 | Encrypted Linkage | Encrypt revealed key linkage for specific verifiers |
| 77 | Signed Messages | Digitally sign arbitrary payloads with protocol-scoped keys |
| 78 | Encrypted Messages | Encrypt messages for specific counterparties |
| 85 | PIKE | TOTP-based contact verification to prevent MITM attacks |
| 95 | BEEF V2 | Updated BEEF envelope format |
| 96 | Atomic BEEF | Single-transaction BEEF for simple payment flows |
| 100 | Wallet Interface | Full app interop protocol (request/response over local HTTP) |
| 103 | Peer Mutual Auth | Challenge-response authenticated HTTP sessions |
| 104 | Auth Sessions | Server-side session storage for peer authentication |
| 105 | HTTP Micropayments | Auto-pay HTTP 402 responses below a configurable threshold |
| 109 | Peer Cash (PCW-1) | Note-based peer cash with disjoint coin selection *(experimental)* |
| 112 | Basket Balances | Query total satoshis held in a named basket |
| 114 | Action Filtering | List wallet actions with time-range and label filters |

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

## Developer SDK

The `@simply-sats/sdk` package lets external apps interact with Simply Sats over the BRC-100 local HTTP interface:

```typescript
import { SimplySats } from '@simply-sats/sdk';

const wallet = new SimplySats();
const { txid } = await wallet.createAction({ description: 'Pay invoice', outputs: [...] });

// BRC-52 certificates
const certs = await wallet.listCertificates();

// BRC-46/112 baskets
const balance = await wallet.getBasketBalance('default');
await wallet.relinquishOutput('default', 'txid.0');

// BRC-69/72 key linkage
const proof = await wallet.revealCounterpartyKeyLinkage(counterparty, verifier);
```

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

# Run tests (2244 tests)
npm run test:run

# Type check
npm run typecheck

# Lint
npm run lint
```

## Tech Stack

- **Tauri 2** — Lightweight desktop app framework (Rust backend, native webview)
- **React 19** — UI framework
- **TypeScript 5.9** — Type safety
- **Rust / Axum** — Backend HTTP server (BRC-100 on port 3322) + secure key storage
- **SQLite** — Local UTXO and transaction storage (sql.js WASM + Tauri plugin)
- **@bsv/sdk** — BSV protocol implementations (BEEF, certificates, auth, messages)
- **@simply-sats/sdk** — Node.js client for external app integration
- **WhatsOnChain API** — Blockchain data
- **GorillaPool API** — 1Sat Ordinals and fee rate data

## Security

- Private keys encrypted with AES-256-GCM, PBKDF2-derived key (600,000 iterations, OWASP 2025)
- All signing, encryption, and key derivation done in Rust — private keys never enter JavaScript
- Mutual authentication (BRC-103/104) uses cryptographic identity keys, not passwords
- PIKE contact verification (BRC-85) prevents MITM attacks during key exchange
- No external servers besides WhatsOnChain/GorillaPool/ARC APIs for blockchain data
- Recovery phrase is the only way to restore your wallet
- Auto-lock after configurable inactivity period (10min default, up to 60min, or disabled)
- Rate limiting: 5 unlock attempts max, then exponential backoff (1s base, 5min max)
- CSRF nonces on all BRC-100 state-changing operations
- DNS rebinding protection — BRC-100 HTTP server accepts localhost connections only

For a full security model description see [docs/OVERVIEW.md](docs/OVERVIEW.md).

## License

MIT
