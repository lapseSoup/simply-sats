# CLTV Time-Lock Issue on BSV

## Summary

The CLTV (CheckLockTimeVerify) time-lock feature in Simply Sats creates UTXOs that **cannot be spent** through normal broadcast methods on BSV, despite being valid at the consensus level. This document explains the issue and potential solutions.

## The Problem

### What Happened

A UTXO containing 218 sats was locked using a CLTV script at:
- **TXID:** `cc690942b2202d9c40fb6ed47177f36db46ae64bd3e25ec9eceeb1225953286f`
- **Output:** 0
- **Unlock Block:** 934,631
- **Locking Script:** `03e7420eb17576a91441a8ed11c754517a2e2f7907eabf078a84ada6a488ac`

The locking script decodes to:
```
<934631> OP_CHECKLOCKTIMEVERIFY OP_DROP OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
```

### Why It's Stuck

1. **OP_CHECKLOCKTIMEVERIFY is OP_NOP2** - In Bitcoin's history, OP_NOP2 was repurposed as OP_CHECKLOCKTIMEVERIFY (BIP-65) for time-locked transactions.

2. **BSV reverted OP_NOP2** - After the BSV Genesis upgrade (February 2020, block 620,538), BSV reverted OP_NOP2 back to a true no-op at the **consensus level**. This means OP_NOP2 does nothing - it's just skipped during script execution.

3. **Policy still blocks it** - While the transaction is valid at consensus level, most BSV nodes and miners have the `DISCOURAGE_UPGRADABLE_NOPS` policy flag enabled by default. This causes them to **reject transactions at the relay/mempool level** before they even reach consensus validation.

### Error Messages

When trying to broadcast the unlock transaction:
```
mandatory-script-verify-flag-failed (NOPx reserved for soft-fork upgrades)
```

This is a **policy rejection**, not a consensus rejection.

## Technical Details

### The Locking Script Structure

```
03e7420e        # Push 3 bytes: 0x0e42e7 = 934631 (little-endian block height)
b1              # OP_NOP2 (OP_CHECKLOCKTIMEVERIFY)
75              # OP_DROP
76              # OP_DUP
a9              # OP_HASH160
14              # Push 20 bytes (pubkey hash)
41a8ed11c754517a2e2f7907eabf078a84ada6a4
88              # OP_EQUALVERIFY
ac              # OP_CHECKSIG
```

### How Script Execution Would Work

On BSV post-Genesis, when spending this UTXO:

1. `<934631>` is pushed to the stack
2. `OP_NOP2` does nothing (it's a no-op)
3. `OP_DROP` removes the block height from the stack
4. The rest is standard P2PKH verification

The transaction IS valid. But nodes won't relay it due to policy.

### What We Tried

1. **WhatsOnChain API** - Rejected with policy error
2. **GorillaPool ARC with `X-SkipScriptFlags` header** - Transaction accepted initially but ultimately rejected
3. **GorillaPool ARC with `skipScriptFlags` in JSON body** - Same result
4. **GorillaPool mAPI** - Rejected with policy error

The ARC API supposedly supports policy bypass via:
```typescript
fetch('https://arc.gorillapool.io/v1/tx', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-SkipScriptFlags': 'DISCOURAGE_UPGRADABLE_NOPS'
  },
  body: JSON.stringify({
    rawTx: txhex,
    skipScriptFlags: ['DISCOURAGE_UPGRADABLE_NOPS']
  })
})
```

However, in practice this did not work - the transaction was still rejected.

## Current Status

The 218 sats remain locked at the UTXO and cannot be spent through automated means.

The app includes:
- An "Export TX" button that copies the raw signed transaction hex to clipboard
- Instructions for manual miner submission

## Potential Solutions

### 1. Contact a Miner Directly

Miners can individually choose to accept non-standard transactions. Options:
- **GorillaPool** - https://gorillapool.com/
- **TAAL** - Major BSV miner with enterprise mAPI
- **BSV Discord** - https://discord.gg/bsv - Ask for help from developers/miners

### 2. Use Enterprise mAPI

Some miners offer mAPI tokens that allow bypassing certain policy limits. This typically requires a business relationship.

### 3. Wait for Protocol Updates

BSV has announced "Full Protocol Restoration" planned for Q1 2026, which may change how these opcodes are handled at the policy level.

### 4. Run Your Own Node

Run a BSV node with `DISCOURAGE_UPGRADABLE_NOPS` disabled and mine the transaction yourself (requires significant hashpower).

## Recommendations for the App

### Short Term

1. **Disable the CLTV lock feature** or add a prominent warning that locked funds may not be recoverable
2. Keep the "Export TX" feature for users who want to try manual miner submission

### Long Term

1. **Use a different time-lock mechanism** that doesn't rely on OP_NOP2:
   - Hash Time-Locked Contracts (HTLCs) using OP_SHA256
   - Relative time-locks using OP_CSV (though this may have similar issues)
   - Server-based escrow with cryptographic proofs

2. **Wait for BSV protocol updates** that may restore CLTV functionality or remove the policy restriction

## Raw Transaction for Manual Recovery

To attempt recovery of the locked funds, use the "TX" button in the app's Locks tab to export the raw transaction hex. Then:

1. Join the [BSV Discord](https://discord.gg/bsv)
2. Explain that you have a valid transaction with OP_NOP2 being rejected by policy
3. Ask if a miner can include it directly in a block

Alternatively, try submitting via curl:
```bash
curl -X POST https://arc.gorillapool.io/v1/tx \
  -H "Content-Type: text/plain" \
  -H "X-SkipScriptFlags: DISCOURAGE_UPGRADABLE_NOPS" \
  -d "YOUR_RAW_TX_HEX_HERE"
```

## References

- [BSV Genesis Upgrade](https://bitcoinsv.io/2020/01/15/changes-for-the-genesis-upgrade/)
- [BIP-65 CHECKLOCKTIMEVERIFY](https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki)
- [BSV ARC API](https://github.com/bitcoin-sv/arc)
- [BSV mAPI Specification](https://github.com/bitcoin-sv-specs/brfc-merchantapi)
- [GorillaPool](https://gorillapool.com/)

## Affected UTXO Details

For future reference, here are the complete details of the stuck UTXO:

```json
{
  "txid": "cc690942b2202d9c40fb6ed47177f36db46ae64bd3e25ec9eceeb1225953286f",
  "vout": 0,
  "satoshis": 218,
  "lockingScript": "03e7420eb17576a91441a8ed11c754517a2e2f7907eabf078a84ada6a488ac",
  "unlockBlock": 934631,
  "destinationAddress": "16zBHf6ixsW3cFTPUhgkNzzJvZzahwf2hR"
}
```

The UTXO can be viewed on WhatsOnChain:
https://whatsonchain.com/tx/cc690942b2202d9c40fb6ed47177f36db46ae64bd3e25ec9eceeb1225953286f

## Signed Unlock Transaction (Raw Hex)

This is the complete signed transaction that would unlock the 218 sats. It is valid at consensus level but rejected by policy. If a miner includes this in a block, the funds will be recovered.

**Raw Transaction Hex:**
```
01000000016f28535922b1eeecc95ee2d34be66ab46df37771d46efb409c2d20b2420969cc000000006b4830450221008c40bdc593f00aa8d800bf07effb883fe3774abeafafedb67acafd508b9a12190220420985ad750c285cdbc24c1ee614709e7c71aeb9b14d858a60f6c301e9734b8b412102a16509b24a805a53487510ea1c7ad1f37f2de14639e9f77cb86f2e5309fc29f4feffffff01c6000000000000001976a91441a8ed11c754517a2e2f7907eabf078a84ada6a488ace7420e00
```

**Transaction Breakdown:**
- **Version:** 01000000 (version 1)
- **Input Count:** 01
- **Input TXID:** `6f28535922b1eeecc95ee2d34be66ab46df37771d46efb409c2d20b2420969cc` (reversed: `cc690942...`)
- **Input Vout:** 00000000 (output 0)
- **ScriptSig Length:** 6b (107 bytes)
- **ScriptSig:** Signature + Public Key
- **Sequence:** feffffff (0xfffffffe - enables nLockTime)
- **Output Count:** 01
- **Output Value:** c600000000000000 (198 sats in little-endian = 218 - 20 fee)
- **Output Script:** Standard P2PKH to `16zBHf6ixsW3cFTPUhgkNzzJvZzahwf2hR`
- **nLockTime:** e7420e00 (934631 in little-endian)

**To broadcast manually:**
```bash
curl -X POST https://arc.gorillapool.io/v1/tx \
  -H "Content-Type: text/plain" \
  -H "X-SkipScriptFlags: DISCOURAGE_UPGRADABLE_NOPS" \
  -d "01000000016f28535922b1eeecc95ee2d34be66ab46df37771d46efb409c2d20b2420969cc000000006b4830450221008c40bdc593f00aa8d800bf07effb883fe3774abeafafedb67acafd508b9a12190220420985ad750c285cdbc24c1ee614709e7c71aeb9b14d858a60f6c301e9734b8b412102a16509b24a805a53487510ea1c7ad1f37f2de14639e9f77cb86f2e5309fc29f4feffffff01c6000000000000001976a91441a8ed11c754517a2e2f7907eabf078a84ada6a488ace7420e00"
```

**Expected TXID if mined:** (will be generated when broadcast succeeds)
