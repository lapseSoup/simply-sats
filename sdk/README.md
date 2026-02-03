# @simply-sats/sdk

Node.js SDK for Simply Sats wallet - BRC-100 protocol client for BSV transactions.

Designed for AI agents, automation systems, and any Node.js application that needs programmatic access to BSV wallet functionality.

## Installation

```bash
npm install @simply-sats/sdk
```

## Requirements

- Simply Sats desktop app must be running
- Wallet must be loaded/authenticated
- For automated/headless operation, add your origin to trusted origins in Simply Sats settings

## Quick Start

```typescript
import { SimplySats } from '@simply-sats/sdk'

const wallet = new SimplySats({
  origin: 'my-ai-bot'  // Your app identifier
})

// Check if Simply Sats is running
const connected = await wallet.ping()
if (!connected) {
  console.log('Please start Simply Sats')
  process.exit(1)
}

// Get wallet info
const version = await wallet.getVersion()
const network = await wallet.getNetwork()
const height = await wallet.getHeight()

console.log(`Simply Sats v${version} on ${network} at block ${height}`)
```

## Timelock Operations

The SDK provides access to Simply Sats' OP_PUSH_TX timelock functionality, which allows you to lock BSV for a specified number of blocks.

### Lock BSV

```typescript
// Lock 50,000 satoshis for ~1 week (144 blocks/day * 7 days)
const lock = await wallet.lockBSV({
  satoshis: 50000,
  blocks: 144 * 7,
  metadata: {
    app: 'wrootz',
    ordinalOrigin: 'abc123_0'  // Optional ordinal reference
  }
})

console.log(`Locked! TXID: ${lock.txid}`)
console.log(`Unlocks at block: ${lock.unlockBlock}`)
```

### List Locks

```typescript
const { locks, currentHeight } = await wallet.listLocks()

for (const lock of locks) {
  console.log(`${lock.outpoint}: ${lock.satoshis} sats`)

  if (lock.spendable) {
    console.log('  Ready to unlock!')
  } else {
    console.log(`  ${lock.blocksRemaining} blocks remaining`)
  }
}
```

### Unlock BSV

```typescript
// Unlock a matured lock
const result = await wallet.unlockBSV('abc123...def.0')
console.log(`Unlocked ${result.amount} sats in tx ${result.txid}`)
```

## Wallet Operations

### Get Balance

```typescript
// Total spendable balance
const balance = await wallet.getBalance()

// Balance in specific basket
const ordinalBalance = await wallet.getBalance('ordinals')

// Locked balance
const lockedBalance = await wallet.getLockedBalance()

// Spendable locked balance (matured locks)
const spendableLocked = await wallet.getSpendableLockedBalance()
```

### Get Public Key

```typescript
// Get wallet public key
const pubKey = await wallet.getPublicKey()

// Get identity key
const identityKey = await wallet.getPublicKey({ identityKey: true })
```

### Create Signature

```typescript
// Sign a message
const sig = await wallet.createSignature({
  data: 'Hello, BSV!'
})

console.log(`Signature: ${sig.signature}`)
console.log(`Public Key: ${sig.publicKey}`)
```

### List Outputs (UTXOs)

```typescript
// List all outputs
const { outputs } = await wallet.listOutputs()

// List outputs with specific tags
const { outputs: taggedOutputs } = await wallet.listOutputs({
  tags: ['unlock_900000']
})

// List outputs from specific basket
const { outputs: ordinals } = await wallet.listOutputs({
  basket: 'ordinals'
})
```

### Create Transaction

```typescript
const result = await wallet.createAction({
  description: 'Send payment',
  outputs: [{
    lockingScript: '76a914...88ac',
    satoshis: 1000
  }]
})

console.log(`Transaction: ${result.txid}`)
```

## Configuration

```typescript
const wallet = new SimplySats({
  // Simply Sats HTTP server URL (default: http://127.0.0.1:3322)
  baseUrl: 'http://127.0.0.1:3322',

  // Request timeout in ms (default: 120000 = 2 minutes)
  timeout: 120000,

  // Origin identifier for your app
  // Add this to Simply Sats trusted origins for auto-approval
  origin: 'my-ai-bot'
})
```

## Trusted Origins (Headless Mode)

For automated operation without user confirmation popups:

1. Open Simply Sats desktop app
2. Go to Settings
3. Add your origin (e.g., `my-ai-bot`) to Trusted Origins
4. Use that same origin when creating the SDK client

Requests from trusted origins are auto-approved without user interaction.

## Error Handling

```typescript
import { SimplySats, SimplySatsError } from '@simply-sats/sdk'

const wallet = new SimplySats()

try {
  await wallet.lockBSV({ satoshis: 1000, blocks: 144 })
} catch (error) {
  if (error instanceof SimplySatsError) {
    console.log(`Error ${error.code}: ${error.message}`)

    // Common error codes:
    // -32602: Invalid parameters
    // -32000: General error (no UTXOs, lock not found, etc.)
    // -32003: Request cancelled by user
  }
}
```

## API Reference

### Basic Info
- `getVersion()` - Get Simply Sats version
- `getNetwork()` - Get network (mainnet/testnet)
- `isAuthenticated()` - Check if wallet is loaded
- `waitForAuthentication()` - Wait for wallet to load
- `getHeight()` - Get current block height
- `ping()` - Check if Simply Sats is running

### Key Operations
- `getPublicKey(options?)` - Get wallet public key
- `createSignature(options)` - Sign data

### Transaction Operations
- `createAction(options)` - Create a transaction
- `listOutputs(options?)` - List wallet UTXOs

### Timelock Operations
- `lockBSV(options)` - Lock BSV with OP_PUSH_TX timelock
- `unlockBSV(outpoint)` - Unlock a matured lock
- `listLocks()` - List all locks

### Convenience Methods
- `getBalance(basket?)` - Get spendable balance
- `getLockedBalance()` - Get total locked balance
- `getSpendableLockedBalance()` - Get spendable locked balance

## License

MIT
