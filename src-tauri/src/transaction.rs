//! P2PKH Transaction Builder
//!
//! Builds and signs standard P2PKH Bitcoin SV transactions entirely in Rust,
//! so that private keys never enter the webview's JavaScript heap.
//!
//! The frontend sends UTXOs + WIF(s) + destination → Rust signs → returns
//! { rawTx, txid, fee, change }.
//!
//! Transaction building, sighash computation, and signing are handled by
//! the bsv-sdk-rust Transaction builder. Fee calculation remains custom.

use crate::bsv_sdk_adapter::{sdk_address_from_wif, sdk_privkey_from_wif};
use bsv_sdk::script::address::Address;
use bsv_sdk::transaction::template::p2pkh;
use bsv_sdk::transaction::template::UnlockingScriptTemplate;
use bsv_sdk::transaction::{Transaction as SdkTransaction, TransactionOutput};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Serde types matching the TypeScript interfaces
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UtxoInput {
    pub txid: String,
    pub vout: u32,
    pub satoshis: u64,
    pub script: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtendedUtxoInput {
    pub txid: String,
    pub vout: u32,
    pub satoshis: u64,
    pub script: String,
    pub wif: String,
    pub address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltTransactionResult {
    /// Hex-encoded raw signed transaction
    pub raw_tx: String,
    /// Transaction ID (double-SHA256 of raw tx, reversed)
    pub txid: String,
    /// Fee paid in satoshis
    pub fee: u64,
    /// Change amount in satoshis (0 if no change output)
    pub change: u64,
    /// The change address
    pub change_address: String,
    /// Spent outpoints
    pub spent_outpoints: Vec<SpentOutpoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltConsolidationResult {
    pub raw_tx: String,
    pub txid: String,
    pub fee: u64,
    pub output_sats: u64,
    pub address: String,
    pub spent_outpoints: Vec<SpentOutpoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpentOutpoint {
    pub txid: String,
    pub vout: u32,
}

// ---------------------------------------------------------------------------
// Fee calculation (mirrors TypeScript domain/transaction/fees.ts)
// ---------------------------------------------------------------------------

const P2PKH_INPUT_SIZE: u64 = 148;
const P2PKH_OUTPUT_SIZE: u64 = 34;
const TX_OVERHEAD: u64 = 10;

fn calculate_tx_fee(num_inputs: usize, num_outputs: usize, fee_rate: f64) -> u64 {
    let size = TX_OVERHEAD
        + (num_inputs as u64) * P2PKH_INPUT_SIZE
        + (num_outputs as u64) * P2PKH_OUTPUT_SIZE;
    let fee = (size as f64 * fee_rate).ceil() as u64;
    fee.max(1) // minimum 1 sat
}

fn calculate_change_and_fee(
    total_input: u64,
    satoshis: u64,
    num_inputs: usize,
    fee_rate: f64,
) -> Result<(u64, u64, usize), String> {
    let prelim_change = total_input.saturating_sub(satoshis);
    let will_have_change = prelim_change > 100;
    let num_outputs = if will_have_change { 2 } else { 1 };
    let fee = calculate_tx_fee(num_inputs, num_outputs, fee_rate);
    let change = total_input
        .checked_sub(satoshis)
        .and_then(|v| v.checked_sub(fee))
        .ok_or_else(|| format!("Insufficient funds: need {} + {} fee, have {}", satoshis, fee, total_input))?;
    Ok((fee, change, num_outputs))
}

// ---------------------------------------------------------------------------
// SDK transaction helpers
// ---------------------------------------------------------------------------

/// Add a P2PKH output to a transaction for the given address and satoshi amount.
fn add_p2pkh_output(tx: &mut SdkTransaction, address: &str, satoshis: u64) -> Result<(), String> {
    let addr = Address::from_string(address)
        .map_err(|e| format!("Invalid address '{}': {}", address, e))?;
    let locking_script = p2pkh::lock(&addr)
        .map_err(|e| format!("Failed to create locking script: {}", e))?;
    let mut output = TransactionOutput::new();
    output.satoshis = satoshis;
    output.locking_script = locking_script;
    tx.add_output(output);
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Build and sign a P2PKH transaction (single key).
#[tauri::command]
pub fn build_p2pkh_tx(
    wif: String,
    to_address: String,
    satoshis: u64,
    selected_utxos: Vec<UtxoInput>,
    total_input: u64,
    fee_rate: f64,
) -> Result<BuiltTransactionResult, String> {
    let from_address = sdk_address_from_wif(&wif)?;

    let (fee, change, _num_outputs) =
        calculate_change_and_fee(total_input, satoshis, selected_utxos.len(), fee_rate)?;

    // Build transaction
    let mut tx = SdkTransaction::new();

    for utxo in &selected_utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Failed to add input: {}", e))?;
    }

    add_p2pkh_output(&mut tx, &to_address, satoshis)?;
    if change > 0 {
        add_p2pkh_output(&mut tx, &from_address, change)?;
    }

    // Sign all inputs with the same key
    let privkey = sdk_privkey_from_wif(&wif)?;
    let template = p2pkh::unlock(privkey, None);
    for i in 0..tx.input_count() {
        let unlock_script = template
            .sign(&tx, i as u32)
            .map_err(|e| format!("Failed to sign input {}: {}", i, e))?;
        tx.inputs[i].unlocking_script = Some(unlock_script);
    }

    Ok(BuiltTransactionResult {
        raw_tx: tx.to_hex(),
        txid: tx.tx_id_hex(),
        fee,
        change,
        change_address: from_address,
        spent_outpoints: selected_utxos
            .iter()
            .map(|u| SpentOutpoint {
                txid: u.txid.clone(),
                vout: u.vout,
            })
            .collect(),
    })
}

/// Build and sign a multi-key P2PKH transaction.
#[tauri::command]
pub fn build_multi_key_p2pkh_tx(
    change_wif: String,
    to_address: String,
    satoshis: u64,
    selected_utxos: Vec<ExtendedUtxoInput>,
    total_input: u64,
    fee_rate: f64,
) -> Result<BuiltTransactionResult, String> {
    let change_address = sdk_address_from_wif(&change_wif)?;

    let (fee, change, _num_outputs) =
        calculate_change_and_fee(total_input, satoshis, selected_utxos.len(), fee_rate)?;

    // Build transaction
    let mut tx = SdkTransaction::new();

    for utxo in &selected_utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Failed to add input: {}", e))?;
    }

    add_p2pkh_output(&mut tx, &to_address, satoshis)?;
    if change > 0 {
        add_p2pkh_output(&mut tx, &change_address, change)?;
    }

    // Sign each input with its own key
    for (i, utxo) in selected_utxos.iter().enumerate() {
        let privkey = sdk_privkey_from_wif(&utxo.wif)?;
        let template = p2pkh::unlock(privkey, None);
        let unlock_script = template
            .sign(&tx, i as u32)
            .map_err(|e| format!("Failed to sign input {}: {}", i, e))?;
        tx.inputs[i].unlocking_script = Some(unlock_script);
    }

    Ok(BuiltTransactionResult {
        raw_tx: tx.to_hex(),
        txid: tx.tx_id_hex(),
        fee,
        change,
        change_address,
        spent_outpoints: selected_utxos
            .iter()
            .map(|u| SpentOutpoint {
                txid: u.txid.clone(),
                vout: u.vout,
            })
            .collect(),
    })
}

/// Build and sign a consolidation transaction (all UTXOs → single output).
#[tauri::command]
pub fn build_consolidation_tx(
    wif: String,
    utxos: Vec<UtxoInput>,
    fee_rate: f64,
) -> Result<BuiltConsolidationResult, String> {
    if utxos.len() < 2 {
        return Err("Need at least 2 UTXOs to consolidate".into());
    }

    let address = sdk_address_from_wif(&wif)?;

    let total_input: u64 = utxos.iter().map(|u| u.satoshis).sum();
    let fee = calculate_tx_fee(utxos.len(), 1, fee_rate);
    let output_sats = total_input.checked_sub(fee).unwrap_or(0);

    if output_sats == 0 {
        return Err(format!(
            "Cannot consolidate: total {} sats minus {} fee leaves no output",
            total_input, fee
        ));
    }

    // Build transaction
    let mut tx = SdkTransaction::new();

    for utxo in &utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Failed to add input: {}", e))?;
    }

    add_p2pkh_output(&mut tx, &address, output_sats)?;

    // Sign all inputs
    let privkey = sdk_privkey_from_wif(&wif)?;
    let template = p2pkh::unlock(privkey, None);
    for i in 0..tx.input_count() {
        let unlock_script = template
            .sign(&tx, i as u32)
            .map_err(|e| format!("Failed to sign input {}: {}", i, e))?;
        tx.inputs[i].unlocking_script = Some(unlock_script);
    }

    Ok(BuiltConsolidationResult {
        raw_tx: tx.to_hex(),
        txid: tx.tx_id_hex(),
        fee,
        output_sats,
        address,
        spent_outpoints: utxos
            .iter()
            .map(|u| SpentOutpoint {
                txid: u.txid.clone(),
                vout: u.vout,
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Test mnemonic-derived WIF (from key_derivation tests)
    fn get_test_wif() -> String {
        let keys = crate::key_derivation::derive_wallet_keys(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string()
        ).unwrap();
        keys.wallet_wif
    }

    fn get_test_address() -> String {
        let keys = crate::key_derivation::derive_wallet_keys(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string()
        ).unwrap();
        keys.wallet_address
    }

    #[test]
    fn fee_calculation_matches_typescript() {
        // 1 input, 2 outputs at 0.1 sat/byte
        // Size = 10 + 148 + 68 = 226 bytes
        // Fee = ceil(226 * 0.1) = 23
        let fee = calculate_tx_fee(1, 2, 0.1);
        assert_eq!(fee, 23);

        // 2 inputs, 1 output at 0.05 sat/byte
        // Size = 10 + 296 + 34 = 340 bytes
        // Fee = ceil(340 * 0.05) = 17
        let fee = calculate_tx_fee(2, 1, 0.05);
        assert_eq!(fee, 17);
    }

    #[test]
    fn build_p2pkh_tx_basic() {
        let wif = get_test_wif();
        let address = get_test_address();

        let result = build_p2pkh_tx(
            wif,
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            5000,
            vec![UtxoInput {
                txid: "a".repeat(64),
                vout: 0,
                satoshis: 10000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            10000,
            0.1,
        );

        assert!(result.is_ok(), "build_p2pkh_tx failed: {:?}", result.err());
        let built = result.unwrap();

        assert!(!built.raw_tx.is_empty());
        assert_eq!(built.txid.len(), 64);
        assert!(built.fee > 0);
        assert!(built.change > 0);
        assert_eq!(built.change_address, address);
        assert_eq!(built.spent_outpoints.len(), 1);
    }

    #[test]
    fn build_p2pkh_tx_insufficient_funds() {
        let wif = get_test_wif();

        let result = build_p2pkh_tx(
            wif,
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            10000,
            vec![UtxoInput {
                txid: "b".repeat(64),
                vout: 0,
                satoshis: 100,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            100,
            0.1,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Insufficient funds"));
    }

    #[test]
    fn build_consolidation_tx_basic() {
        let wif = get_test_wif();

        let result = build_consolidation_tx(
            wif,
            vec![
                UtxoInput {
                    txid: "c".repeat(64),
                    vout: 0,
                    satoshis: 5000,
                    script: "76a914".to_string() + &"00".repeat(20) + "88ac",
                },
                UtxoInput {
                    txid: "d".repeat(64),
                    vout: 1,
                    satoshis: 3000,
                    script: "76a914".to_string() + &"00".repeat(20) + "88ac",
                },
            ],
            0.1,
        );

        assert!(result.is_ok(), "build_consolidation_tx failed: {:?}", result.err());
        let built = result.unwrap();

        assert!(!built.raw_tx.is_empty());
        assert_eq!(built.txid.len(), 64);
        assert!(built.fee > 0);
        assert!(built.output_sats > 0);
        assert_eq!(built.output_sats + built.fee, 8000);
        assert_eq!(built.spent_outpoints.len(), 2);
    }

    #[test]
    fn build_consolidation_too_few_utxos() {
        let wif = get_test_wif();

        let result = build_consolidation_tx(
            wif,
            vec![UtxoInput {
                txid: "e".repeat(64),
                vout: 0,
                satoshis: 5000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            0.1,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("at least 2"));
    }

    #[test]
    fn txid_is_deterministic() {
        let wif = get_test_wif();

        let result1 = build_p2pkh_tx(
            wif.clone(),
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            1000,
            vec![UtxoInput {
                txid: "f".repeat(64),
                vout: 0,
                satoshis: 5000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            5000,
            0.1,
        ).unwrap();

        let result2 = build_p2pkh_tx(
            wif,
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            1000,
            vec![UtxoInput {
                txid: "f".repeat(64),
                vout: 0,
                satoshis: 5000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            5000,
            0.1,
        ).unwrap();

        assert_eq!(result1.txid, result2.txid);
        assert_eq!(result1.raw_tx, result2.raw_tx);
    }

    #[test]
    fn built_tx_has_valid_structure() {
        let wif = get_test_wif();
        let address = get_test_address();

        let result = build_p2pkh_tx(
            wif,
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            5000,
            vec![UtxoInput {
                txid: "a".repeat(64),
                vout: 0,
                satoshis: 10000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            10000,
            0.1,
        ).unwrap();

        let raw_bytes = hex::decode(&result.raw_tx).unwrap();
        assert!(raw_bytes.len() > 50, "Raw tx should be non-trivial");

        // Verify change address matches derived address
        assert_eq!(result.change_address, address);

        // Verify txid = reversed double-SHA256 of raw tx
        let hash = crate::bsv_sdk_adapter::sdk_double_sha256(&raw_bytes);
        let mut reversed = hash;
        reversed.reverse();
        let computed_txid = hex::encode(reversed);
        assert_eq!(computed_txid, result.txid);
    }

    #[test]
    fn testnet_address_does_not_panic() {
        // Testnet addresses may or may not be rejected by the SDK.
        // We verify the function does not panic regardless.
        let wif = get_test_wif();
        let _result = build_p2pkh_tx(
            wif,
            "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn".to_string(),
            1000,
            vec![UtxoInput {
                txid: "e".repeat(64),
                vout: 0,
                satoshis: 5000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            5000,
            0.1,
        );
    }
}
