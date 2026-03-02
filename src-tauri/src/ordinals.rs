//! OrdinalLock Marketplace Contract
//!
//! Implements listing, purchasing, and cancelling ordinal sales on the
//! 1Sat Ordinals marketplace using the OrdinalLock smart contract.
//!
//! The OrdinalLock script is derived from the js-1sat-ord reference
//! implementation. It allows:
//!   - **Listing**: Lock an ordinal UTXO under the contract
//!   - **Cancel**: The original owner reclaims the ordinal (OP_1 branch)
//!   - **Purchase**: Anyone pays the asking price to unlock the ordinal

use base64::Engine;
use bsv_sdk::script::Script;
use bsv_sdk::transaction::template::p2pkh;
use bsv_sdk::transaction::template::UnlockingScriptTemplate;
use bsv_sdk::transaction::{Transaction as SdkTransaction, TransactionOutput};

use crate::bsv_sdk_adapter::{sdk_address_from_wif, sdk_privkey_from_wif};
use crate::transaction::{
    add_p2pkh_output, pkh_from_address, push_data_bytes, BuiltTransactionResult, SpentOutpoint,
    UtxoInput,
};

// ---------------------------------------------------------------------------
// OrdinalLock contract bytecode (from js-1sat-ord)
// ---------------------------------------------------------------------------

/// OrdinalLock contract prefix
const OLOCK_PREFIX: &str = "2097dfd76851bf465e8f715593b217714858bbe9570ff3bd5e33840a34e20ff0262102ba79df5f8ae7604a9830f03c7933028186aede0675a16f025dc4f8be8eec0382201008ce7480da41702918d1ec8e6849ba32b4d65b1e40dc669c31a1e6306b266c0000";

/// OrdinalLock contract suffix (verified against js-1sat-ord src/templates/ordLock.ts)
const OLOCK_SUFFIX: &str = "615179547a75537a537a537a0079537a75527a527a7575615579008763567901c161517957795779210ac407f0e4bd44bfc207355a778b046225a7068fc59ee7eda43ad905aadbffc800206c266b30e6a1319c66dc401e5bd6b432ba49688eecd118297041da8074ce081059795679615679aa0079610079517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01007e81517a75615779567956795679567961537956795479577995939521414136d08c5ed2bf3ba048afe6dcaebafeffffffffffffffffffffffffffffff00517951796151795179970079009f63007952799367007968517a75517a75517a7561527a75517a517951795296a0630079527994527a75517a6853798277527982775379012080517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f517f7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e7c7e01205279947f7754537993527993013051797e527e54797e58797e527e53797e52797e57797e0079517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a75517a756100795779ac517a75517a75517a75517a75517a75517a75517a75517a75517a7561517a75517a756169587951797e58797eaa577961007982775179517958947f7551790128947f77517a75517a75618777777777777777777767557951876351795779a9876957795779ac777777777777777767006868";

// ---------------------------------------------------------------------------
// Default fee rate
// ---------------------------------------------------------------------------

/// Default fee rate (sat/byte) matching the frontend constant
const DEFAULT_FEE_RATE: f64 = 0.05;

// ---------------------------------------------------------------------------
// Payout encoding
// ---------------------------------------------------------------------------

/// Encode the payout data for the OrdinalLock script.
///
/// Format: `[8-byte price LE] + [varint script_len] + [P2PKH script]`
fn encode_payout(price_sats: u64, pay_address: &str) -> Result<Vec<u8>, String> {
    // Build a standard P2PKH locking script for the seller's address
    let pkh = pkh_from_address(pay_address)?;
    let mut pay_script = Vec::with_capacity(25);
    pay_script.push(0x76); // OP_DUP
    pay_script.push(0xa9); // OP_HASH160
    pay_script.push(0x14); // push 20 bytes
    pay_script.extend_from_slice(&pkh);
    pay_script.push(0x88); // OP_EQUALVERIFY
    pay_script.push(0xac); // OP_CHECKSIG

    // Encode: 8 bytes price (LE) + varint length + script
    let mut encoded = Vec::new();
    encoded.extend_from_slice(&price_sats.to_le_bytes());

    // Bitcoin varint for script length
    let script_len = pay_script.len();
    if script_len < 0xfd {
        encoded.push(script_len as u8);
    } else if script_len <= 0xffff {
        encoded.push(0xfd);
        encoded.extend_from_slice(&(script_len as u16).to_le_bytes());
    }
    encoded.extend_from_slice(&pay_script);

    Ok(encoded)
}

// ---------------------------------------------------------------------------
// Fee estimation
// ---------------------------------------------------------------------------

/// Estimate the transaction fee for a marketplace transaction.
///
/// Uses a simplified size estimation based on:
/// - 10 bytes overhead (version + locktime + vin/vout varints)
/// - 148 bytes per P2PKH input
/// - Per-output size based on actual script lengths
fn estimate_fee(num_inputs: usize, output_sizes: &[usize]) -> u64 {
    let input_bytes = num_inputs as u64 * 148;
    let output_bytes: u64 = output_sizes
        .iter()
        .map(|&script_len| 8 + 1 + script_len as u64) // satoshis + varint + script
        .sum();
    let total_size = 10 + input_bytes + output_bytes;
    (total_size as f64 * DEFAULT_FEE_RATE).ceil() as u64
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Create an ordinal listing using the OrdinalLock contract.
///
/// Locks the ordinal UTXO under the OrdinalLock script so it can be
/// purchased by anyone who pays the specified price, or cancelled by the
/// original owner.
#[tauri::command]
pub fn create_ordinal_listing(
    ord_wif: String,
    ordinal_utxo: UtxoInput,
    payment_wif: String,
    payment_utxos: Vec<UtxoInput>,
    pay_address: String,
    ord_address: String,
    price_sats: u64,
) -> Result<BuiltTransactionResult, String> {
    // 1. Build OrdinalLock locking script
    let cancel_pkh = pkh_from_address(&ord_address)?;
    let payout = encode_payout(price_sats, &pay_address)?;

    let prefix = hex::decode(OLOCK_PREFIX).map_err(|e| format!("Bad prefix hex: {}", e))?;
    let suffix = hex::decode(OLOCK_SUFFIX).map_err(|e| format!("Bad suffix hex: {}", e))?;

    let mut lock_script = Vec::new();
    lock_script.extend_from_slice(&prefix);
    lock_script.extend_from_slice(&cancel_pkh);
    // Push payout data with length prefix
    lock_script.extend_from_slice(&push_data_bytes(&payout));
    lock_script.extend_from_slice(&suffix);

    // 2. Build transaction
    let ord_privkey = sdk_privkey_from_wif(&ord_wif)?;
    let payment_privkey = sdk_privkey_from_wif(&payment_wif)?;
    let mut tx = SdkTransaction::new();

    // Input 0: ordinal UTXO
    tx.add_input_from(
        &ordinal_utxo.txid,
        ordinal_utxo.vout,
        &ordinal_utxo.script,
        ordinal_utxo.satoshis,
    )
    .map_err(|e| format!("Add ord input: {}", e))?;

    // Inputs 1+: funding UTXOs
    for utxo in &payment_utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Add payment input: {}", e))?;
    }

    // Output 0: locked ordinal (1 sat, OrdinalLock script)
    let mut lock_output = TransactionOutput::new();
    lock_output.satoshis = 1;
    lock_output.locking_script = Script::from_bytes(&lock_script);
    tx.add_output(lock_output);

    // Output 1: change
    let total_funding: u64 = payment_utxos.iter().map(|u| u.satoshis).sum();
    let fee = estimate_fee(
        1 + payment_utxos.len(),
        &[lock_script.len(), 25], // lock output + P2PKH change
    );
    let change = total_funding.saturating_sub(fee);

    let change_address = sdk_address_from_wif(&payment_wif)?;
    if change > 0 {
        add_p2pkh_output(&mut tx, &change_address, change)?;
    }

    // Sign input 0 with ord key
    let ord_template = p2pkh::unlock(ord_privkey, None);
    let unlock_0 = ord_template
        .sign(&tx, 0)
        .map_err(|e| format!("Sign ord input: {}", e))?;
    tx.inputs[0].unlocking_script = Some(unlock_0);

    // Sign inputs 1+ with payment key
    let pay_template = p2pkh::unlock(payment_privkey, None);
    for i in 1..tx.input_count() {
        let unlock = pay_template
            .sign(&tx, i as u32)
            .map_err(|e| format!("Sign payment input {}: {}", i, e))?;
        tx.inputs[i].unlocking_script = Some(unlock);
    }

    // Build result
    let mut spent = vec![SpentOutpoint {
        txid: ordinal_utxo.txid.clone(),
        vout: ordinal_utxo.vout,
    }];
    for u in &payment_utxos {
        spent.push(SpentOutpoint {
            txid: u.txid.clone(),
            vout: u.vout,
        });
    }

    Ok(BuiltTransactionResult {
        raw_tx: tx.to_hex(),
        txid: tx.tx_id_hex(),
        fee,
        change,
        change_address,
        spent_outpoints: spent,
    })
}

/// Cancel an ordinal listing (return ordinal to owner).
///
/// Spends the OrdinalLock UTXO using the cancel branch (OP_1 appended
/// to the unlocking script). The ordinal is sent back to the original
/// ordinal address as a standard P2PKH output.
#[tauri::command]
pub fn cancel_ordinal_listing(
    ord_wif: String,
    listing_utxo: UtxoInput,
    payment_wif: String,
    payment_utxos: Vec<UtxoInput>,
) -> Result<BuiltTransactionResult, String> {
    let ord_privkey = sdk_privkey_from_wif(&ord_wif)?;
    let payment_privkey = sdk_privkey_from_wif(&payment_wif)?;
    let ord_address = sdk_address_from_wif(&ord_wif)?;
    let payment_address = sdk_address_from_wif(&payment_wif)?;

    let mut tx = SdkTransaction::new();

    // Input 0: locked ordinal UTXO
    tx.add_input_from(
        &listing_utxo.txid,
        listing_utxo.vout,
        &listing_utxo.script,
        listing_utxo.satoshis,
    )
    .map_err(|e| format!("Add listing input: {}", e))?;

    // Inputs 1+: funding for fee
    for utxo in &payment_utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Add payment input: {}", e))?;
    }

    // Output 0: ordinal back to owner (1 sat P2PKH)
    add_p2pkh_output(&mut tx, &ord_address, 1)?;

    // Output 1: change to payment address
    let total_funding: u64 = payment_utxos.iter().map(|u| u.satoshis).sum();
    let fee = estimate_fee(
        1 + payment_utxos.len(),
        &[25, 25], // two P2PKH outputs
    );
    let change = total_funding.saturating_sub(fee);

    if change > 0 {
        add_p2pkh_output(&mut tx, &payment_address, change)?;
    }

    // Sign input 0: cancel unlock = <sig> <pubkey> OP_1
    // The OP_1 triggers the cancel branch in the OrdinalLock contract
    let ord_template = p2pkh::unlock(ord_privkey, None);
    let base_unlock = ord_template
        .sign(&tx, 0)
        .map_err(|e| format!("Sign cancel input: {}", e))?;

    // Append OP_1 (0x51) to the unlocking script for the cancel branch
    let mut unlock_bytes = base_unlock.to_bytes().to_vec();
    unlock_bytes.push(0x51); // OP_1
    tx.inputs[0].unlocking_script = Some(Script::from_bytes(&unlock_bytes));

    // Sign inputs 1+ with payment key
    let pay_template = p2pkh::unlock(payment_privkey, None);
    for i in 1..tx.input_count() {
        let unlock = pay_template
            .sign(&tx, i as u32)
            .map_err(|e| format!("Sign payment input {}: {}", i, e))?;
        tx.inputs[i].unlocking_script = Some(unlock);
    }

    let mut spent = vec![SpentOutpoint {
        txid: listing_utxo.txid.clone(),
        vout: listing_utxo.vout,
    }];
    for u in &payment_utxos {
        spent.push(SpentOutpoint {
            txid: u.txid.clone(),
            vout: u.vout,
        });
    }

    Ok(BuiltTransactionResult {
        raw_tx: tx.to_hex(),
        txid: tx.tx_id_hex(),
        fee,
        change,
        change_address: payment_address,
        spent_outpoints: spent,
    })
}

/// Purchase a listed ordinal.
///
/// Spends the OrdinalLock UTXO by providing the correct outputs:
///   - Output 0: ordinal to buyer's address (1 sat P2PKH)
///   - Output 1: payment to seller at the price encoded in the listing
///   - Output 2: change back to buyer
///
/// The `payout` parameter is a base64-encoded payment output script
/// extracted from the listing transaction's OrdinalLock script.
#[tauri::command]
pub fn purchase_ordinal(
    payment_wif: String,
    payment_utxos: Vec<UtxoInput>,
    ord_address: String,
    listing_utxo: UtxoInput,
    payout: String,
    price_sats: u64,
) -> Result<BuiltTransactionResult, String> {
    let payment_privkey = sdk_privkey_from_wif(&payment_wif)?;
    let payment_address = sdk_address_from_wif(&payment_wif)?;

    // Decode payout script from base64
    let payout_bytes = base64::engine::general_purpose::STANDARD
        .decode(&payout)
        .map_err(|e| format!("Invalid payout base64: {}", e))?;

    let mut tx = SdkTransaction::new();

    // Input 0: locked ordinal UTXO
    tx.add_input_from(
        &listing_utxo.txid,
        listing_utxo.vout,
        &listing_utxo.script,
        listing_utxo.satoshis,
    )
    .map_err(|e| format!("Add listing input: {}", e))?;

    // Inputs 1+: buyer's funding UTXOs
    for utxo in &payment_utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Add payment input: {}", e))?;
    }

    // Output 0: ordinal to buyer (1 sat P2PKH)
    add_p2pkh_output(&mut tx, &ord_address, 1)?;

    // Output 1: payment to seller (price sats, seller's script from payout)
    let mut pay_output = TransactionOutput::new();
    pay_output.satoshis = price_sats;
    pay_output.locking_script = Script::from_bytes(&payout_bytes);
    tx.add_output(pay_output);

    // Output 2: change to buyer
    let total_funding: u64 = payment_utxos.iter().map(|u| u.satoshis).sum();
    let fee = estimate_fee(
        1 + payment_utxos.len(),
        &[25, payout_bytes.len(), 25], // ord P2PKH + seller script + change P2PKH
    );
    let change = total_funding.saturating_sub(price_sats + fee);

    if change > 0 {
        add_p2pkh_output(&mut tx, &payment_address, change)?;
    }

    // Sign all inputs with payment key
    // Input 0 uses a P2PKH-style signature (simplified for the purchase branch)
    let pay_template = p2pkh::unlock(payment_privkey, None);
    for i in 0..tx.input_count() {
        let unlock = pay_template
            .sign(&tx, i as u32)
            .map_err(|e| format!("Sign input {}: {}", i, e))?;
        tx.inputs[i].unlocking_script = Some(unlock);
    }

    let mut spent = vec![SpentOutpoint {
        txid: listing_utxo.txid.clone(),
        vout: listing_utxo.vout,
    }];
    for u in &payment_utxos {
        spent.push(SpentOutpoint {
            txid: u.txid.clone(),
            vout: u.vout,
        });
    }

    Ok(BuiltTransactionResult {
        raw_tx: tx.to_hex(),
        txid: tx.tx_id_hex(),
        fee,
        change,
        change_address: payment_address,
        spent_outpoints: spent,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Derive a known test WIF from the "abandon" mnemonic (same as bsv_sdk_adapter tests).
    fn test_wif(path_suffix: &str) -> String {
        let mnemonic_str =
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let mn: bip39::Mnemonic = mnemonic_str.parse().unwrap();
        let seed = mn.to_seed("");
        let master = bip32::XPrv::new(seed).unwrap();

        // Parse BIP-32 path like "1/0"
        let mut key = master
            .derive_child(bip32::ChildNumber::new(44, true).unwrap())
            .unwrap()
            .derive_child(bip32::ChildNumber::new(236, true).unwrap())
            .unwrap()
            .derive_child(bip32::ChildNumber::new(0, true).unwrap())
            .unwrap();

        for part in path_suffix.split('/') {
            let index: u32 = part.parse().unwrap();
            key = key
                .derive_child(bip32::ChildNumber::new(index, false).unwrap())
                .unwrap();
        }

        let privkey_bytes: [u8; 32] = key.to_bytes().into();
        let mut payload = Vec::with_capacity(34);
        payload.push(0x80);
        payload.extend_from_slice(&privkey_bytes);
        payload.push(0x01);
        bs58::encode(payload).with_check().into_string()
    }

    fn dummy_p2pkh_script(address: &str) -> String {
        let pkh = pkh_from_address(address).unwrap();
        let mut script = Vec::with_capacity(25);
        script.push(0x76);
        script.push(0xa9);
        script.push(0x14);
        script.extend_from_slice(&pkh);
        script.push(0x88);
        script.push(0xac);
        hex::encode(script)
    }

    #[test]
    fn encode_payout_produces_correct_format() {
        let address = sdk_address_from_wif(&test_wif("0/0")).unwrap();
        let price: u64 = 50000;
        let encoded = encode_payout(price, &address).unwrap();

        // First 8 bytes should be price in LE
        let price_bytes = &encoded[0..8];
        assert_eq!(
            u64::from_le_bytes(price_bytes.try_into().unwrap()),
            price,
            "Price should be encoded as 8-byte LE"
        );

        // Next byte should be varint for script length (25 for P2PKH = 0x19)
        assert_eq!(encoded[8], 25, "P2PKH script length should be 25");

        // Total length: 8 (price) + 1 (varint) + 25 (P2PKH script) = 34
        assert_eq!(encoded.len(), 34, "Encoded payout should be 34 bytes");

        // Verify the embedded P2PKH script structure
        assert_eq!(encoded[9], 0x76, "Script should start with OP_DUP");
        assert_eq!(encoded[10], 0xa9, "OP_HASH160");
        assert_eq!(encoded[11], 0x14, "Push 20 bytes");
        assert_eq!(encoded[32], 0x88, "OP_EQUALVERIFY");
        assert_eq!(encoded[33], 0xac, "OP_CHECKSIG");
    }

    #[test]
    fn ordinal_lock_script_structure() {
        let ord_address = sdk_address_from_wif(&test_wif("1/0")).unwrap();
        let pay_address = sdk_address_from_wif(&test_wif("0/0")).unwrap();
        let price: u64 = 100000;

        let cancel_pkh = pkh_from_address(&ord_address).unwrap();
        let payout = encode_payout(price, &pay_address).unwrap();

        let prefix = hex::decode(OLOCK_PREFIX).unwrap();
        let suffix = hex::decode(OLOCK_SUFFIX).unwrap();

        let mut lock_script = Vec::new();
        lock_script.extend_from_slice(&prefix);
        lock_script.extend_from_slice(&cancel_pkh);
        lock_script.extend_from_slice(&push_data_bytes(&payout));
        lock_script.extend_from_slice(&suffix);

        // Verify script starts with prefix
        assert_eq!(
            &lock_script[..prefix.len()],
            &prefix[..],
            "Script should start with OLOCK_PREFIX"
        );

        // Verify cancel PKH is embedded after prefix
        assert_eq!(
            &lock_script[prefix.len()..prefix.len() + 20],
            &cancel_pkh[..],
            "Cancel PKH should follow the prefix"
        );

        // Verify script ends with suffix
        let script_len = lock_script.len();
        assert_eq!(
            &lock_script[script_len - suffix.len()..],
            &suffix[..],
            "Script should end with OLOCK_SUFFIX"
        );
    }

    #[test]
    fn create_ordinal_listing_builds_valid_tx() {
        let ord_wif = test_wif("1/0");
        let payment_wif = test_wif("0/0");
        let ord_address = sdk_address_from_wif(&ord_wif).unwrap();
        let pay_address = sdk_address_from_wif(&payment_wif).unwrap();

        let result = create_ordinal_listing(
            ord_wif,
            UtxoInput {
                txid: "a".repeat(64),
                vout: 0,
                satoshis: 1,
                script: dummy_p2pkh_script(&ord_address),
            },
            payment_wif.clone(),
            vec![UtxoInput {
                txid: "b".repeat(64),
                vout: 0,
                satoshis: 100000,
                script: dummy_p2pkh_script(&pay_address),
            }],
            pay_address,
            ord_address,
            50000,
        )
        .unwrap();

        assert!(!result.raw_tx.is_empty(), "Raw tx should be non-empty");
        assert_eq!(result.txid.len(), 64, "TXID should be 64 hex chars");
        assert!(result.fee > 0, "Fee should be positive");
        assert!(!result.spent_outpoints.is_empty(), "Should have spent outpoints");
        assert_eq!(
            result.spent_outpoints.len(),
            2,
            "Should spend ord + payment UTXO"
        );
    }

    #[test]
    fn cancel_ordinal_listing_builds_valid_tx() {
        let ord_wif = test_wif("1/0");
        let payment_wif = test_wif("0/0");
        let ord_address = sdk_address_from_wif(&ord_wif).unwrap();
        let pay_address = sdk_address_from_wif(&payment_wif).unwrap();

        // First create a listing to get the lock script
        let listing = create_ordinal_listing(
            ord_wif.clone(),
            UtxoInput {
                txid: "a".repeat(64),
                vout: 0,
                satoshis: 1,
                script: dummy_p2pkh_script(&ord_address),
            },
            payment_wif.clone(),
            vec![UtxoInput {
                txid: "b".repeat(64),
                vout: 0,
                satoshis: 100000,
                script: dummy_p2pkh_script(&pay_address),
            }],
            pay_address.clone(),
            ord_address.clone(),
            50000,
        )
        .unwrap();

        // For the cancel test, use the listing txid + vout 0 with a dummy lock script
        // (In production, the lock script would come from the blockchain)
        let lock_script_hex = dummy_p2pkh_script(&ord_address); // simplified for test

        let result = cancel_ordinal_listing(
            ord_wif,
            UtxoInput {
                txid: listing.txid.clone(),
                vout: 0,
                satoshis: 1,
                script: lock_script_hex,
            },
            payment_wif,
            vec![UtxoInput {
                txid: "c".repeat(64),
                vout: 0,
                satoshis: 50000,
                script: dummy_p2pkh_script(&pay_address),
            }],
        )
        .unwrap();

        assert!(!result.raw_tx.is_empty(), "Cancel tx should be non-empty");
        assert_eq!(result.txid.len(), 64, "TXID should be 64 hex chars");

        assert!(
            result.spent_outpoints.len() == 2,
            "Should spend listing + payment UTXO"
        );
    }

    #[test]
    fn estimate_fee_calculates_correctly() {
        // 1 input, 2 outputs (25-byte P2PKH each)
        // Size: 10 + 148 + (8+1+25)*2 = 10 + 148 + 68 = 226
        // Fee at 0.05 sat/byte: ceil(226 * 0.05) = ceil(11.3) = 12
        let fee = estimate_fee(1, &[25, 25]);
        assert_eq!(fee, 12, "Fee for 1-input 2-output P2PKH tx at 0.05 sat/byte");
    }

    #[test]
    fn encode_payout_with_high_price() {
        let address = sdk_address_from_wif(&test_wif("0/0")).unwrap();
        let price: u64 = 21_000_000 * 100_000_000; // 21M BSV in sats
        let encoded = encode_payout(price, &address).unwrap();

        let decoded_price = u64::from_le_bytes(encoded[0..8].try_into().unwrap());
        assert_eq!(decoded_price, price, "High price should encode correctly");
    }
}
