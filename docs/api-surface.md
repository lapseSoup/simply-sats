# API Surface

Quick reference for all public interfaces in Simply Sats.

## Context APIs

Access via hooks from `src/contexts/`. All require being inside `<AppProviders>`.

### useWallet() — `src/contexts/WalletContext.tsx`
Aggregates all contexts for backward compatibility. The "kitchen sink" hook.

**State:** `wallet`, `balance`, `ordBalance`, `utxos`, `ordinals`, `locks`, `txHistory`, `basketBalances`, `contacts`, `accounts`, `activeAccount`, `activeAccountId`, `tokenBalances`, `tokensSyncing`, `isLocked`, `networkInfo`, `syncing`, `loading`, `feeRateKB`, `connectedApps`, `trustedOrigins`, `sessionPassword`, `autoLockMinutes`, `usdPrice`

**Actions:**
- `handleCreateWallet(password) → mnemonic | null`
- `handleRestoreWallet(mnemonic, password) → boolean`
- `handleImportJSON(json, password) → boolean`
- `handleDeleteWallet() → void`
- `handleSend(address, amountSats, selectedUtxos?) → { success, txid?, error? }`
- `handleLock(amountSats, blocks) → { success, txid?, error? }`
- `handleUnlock(lock) → { success, txid?, error? }`
- `handleTransferOrdinal(ordinal, toAddress) → { success, txid?, error? }`
- `handleSendToken(ticker, protocol, amount, toAddress) → { success, txid?, error? }`
- `performSync(isRestore?, forceReset?) → void`
- `fetchData() → void`
- `switchAccount(accountId)`, `createNewAccount(name)`, `importAccount(name, mnemonic)`, `deleteAccount(id)`, `renameAccount(id, name)`
- `lockWallet()`, `unlockWallet(password) → boolean`
- `setAutoLockMinutes(minutes)`, `setFeeRate(rate)`
- `addTrustedOrigin(origin)`, `removeTrustedOrigin(origin)`, `disconnectApp(origin)`
- `refreshTokens()`, `refreshAccounts()`, `refreshContacts()`
- `copyToClipboard(text)`, `showToast(message)`, `toggleDisplayUnit()`

### useNetwork() — `src/contexts/NetworkContext.tsx`
`networkInfo: { blockHeight, overlayHealthy, overlayNodeCount } | null`, `syncing`, `setSyncing()`, `usdPrice`

### useUI() — `src/contexts/UIContext.tsx`
`displayInSats`, `toggleDisplayUnit()`, `toasts`, `copyFeedback`, `copyToClipboard(text, feedback?)`, `showToast(message)`, `formatBSVShort(sats)`, `formatUSD(sats)`

### useAccounts() — `src/contexts/AccountsContext.tsx`
`accounts`, `activeAccount`, `activeAccountId`, `switchAccount(id, password) → WalletKeys | null`, `createNewAccount(name, password) → WalletKeys | null`, `importAccount(name, mnemonic, password) → WalletKeys | null`, `deleteAccount(id)`, `renameAccount(id, name)`, `refreshAccounts()`, `getKeysForAccount(account, password)`

### useTokens() — `src/contexts/TokensContext.tsx`
`tokenBalances`, `tokensSyncing`, `refreshTokens(wallet, accountId)`, `sendTokenAction(wallet, ticker, protocol, amount, toAddress)`

### useSync() — `src/contexts/SyncContext.tsx`
`utxos`, `ordinals`, `txHistory`, `basketBalances: { default, ordinals, identity, derived, locks }`, `balance`, `ordBalance`, `setUtxos()`, `setOrdinals()`, `setTxHistory()`, `setBasketBalances()`, `performSync(wallet, accountId, isRestore?)`, `fetchData(wallet, accountId, knownUnlockedLocks, onLocksDetected)`

### useLocks() — `src/contexts/LocksContext.tsx`
`locks`, `knownUnlockedLocks`, `setLocks()`, `addKnownUnlockedLock(key)`, `handleLock(wallet, amountSats, blocks, accountId, onComplete)`, `handleUnlock(wallet, lock, accountId, onComplete)`, `detectLocks(wallet, utxos?)`

## Wallet Service — `src/services/wallet/`

### core.ts
`createWallet() → WalletKeys`, `restoreWallet(mnemonic) → WalletKeys`, `importFromJSON(json) → WalletKeys`, `importFromShaullet(json) → WalletKeys`, `importFrom1SatOrdinals(json) → WalletKeys`, `verifyMnemonicMatchesWallet(mnemonic, expectedAddress) → { valid, derivedAddress }`

### transactions.ts
`sendBSV(wif, toAddress, satoshis, utxos, accountId?)`, `sendBSVMultiKey(changeWif, toAddress, satoshis, utxos, accountId?)`, `consolidateUtxos(wif, utxoIds) → { txid, outputSats, fee }`, `broadcastTransaction(tx)`, `getAllSpendableUTXOs(walletWif) → ExtendedUTXO[]`

### locks.ts
`lockBSV(wif, satoshis, unlockBlock, utxos, ordinalOrigin?) → { txid, lockedUtxo }`, `unlockBSV(wif, lockedUtxo, currentBlockHeight)`, `generateUnlockTxHex(wif, lockedUtxo) → { txHex, txid, outputSats }`, `detectLockedUtxos(walletAddress, publicKeyHex, knownUnlockedLocks?)`, `getCurrentBlockHeight()`, `getTimelockScriptSize(publicKeyHex, blockHeight)`

### ordinals.ts
`getOrdinals(address)`, `getOrdinalDetails(origin)`, `scanHistoryForOrdinals(walletAddress, publicKeyHash)`, `transferOrdinal(ordWif, ordinalUtxo, toAddress, fundingWif, fundingUtxos)`

### balance.ts
`getBalance(address)`, `getBalanceFromDB(basket?)`, `getUTXOsFromDB(basket?)`, `getUTXOs(address)`, `getTransactionHistory(address)`, `getTransactionDetails(txid)`, `calculateTxAmount(txDetails, addresses)`

### storage.ts
`saveWallet(keys, password)`, `loadWallet(password) → WalletKeys | null`, `hasWallet()`, `clearWallet()`, `changePassword(oldPassword, newPassword)`

### fees.ts
`fetchDynamicFeeRate()`, `getFeeRate()`, `setFeeRate(rate)`, `getFeeRatePerKB()`, `setFeeRateFromKB(ratePerKB)`, `calculateTxFee(numInputs, numOutputs, extraBytes?)`, `calculateLockFee(numInputs, timelockScriptSize?)`, `calculateMaxSend(utxos) → { maxSats, fee, numInputs }`, `calculateExactFee(satoshis, utxos) → { fee, inputCount, outputCount, totalInput, canSend }`

## Database Repositories — `src/services/database/`

### connection.ts
`initDatabase()`, `getDatabase()`, `withTransaction(callback)`, `closeDatabase()`

### utxoRepository.ts
`addUTXO()`, `getUTXOsByBasket(basket, accountId?)`, `getSpendableUTXOs(basket, accountId?)`, `getSpendableUTXOsByAddress(address)`, `markUTXOSpent(txid, vout)`, `markUtxosPendingSpend()`, `confirmUtxosSpent()`, `rollbackPendingSpend()`, `getPendingUtxos()`, `getBalanceFromDB(basket?, accountId?)`, `getAllUTXOs(accountId?)`, `repairUTXOs()`, `toggleUtxoFrozen()`, `getUtxoByOutpoint()`

### transactionRepository.ts
`addTransaction()`, `upsertTransaction()`, `getAllTransactions(limit?, accountId?)`, `updateTransactionAmount()`, `getTransactionsByLabel()`, `updateTransactionStatus()`, `updateTransactionLabels()`, `getTransactionLabels()`

### lockRepository.ts
`addLock()`, `getLocks(accountId?)`, `markLockUnlocked(lockId)`, `markLockUnlockedByTxid(txid, vout)`, `getAllLocks()`

### syncStateRepository.ts
`getLastSyncedHeight(address)`, `updateSyncState(address, blockHeight)`, `getAllSyncStates()`

### basketRepository.ts
`getBaskets()`, `createBasket(name)`, `ensureBasket(name)`

### addressRepository.ts
`addDerivedAddress()`, `getDerivedAddresses()`, `getDerivedAddressByAddress()`, `updateDerivedAddressSyncTime()`, `deleteDerivedAddress()`, `exportSenderPubkeys()`, `getDerivedAddressCount()`, `getNextInvoiceNumber()`

### contactRepository.ts
`addContact()`, `getContacts()`, `getContactByPubkey()`, `updateContactLabel()`, `deleteContact()`

### actionRepository.ts
`recordActionRequest(origin, method)`, `updateActionResult(actionId, result)`, `getRecentActionResults(limit?)`, `getActionResultsByOrigin()`, `getActionResultByTxid()`

### backupRepository.ts
`exportDatabase() → DatabaseBackup`, `importDatabase(backup)`, `clearDatabase()`, `resetUTXOs()`

## SDK — `sdk/src/index.ts`

`@simply-sats/sdk` — SimplySats class communicating via HTTP-JSON to localhost:3322.

**Constructor:** `new SimplySats(config?: { baseUrl?, timeout?, origin?, sessionToken? })`
**Auth:** `setSessionToken(token)`, `clearSessionToken()`, `getNonce()`, `isAuthenticated()`, `waitForAuthentication()`
**Info:** `getVersion()`, `getNetwork()`, `getHeight()`, `ping()`
**Keys:** `getPublicKey(options?: { identityKey? })`, `createSignature({ data, hashToDirectlySign?, nonce? })`
**Transactions:** `createAction({ description?, outputs?, inputs?, lockTime?, nonce? })`, `listOutputs({ basket?, tags?, limit?, offset? })`
**Timelocks:** `lockBSV({ satoshis, blocks, metadata?, nonce? })`, `unlockBSV(outpoint, nonce?)`, `listLocks()`
**Convenience:** `getBalance(basket?)`, `getLockedBalance()`, `getSpendableLockedBalance()`

## HTTP Server — `src-tauri/src/http_server.rs`

BRC-100 protocol on `localhost:3322`. All routes are POST, JSON body/response.

| Route | Auth | CSRF | Description |
|-------|------|------|-------------|
| `/getVersion` | - | - | App version |
| `/getNetwork` | - | - | Network type (mainnet) |
| `/isAuthenticated` | token | - | Check auth status |
| `/waitForAuthentication` | token | - | Block until authenticated |
| `/getHeight` | - | - | Current block height |
| `/getNonce` | token | - | Get CSRF nonce |
| `/getPublicKey` | token | - | Wallet/identity public key |
| `/createSignature` | token | nonce | Sign data with wallet key |
| `/createAction` | token | nonce | Build and broadcast transaction |
| `/listOutputs` | token | - | List UTXOs by basket/tags |
| `/lockBSV` | token | nonce | Create time-locked UTXO |
| `/unlockBSV` | token | nonce | Unlock time-locked UTXO |
| `/listLocks` | token | - | List all time locks |

**Headers:** `X-Simply-Sats-Token` (session), `X-Simply-Sats-Nonce` (CSRF), `X-Origin` (app origin)
**Rate limit:** 60 requests/minute per session. DNS rebinding protection (localhost only).

## External APIs

### WhatsOnChain (`https://api.whatsonchain.com/v1/bsv/main`)
- `GET /chain/info` — Block height, chain stats
- `GET /address/{address}/balance` — Address balance
- `GET /address/{address}/unspent` — UTXOs
- `GET /address/{address}/history` — Transaction history
- `GET /tx/{txid}/hex` — Raw transaction hex

### GorillaPool (`https://ordinals.gorillapool.io/api`)
- `GET /fee` — Current fee rate
- `POST /tx` — Broadcast transaction
- `GET /bsv20/{address}/balance` — Token balances
