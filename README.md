# Simply Sats

A simple, lightweight BSV wallet with BRC-100 support. Built with Tauri, React, and TypeScript.

## Features

- **Simple P2PKH addresses** - Standard Bitcoin addresses that work with any BSV wallet
- **BRC-100 compatible** - Works seamlessly with BRC-100 apps and protocols
- **BRC-42/43 key derivation** - Receive payments at unique derived addresses with full privacy
- **Contacts** - Save sender public keys for easy payment reception
- **1Sat Ordinals viewer** - View and manage your 1Sat Ordinal inscriptions
- **Time locks** - Lock sats until a specific block height (Wrootz integration)
- **Multiple wallet import** - Import from Yours Wallet, HandCash, RelayX, or MoneyButton
- **Auto-detect wallet type** - Automatically detects which derivation path has funds
- **Transaction history** - View your transaction history with WhatsOnChain links
- **QR codes** - Easy to share receive addresses
- **Local database** - UTXOs tracked locally for fast balance queries

## Wallet Compatibility

Simply Sats can import seed phrases from:

| Wallet | Derivation Path |
|--------|----------------|
| Yours Wallet / BRC-100 | m/44'/236'/0'/0/0 |
| HandCash | m/44'/145'/0'/0/0 |
| RelayX | m/44'/0'/0'/0/0 |
| MoneyButton / Legacy | m/44'/0'/0'/0/0 |

## BRC-42/43 Derived Addresses

Simply Sats supports receiving payments at unique derived addresses using BRC-42/43 key derivation:

1. Add a contact with their public key
2. A unique receive address is generated using ECDH
3. Only you can spend funds sent to that address
4. Each payment generates a new unique address

This provides better privacy than reusing a single address.

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

## Security

- Private keys are stored locally only
- No external servers besides WhatsOnChain API for blockchain data
- Recovery phrase is the only way to restore your wallet
- Derived address private keys are computed from your seed phrase + sender's public key

## License

MIT
