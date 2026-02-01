# Simply Sats

A simple, lightweight BSV wallet with BRC-100 support. Built with Tauri, React, and TypeScript.

## Features

- **Simple P2PKH addresses** - Standard Bitcoin addresses that work with any BSV wallet
- **BRC-100 compatible** - Works seamlessly with BRC-100 apps like Wrootz
- **1Sat Ordinals viewer** - View and manage your 1Sat Ordinal inscriptions
- **Multiple wallet import** - Import from Yours Wallet, HandCash, RelayX, or MoneyButton
- **Auto-detect wallet type** - Automatically detects which derivation path has funds
- **Transaction history** - View your transaction history with WhatsOnChain links
- **QR codes** - Easy to share receive addresses

## Wallet Compatibility

Simply Sats can import seed phrases from:

| Wallet | Derivation Path |
|--------|----------------|
| Yours Wallet / BRC-100 | m/44'/236'/0'/0/0 |
| HandCash | m/44'/145'/0'/0/0 |
| RelayX | m/44'/0'/0'/0/0 |
| MoneyButton / Legacy | m/44'/0'/0'/0/0 |

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
- **@bsv/sdk** - BSV transaction building
- **WhatsOnChain API** - Blockchain data

## Security

- Private keys are stored locally only
- No external servers besides WhatsOnChain API for blockchain data
- Recovery phrase is the only way to restore your wallet

## License

MIT
