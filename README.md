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
