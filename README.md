# Simply Sats

A simple, lightweight BSV wallet with BRC-100 support. Built with Tauri, React, and TypeScript.

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
- **Auto-lock** - Automatically lock wallet after inactivity (configurable 5min to 1hr)
- **Overlay Network** - SHIP/SLAP broadcast support for transaction reliability
- **AES-GCM encryption** - Wallet keys encrypted locally with your password

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
npm run tauri dev

# Build for production
npm run tauri build
```

## Tech Stack

- **Tauri** - Lightweight desktop app framework
- **React** - UI framework
- **TypeScript** - Type safety
- **SQLite** - Local UTXO and transaction storage
- **@bsv/sdk** - BSV transaction building and key derivation
- **WhatsOnChain API** - Blockchain data
- **GorillaPool API** - 1Sat Ordinals data

## Security

- Private keys are encrypted locally with AES-GCM 256-bit encryption
- No external servers besides WhatsOnChain/GorillaPool/ARC APIs for blockchain data
- Recovery phrase is the only way to restore your wallet
- Derived address private keys are computed from your seed phrase + sender's public key
- Auto-lock feature locks wallet after configurable inactivity period (5min to 1hr, or disabled)
- Password protection optional - leave blank if you prefer no password

## License

MIT
