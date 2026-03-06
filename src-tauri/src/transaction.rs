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
use bsv_sdk::script::Script;
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

pub(crate) fn calculate_tx_fee(num_inputs: usize, num_outputs: usize, fee_rate: f64) -> u64 {
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
pub(crate) fn add_p2pkh_output(tx: &mut SdkTransaction, address: &str, satoshis: u64) -> Result<(), String> {
    if satoshis == 0 {
        return Err("Output satoshis must be > 0".into());
    }
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

// ---------------------------------------------------------------------------
// Lock/Unlock result type
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltLockResult {
    /// Hex-encoded raw signed transaction
    pub raw_tx: String,
    /// Transaction ID
    pub txid: String,
}

// ---------------------------------------------------------------------------
// Lock transaction builder
// ---------------------------------------------------------------------------

/// Build and sign a transaction that creates a CLTV time-locked output.
///
/// Inputs: P2PKH UTXOs signed with wallet key.
/// Output 0: Custom timelock locking script (lock_satoshis).
/// Output 1 (optional): OP_RETURN data output (0 sats).
/// Output 2 (optional): P2PKH change output (change_satoshis).
#[tauri::command]
pub fn build_lock_tx(
    wif: String,
    selected_utxos: Vec<UtxoInput>,
    lock_satoshis: u64,
    timelock_script_hex: String,
    change_address: String,
    change_satoshis: u64,
    op_return_hex: Option<String>,
) -> Result<BuiltLockResult, String> {
    let mut tx = SdkTransaction::new();

    // Add P2PKH inputs
    for utxo in &selected_utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Failed to add input: {}", e))?;
    }

    // Output 0: Timelock locking script
    let lock_script = Script::from_hex(&timelock_script_hex)
        .map_err(|e| format!("Invalid timelock script hex: {}", e))?;
    let mut lock_output = TransactionOutput::new();
    lock_output.satoshis = lock_satoshis;
    lock_output.locking_script = lock_script;
    tx.add_output(lock_output);

    // Output 1 (optional): OP_RETURN
    if let Some(ref op_hex) = op_return_hex {
        let op_script = Script::from_hex(op_hex)
            .map_err(|e| format!("Invalid OP_RETURN hex: {}", e))?;
        let mut op_output = TransactionOutput::new();
        op_output.satoshis = 0;
        op_output.locking_script = op_script;
        tx.add_output(op_output);
    }

    // Output 2 (optional): P2PKH change
    if change_satoshis > 0 {
        add_p2pkh_output(&mut tx, &change_address, change_satoshis)?;
    }

    // Sign all inputs with the wallet key
    let privkey = sdk_privkey_from_wif(&wif)?;
    let template = p2pkh::unlock(privkey, None);
    for i in 0..tx.input_count() {
        let unlock_script = template
            .sign(&tx, i as u32)
            .map_err(|e| format!("Failed to sign input {}: {}", i, e))?;
        tx.inputs[i].unlocking_script = Some(unlock_script);
    }

    Ok(BuiltLockResult {
        raw_tx: tx.to_hex(),
        txid: tx.tx_id_hex(),
    })
}

// ---------------------------------------------------------------------------
// Unlock transaction builder
// ---------------------------------------------------------------------------

/// Build and sign a transaction that spends a CLTV-locked UTXO.
///
/// The nLockTime is set to `unlock_block` and nSequence to 0xFFFFFFFE
/// to enable nLockTime validation. The input is signed with a standard
/// P2PKH template — the on-chain script's OP_CHECKLOCKTIMEVERIFY opcode
/// validates that nLockTime >= the threshold block height.
#[tauri::command]
pub fn build_unlock_tx(
    wif: String,
    locked_txid: String,
    locked_vout: u32,
    locked_satoshis: u64,
    locking_script_hex: String,
    unlock_block: u32,
    to_address: String,
    output_satoshis: u64,
) -> Result<BuiltLockResult, String> {
    let mut tx = SdkTransaction::new();

    // Set nLockTime to the unlock block height
    tx.lock_time = unlock_block;

    // Add the locked UTXO as input
    tx.add_input_from(&locked_txid, locked_vout, &locking_script_hex, locked_satoshis)
        .map_err(|e| format!("Failed to add locked input: {}", e))?;

    // Set nSequence to 0xFFFFFFFE to enable nLockTime
    tx.inputs[0].sequence_number = 0xFFFFFFFE;

    // Output: P2PKH to destination
    add_p2pkh_output(&mut tx, &to_address, output_satoshis)?;

    // Sign with standard P2PKH template
    let privkey = sdk_privkey_from_wif(&wif)?;
    let template = p2pkh::unlock(privkey, None);
    let unlock_script = template
        .sign(&tx, 0)
        .map_err(|e| format!("Failed to sign unlock input: {}", e))?;
    tx.inputs[0].unlocking_script = Some(unlock_script);

    Ok(BuiltLockResult {
        raw_tx: tx.to_hex(),
        txid: tx.tx_id_hex(),
    })
}

// ---------------------------------------------------------------------------
// Ordinal transfer transaction builder
// ---------------------------------------------------------------------------

/// Build and sign a 2-key transaction to transfer an ordinal.
///
/// Input 0: ordinal UTXO (signed with ord_wif).
/// Inputs 1+: funding UTXOs (signed with funding_wif).
/// Output 0: ordinal to recipient (1 sat P2PKH).
/// Output 1: change to funding address (P2PKH).
#[tauri::command]
pub fn build_ordinal_transfer_tx(
    ord_wif: String,
    ordinal_utxo: UtxoInput,
    to_address: String,
    funding_wif: String,
    funding_utxos: Vec<UtxoInput>,
    fee_rate: f64,
) -> Result<BuiltTransactionResult, String> {
    let funding_address = sdk_address_from_wif(&funding_wif)?;

    let mut tx = SdkTransaction::new();

    // Input 0: ordinal UTXO
    tx.add_input_from(&ordinal_utxo.txid, ordinal_utxo.vout, &ordinal_utxo.script, ordinal_utxo.satoshis)
        .map_err(|e| format!("Failed to add ordinal input: {}", e))?;

    // Inputs 1+: funding UTXOs
    for utxo in &funding_utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Failed to add funding input: {}", e))?;
    }

    // Output 0: ordinal to recipient (1 sat)
    add_p2pkh_output(&mut tx, &to_address, 1)?;

    // Calculate total funding input and fee
    let total_funding: u64 = funding_utxos.iter().map(|u| u.satoshis).sum();
    let total_input = ordinal_utxo.satoshis + total_funding;
    // 1 ordinal input + N funding inputs, 2 outputs (ordinal + change)
    let fee = calculate_tx_fee(1 + funding_utxos.len(), 2, fee_rate);
    let change = total_input
        .checked_sub(1) // ordinal output
        .and_then(|v| v.checked_sub(fee))
        .ok_or_else(|| format!(
            "Insufficient funds: need 1 sat + {} fee, have {} total",
            fee, total_input
        ))?;

    // Output 1: change to funding address
    if change > 0 {
        add_p2pkh_output(&mut tx, &funding_address, change)?;
    }

    // Sign input 0 with ordinal key
    let ord_privkey = sdk_privkey_from_wif(&ord_wif)?;
    let ord_template = p2pkh::unlock(ord_privkey, None);
    let ord_unlock = ord_template
        .sign(&tx, 0)
        .map_err(|e| format!("Failed to sign ordinal input: {}", e))?;
    tx.inputs[0].unlocking_script = Some(ord_unlock);

    // Sign inputs 1+ with funding key
    let funding_privkey = sdk_privkey_from_wif(&funding_wif)?;
    let funding_template = p2pkh::unlock(funding_privkey, None);
    for i in 1..tx.input_count() {
        let unlock_script = funding_template
            .sign(&tx, i as u32)
            .map_err(|e| format!("Failed to sign funding input {}: {}", i, e))?;
        tx.inputs[i].unlocking_script = Some(unlock_script);
    }

    // Build spent outpoints list
    let mut spent_outpoints = vec![SpentOutpoint {
        txid: ordinal_utxo.txid.clone(),
        vout: ordinal_utxo.vout,
    }];
    spent_outpoints.extend(funding_utxos.iter().map(|u| SpentOutpoint {
        txid: u.txid.clone(),
        vout: u.vout,
    }));

    Ok(BuiltTransactionResult {
        raw_tx: tx.to_hex(),
        txid: tx.tx_id_hex(),
        fee,
        change,
        change_address: funding_address,
        spent_outpoints,
    })
}

// ---------------------------------------------------------------------------
// Inscription helpers
// ---------------------------------------------------------------------------

/// Extract the 20-byte public key hash from a BSV address (base58check).
pub(crate) fn pkh_from_address(address: &str) -> Result<[u8; 20], String> {
    let decoded = bs58::decode(address)
        .with_check(None)
        .into_vec()
        .map_err(|e| format!("Invalid address '{}': {}", address, e))?;
    if decoded.len() < 21 {
        return Err(format!("Address too short: {} bytes", decoded.len()));
    }
    let mut pkh = [0u8; 20];
    pkh.copy_from_slice(&decoded[1..21]);
    Ok(pkh)
}

/// Build Bitcoin push data opcode(s) for a byte slice.
///
/// Uses standard Bitcoin push opcodes:
/// - 0x01..0x4b: direct push (length byte = data length)
/// - 0x4c (OP_PUSHDATA1): 1-byte length prefix
/// - 0x4d (OP_PUSHDATA2): 2-byte little-endian length prefix
pub(crate) fn push_data_bytes(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::new();
    let len = data.len();
    if len == 0 {
        // Empty push — just push zero bytes
        result.push(0x00);
    } else if len <= 0x4b {
        result.push(len as u8);
    } else if len <= 0xff {
        result.push(0x4c); // OP_PUSHDATA1
        result.push(len as u8);
    } else {
        result.push(0x4d); // OP_PUSHDATA2
        result.extend_from_slice(&(len as u16).to_le_bytes());
    }
    result.extend_from_slice(data);
    result
}

/// Build an inscription locking script: `OP_FALSE OP_IF ... OP_ENDIF` + standard P2PKH.
///
/// The inscription envelope format is:
/// ```text
/// OP_FALSE OP_IF
///   OP_PUSH "ord"
///   OP_1 <content-type>
///   OP_0 <content>
/// OP_ENDIF
/// OP_DUP OP_HASH160 <20-byte pkh> OP_EQUALVERIFY OP_CHECKSIG
/// ```
fn build_inscription_script(content: &[u8], content_type: &str, dest_pkh: &[u8; 20]) -> Vec<u8> {
    let mut script = Vec::new();

    // Inscription envelope
    script.push(0x00); // OP_FALSE
    script.push(0x63); // OP_IF
    script.extend_from_slice(&push_data_bytes(b"ord")); // push "ord"
    script.push(0x51); // OP_1 (content type tag)
    script.extend_from_slice(&push_data_bytes(content_type.as_bytes()));
    script.push(0x00); // OP_0 (content tag)
    script.extend_from_slice(&push_data_bytes(content));
    script.push(0x68); // OP_ENDIF

    // Standard P2PKH suffix
    script.push(0x76); // OP_DUP
    script.push(0xa9); // OP_HASH160
    script.push(0x14); // push 20 bytes
    script.extend_from_slice(dest_pkh);
    script.push(0x88); // OP_EQUALVERIFY
    script.push(0xac); // OP_CHECKSIG

    script
}

/// Estimate the byte size of a transaction with inscription outputs.
///
/// Inscription outputs are variable-size, so we measure the actual script
/// lengths rather than using the fixed P2PKH_OUTPUT_SIZE constant.
fn calculate_inscription_tx_fee(
    num_inputs: usize,
    output_script_sizes: &[usize],
    fee_rate: f64,
) -> u64 {
    // Each output: 8 (satoshis) + varint(script_len) + script_len
    let output_size: u64 = output_script_sizes
        .iter()
        .map(|&s| {
            let varint_len = if s < 0xfd { 1 } else if s <= 0xffff { 3 } else { 5 };
            8 + varint_len + s as u64
        })
        .sum();

    let size = TX_OVERHEAD + (num_inputs as u64) * P2PKH_INPUT_SIZE + output_size;
    let fee = (size as f64 * fee_rate).ceil() as u64;
    fee.max(1)
}

// ---------------------------------------------------------------------------
// Inscription Tauri commands
// ---------------------------------------------------------------------------

/// Build and sign an inscription transaction (1-sat ordinal with custom content).
///
/// Creates a transaction with:
/// - Input(s): P2PKH funding UTXOs (all signed with `wif`)
/// - Output 0: 1-sat inscription output (custom envelope + P2PKH)
/// - Output 1: P2PKH change output (if any)
#[tauri::command]
pub fn build_inscription_tx(
    wif: String,
    content: Vec<u8>,
    content_type: String,
    dest_address: String,
    funding_utxos: Vec<UtxoInput>,
    fee_rate: f64,
) -> Result<BuiltTransactionResult, String> {
    if funding_utxos.is_empty() {
        return Err("At least one funding UTXO is required".into());
    }
    if content.is_empty() {
        return Err("Inscription content cannot be empty".into());
    }

    let change_address = sdk_address_from_wif(&wif)?;
    let dest_pkh = pkh_from_address(&dest_address)?;

    // Build inscription locking script
    let inscription_script_bytes = build_inscription_script(&content, &content_type, &dest_pkh);
    let inscription_script_hex = hex::encode(&inscription_script_bytes);
    let inscription_script = Script::from_hex(&inscription_script_hex)
        .map_err(|e| format!("Invalid inscription script: {}", e))?;

    // Calculate fee with actual script sizes
    let change_script_size = P2PKH_OUTPUT_SIZE as usize; // 34 bytes for standard P2PKH
    let total_input: u64 = funding_utxos.iter().map(|u| u.satoshis).sum();

    // Preliminary check: will there be change?
    let prelim_change = total_input.saturating_sub(1); // 1 sat for inscription
    let will_have_change = prelim_change > 100;

    let mut output_script_sizes = vec![inscription_script_bytes.len()];
    if will_have_change {
        output_script_sizes.push(change_script_size);
    }

    let fee = calculate_inscription_tx_fee(
        funding_utxos.len(),
        &output_script_sizes,
        fee_rate,
    );

    let change = total_input
        .checked_sub(1) // inscription output = 1 sat
        .and_then(|v| v.checked_sub(fee))
        .ok_or_else(|| format!(
            "Insufficient funds: need 1 sat + {} fee, have {}",
            fee, total_input
        ))?;

    // Build transaction
    let mut tx = SdkTransaction::new();

    for utxo in &funding_utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Failed to add input: {}", e))?;
    }

    // Output 0: 1-sat inscription
    let mut insc_output = TransactionOutput::new();
    insc_output.satoshis = 1;
    insc_output.locking_script = inscription_script;
    tx.add_output(insc_output);

    // Output 1: change
    if change > 0 {
        add_p2pkh_output(&mut tx, &change_address, change)?;
    }

    // Sign all inputs
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
        change_address,
        spent_outpoints: funding_utxos
            .iter()
            .map(|u| SpentOutpoint {
                txid: u.txid.clone(),
                vout: u.vout,
            })
            .collect(),
    })
}

/// Build and sign a BSV-20/21 token transfer transaction with inscription outputs.
///
/// Creates a transaction with:
/// - Token inputs (signed with `token_wif`)
/// - Funding inputs (signed with `funding_wif`)
/// - Output 0: 1-sat transfer inscription to recipient
/// - Output 1 (optional): 1-sat token change inscription back to sender
/// - Output N: BSV change P2PKH to `change_address`
#[tauri::command]
pub fn build_token_transfer_tx(
    token_wif: String,
    token_utxos: Vec<UtxoInput>,
    funding_wif: String,
    funding_utxos: Vec<UtxoInput>,
    recipient: String,
    amount: String,
    ticker: String,
    protocol: String,
    change_address: String,
) -> Result<BuiltTransactionResult, String> {
    if token_utxos.is_empty() {
        return Err("At least one token UTXO is required".into());
    }
    if funding_utxos.is_empty() {
        return Err("At least one funding UTXO is required".into());
    }

    // Parse and validate amount
    let send_amount: u128 = amount
        .parse()
        .map_err(|_| format!("Invalid amount: '{}'", amount))?;
    if send_amount == 0 {
        return Err("Amount must be greater than 0".into());
    }

    // Build transfer inscription content JSON
    let transfer_json = if protocol == "bsv-21" || protocol == "bsv21" {
        format!(
            r#"{{"p":"bsv-21","op":"transfer","id":"{}","amt":"{}"}}"#,
            ticker, amount
        )
    } else {
        format!(
            r#"{{"p":"bsv-20","op":"transfer","tick":"{}","amt":"{}"}}"#,
            ticker, amount
        )
    };

    // Determine content type
    let content_type = if protocol == "bsv-21" || protocol == "bsv21" {
        "application/bsv-21"
    } else {
        "application/bsv-20"
    };

    // Get recipient PKH
    let recipient_pkh = pkh_from_address(&recipient)?;

    // Build transfer inscription script
    let transfer_script_bytes =
        build_inscription_script(transfer_json.as_bytes(), content_type, &recipient_pkh);
    let transfer_script = Script::from_hex(&hex::encode(&transfer_script_bytes))
        .map_err(|e| format!("Invalid transfer inscription script: {}", e))?;

    // Token change handling: the TypeScript caller is responsible for token-level
    // change accounting (selecting the right UTXOs and amounts). This command builds
    // the transfer inscription output and a BSV change output. Future enhancement:
    // accept an optional token_change_amount to produce a second inscription output.

    // Validate change address
    let _ = pkh_from_address(&change_address)?;

    // Calculate input totals
    let total_token_sats: u64 = token_utxos.iter().map(|u| u.satoshis).sum();
    let total_funding_sats: u64 = funding_utxos.iter().map(|u| u.satoshis).sum();
    let total_input = total_token_sats + total_funding_sats;

    // Output 0: 1-sat transfer inscription to recipient
    let total_output_sats: u64 = 1;

    // Calculate fee with actual script sizes
    let mut output_script_sizes = vec![transfer_script_bytes.len()];
    let prelim_change = total_input.saturating_sub(total_output_sats);
    let will_have_change = prelim_change > 100;
    if will_have_change {
        output_script_sizes.push(P2PKH_OUTPUT_SIZE as usize);
    }

    let fee = calculate_inscription_tx_fee(
        token_utxos.len() + funding_utxos.len(),
        &output_script_sizes,
        0.05, // Use default fee rate for token transfers
    );

    let change = total_input
        .checked_sub(total_output_sats)
        .and_then(|v| v.checked_sub(fee))
        .ok_or_else(|| format!(
            "Insufficient funds: need {} sats + {} fee, have {}",
            total_output_sats, fee, total_input
        ))?;

    // Build transaction
    let mut tx = SdkTransaction::new();

    // Token inputs first
    for utxo in &token_utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Failed to add token input: {}", e))?;
    }

    // Funding inputs
    for utxo in &funding_utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Failed to add funding input: {}", e))?;
    }

    // Output 0: Transfer inscription (1 sat)
    let mut transfer_output = TransactionOutput::new();
    transfer_output.satoshis = 1;
    transfer_output.locking_script = transfer_script;
    tx.add_output(transfer_output);

    // Output N: BSV change
    if change > 0 {
        add_p2pkh_output(&mut tx, &change_address, change)?;
    }

    // Sign token inputs with token_wif
    let token_privkey = sdk_privkey_from_wif(&token_wif)?;
    let token_template = p2pkh::unlock(token_privkey, None);
    for i in 0..token_utxos.len() {
        let unlock_script = token_template
            .sign(&tx, i as u32)
            .map_err(|e| format!("Failed to sign token input {}: {}", i, e))?;
        tx.inputs[i].unlocking_script = Some(unlock_script);
    }

    // Sign funding inputs with funding_wif
    let funding_privkey = sdk_privkey_from_wif(&funding_wif)?;
    let funding_template = p2pkh::unlock(funding_privkey, None);
    let funding_start = token_utxos.len();
    for i in 0..funding_utxos.len() {
        let idx = funding_start + i;
        let unlock_script = funding_template
            .sign(&tx, idx as u32)
            .map_err(|e| format!("Failed to sign funding input {}: {}", idx, e))?;
        tx.inputs[idx].unlocking_script = Some(unlock_script);
    }

    // Build spent outpoints
    let mut spent_outpoints: Vec<SpentOutpoint> = token_utxos
        .iter()
        .map(|u| SpentOutpoint {
            txid: u.txid.clone(),
            vout: u.vout,
        })
        .collect();
    spent_outpoints.extend(funding_utxos.iter().map(|u| SpentOutpoint {
        txid: u.txid.clone(),
        vout: u.vout,
    }));

    Ok(BuiltTransactionResult {
        raw_tx: tx.to_hex(),
        txid: tx.tx_id_hex(),
        fee,
        change,
        change_address,
        spent_outpoints,
    })
}

// ---------------------------------------------------------------------------
// Multi-output P2PKH transaction builder
// ---------------------------------------------------------------------------

/// Output descriptor for multi-output transactions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputDescriptor {
    pub address: String,
    pub satoshis: u64,
}

/// Output descriptor for custom-script transactions (BRC-100 createAction).
/// Each output specifies an exact locking script as hex — not limited to P2PKH.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomOutput {
    pub satoshis: u64,
    pub locking_script_hex: String,
}

/// Build and sign a single-key transaction with multiple P2PKH outputs.
///
/// All inputs are signed with the same key. A change output is appended
/// after the specified outputs if there are leftover funds.
#[tauri::command]
pub fn build_multi_output_p2pkh_tx(
    wif: String,
    outputs: Vec<OutputDescriptor>,
    selected_utxos: Vec<UtxoInput>,
    total_input: u64,
    fee_rate: f64,
) -> Result<BuiltTransactionResult, String> {
    if outputs.is_empty() {
        return Err("At least one output is required".into());
    }

    let from_address = sdk_address_from_wif(&wif)?;

    let total_output: u64 = outputs.iter().map(|o| o.satoshis).sum();

    // Calculate fee: outputs count + potential change output
    let prelim_change = total_input.saturating_sub(total_output);
    let will_have_change = prelim_change > 100;
    let num_outputs = outputs.len() + if will_have_change { 1 } else { 0 };
    let fee = calculate_tx_fee(selected_utxos.len(), num_outputs, fee_rate);

    let change = total_input
        .checked_sub(total_output)
        .and_then(|v| v.checked_sub(fee))
        .ok_or_else(|| format!(
            "Insufficient funds: need {} + {} fee, have {}",
            total_output, fee, total_input
        ))?;

    // Build transaction
    let mut tx = SdkTransaction::new();

    for utxo in &selected_utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Failed to add input: {}", e))?;
    }

    // Add all specified outputs
    for out in &outputs {
        add_p2pkh_output(&mut tx, &out.address, out.satoshis)?;
    }

    // Add change output
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

// ---------------------------------------------------------------------------
// Custom-output transaction builder (BRC-100 createAction)
// ---------------------------------------------------------------------------

/// Build and sign a transaction with arbitrary locking scripts.
///
/// Unlike `build_multi_output_p2pkh_tx` which only supports P2PKH outputs,
/// this function accepts raw locking script hex for each output. Used by
/// BRC-100 `createAction` where apps specify custom output scripts.
///
/// All inputs are signed with the same key. A P2PKH change output is appended
/// after the specified outputs if there are leftover funds.
pub fn build_custom_output_tx(
    wif: String,
    outputs: Vec<CustomOutput>,
    selected_utxos: Vec<UtxoInput>,
    total_input: u64,
    fee_rate: f64,
) -> Result<BuiltTransactionResult, String> {
    if outputs.is_empty() {
        return Err("At least one output is required".into());
    }

    let from_address = sdk_address_from_wif(&wif)?;

    // Decode and validate all locking scripts upfront
    let mut decoded_scripts: Vec<Script> = Vec::with_capacity(outputs.len());
    let mut output_script_sizes: Vec<usize> = Vec::with_capacity(outputs.len() + 1);

    for (i, out) in outputs.iter().enumerate() {
        let script = Script::from_hex(&out.locking_script_hex)
            .map_err(|e| format!("Invalid locking script hex at output {}: {}", i, e))?;
        let script_len = out.locking_script_hex.len() / 2; // hex -> bytes
        output_script_sizes.push(script_len);
        decoded_scripts.push(script);
    }

    let total_output: u64 = outputs.iter().map(|o| o.satoshis).sum();

    // Preliminary check: will there be change?
    let prelim_change = total_input.saturating_sub(total_output);
    let will_have_change = prelim_change > 100;
    if will_have_change {
        output_script_sizes.push(P2PKH_OUTPUT_SIZE as usize); // 34 bytes for change
    }

    // Calculate fee with actual script sizes (not fixed P2PKH assumption)
    let fee = calculate_inscription_tx_fee(
        selected_utxos.len(),
        &output_script_sizes,
        fee_rate,
    );

    let change = total_input
        .checked_sub(total_output)
        .and_then(|v| v.checked_sub(fee))
        .ok_or_else(|| format!(
            "Insufficient funds: need {} + {} fee, have {}",
            total_output, fee, total_input
        ))?;

    // Build transaction
    let mut tx = SdkTransaction::new();

    for utxo in &selected_utxos {
        tx.add_input_from(&utxo.txid, utxo.vout, &utxo.script, utxo.satoshis)
            .map_err(|e| format!("Failed to add input: {}", e))?;
    }

    // Add all specified outputs with exact locking scripts
    for (i, script) in decoded_scripts.into_iter().enumerate() {
        let mut output = TransactionOutput::new();
        output.satoshis = outputs[i].satoshis;
        output.locking_script = script;
        tx.add_output(output);
    }

    // Add P2PKH change output
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

    // -----------------------------------------------------------------------
    // Lock transaction tests
    // -----------------------------------------------------------------------

    fn make_test_utxo(txid_char: &str, satoshis: u64) -> UtxoInput {
        UtxoInput {
            txid: txid_char.repeat(64),
            vout: 0,
            satoshis,
            script: "76a914".to_string() + &"00".repeat(20) + "88ac",
        }
    }

    /// Build a simple CLTV timelock script for testing:
    /// <block_height> OP_CHECKLOCKTIMEVERIFY OP_DROP OP_DUP OP_HASH160 <pkh> OP_EQUALVERIFY OP_CHECKSIG
    fn make_test_timelock_script_hex(block_height: u32) -> String {
        let mut script = Vec::new();
        // Push block height as little-endian (use minimal encoding)
        let height_bytes = block_height.to_le_bytes();
        // Find the minimal length needed
        let len = if block_height <= 0x7f {
            1
        } else if block_height <= 0x7fff {
            2
        } else if block_height <= 0x7fffff {
            3
        } else {
            4
        };
        script.push(len as u8); // push N bytes
        script.extend_from_slice(&height_bytes[..len]);
        script.push(0xb1); // OP_CHECKLOCKTIMEVERIFY
        script.push(0x75); // OP_DROP
        script.push(0x76); // OP_DUP
        script.push(0xa9); // OP_HASH160
        script.push(0x14); // push 20 bytes
        script.extend_from_slice(&[0x00; 20]); // placeholder pkh
        script.push(0x88); // OP_EQUALVERIFY
        script.push(0xac); // OP_CHECKSIG
        hex::encode(script)
    }

    #[test]
    fn build_lock_tx_basic() {
        let wif = get_test_wif();
        let address = get_test_address();
        let timelock_hex = make_test_timelock_script_hex(800000);

        let result = build_lock_tx(
            wif,
            vec![make_test_utxo("a", 10000)],
            5000,
            timelock_hex,
            address,
            4900,
            None,
        );

        assert!(result.is_ok(), "build_lock_tx failed: {:?}", result.err());
        let built = result.unwrap();
        assert!(!built.raw_tx.is_empty());
        assert_eq!(built.txid.len(), 64);
    }

    #[test]
    fn build_lock_tx_with_op_return() {
        let wif = get_test_wif();
        let address = get_test_address();
        let timelock_hex = make_test_timelock_script_hex(800000);
        // Simple OP_RETURN: OP_FALSE OP_RETURN <data>
        let op_return_hex = "006a04deadbeef".to_string();

        let result = build_lock_tx(
            wif,
            vec![make_test_utxo("b", 10000)],
            5000,
            timelock_hex,
            address,
            4900,
            Some(op_return_hex),
        );

        assert!(result.is_ok(), "build_lock_tx with OP_RETURN failed: {:?}", result.err());
        let built = result.unwrap();
        assert!(!built.raw_tx.is_empty());

        // Verify OP_RETURN data is in the raw tx
        assert!(built.raw_tx.contains("deadbeef"));
    }

    #[test]
    fn build_lock_tx_no_change() {
        let wif = get_test_wif();
        let address = get_test_address();
        let timelock_hex = make_test_timelock_script_hex(800000);

        let result = build_lock_tx(
            wif,
            vec![make_test_utxo("c", 5000)],
            5000,
            timelock_hex,
            address,
            0, // no change
            None,
        );

        assert!(result.is_ok(), "build_lock_tx no change failed: {:?}", result.err());
    }

    // -----------------------------------------------------------------------
    // Unlock transaction tests
    // -----------------------------------------------------------------------

    #[test]
    fn build_unlock_tx_basic() {
        let wif = get_test_wif();
        let address = get_test_address();
        let locking_script_hex = make_test_timelock_script_hex(800000);

        let result = build_unlock_tx(
            wif,
            "a".repeat(64),
            0,
            10000,
            locking_script_hex,
            800000,
            address,
            9800,
        );

        assert!(result.is_ok(), "build_unlock_tx failed: {:?}", result.err());
        let built = result.unwrap();
        assert!(!built.raw_tx.is_empty());
        assert_eq!(built.txid.len(), 64);

        // Verify nLockTime is set in the raw tx
        let raw_bytes = hex::decode(&built.raw_tx).unwrap();
        let len = raw_bytes.len();
        // Last 4 bytes = nLockTime (little-endian)
        let lock_time_bytes = &raw_bytes[len - 4..];
        let lock_time = u32::from_le_bytes([
            lock_time_bytes[0],
            lock_time_bytes[1],
            lock_time_bytes[2],
            lock_time_bytes[3],
        ]);
        assert_eq!(lock_time, 800000, "nLockTime should be 800000");
    }

    #[test]
    fn build_unlock_tx_sets_sequence() {
        let wif = get_test_wif();
        let address = get_test_address();
        let locking_script_hex = make_test_timelock_script_hex(900000);

        let result = build_unlock_tx(
            wif,
            "b".repeat(64),
            0,
            5000,
            locking_script_hex,
            900000,
            address,
            4800,
        );

        assert!(result.is_ok(), "build_unlock_tx failed: {:?}", result.err());
        let built = result.unwrap();

        // Parse the raw tx back and verify sequence number
        let parsed = SdkTransaction::from_hex(&built.raw_tx).unwrap();
        assert_eq!(parsed.inputs[0].sequence_number, 0xFFFFFFFE);
        assert_eq!(parsed.lock_time, 900000);
    }

    // -----------------------------------------------------------------------
    // Ordinal transfer transaction tests
    // -----------------------------------------------------------------------

    fn get_test_ord_wif() -> String {
        let keys = crate::key_derivation::derive_wallet_keys(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string()
        ).unwrap();
        keys.ord_wif
    }

    #[test]
    fn build_ordinal_transfer_tx_basic() {
        let ord_wif = get_test_ord_wif();
        let funding_wif = get_test_wif();

        let result = build_ordinal_transfer_tx(
            ord_wif,
            UtxoInput {
                txid: "a".repeat(64),
                vout: 0,
                satoshis: 1,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            },
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            funding_wif,
            vec![make_test_utxo("b", 10000)],
            0.001,
        );

        assert!(result.is_ok(), "build_ordinal_transfer_tx failed: {:?}", result.err());
        let built = result.unwrap();

        assert!(!built.raw_tx.is_empty());
        assert_eq!(built.txid.len(), 64);
        assert!(built.fee > 0);
        assert!(built.change > 0);
        // 1 ordinal input + 1 funding input = 2 spent outpoints
        assert_eq!(built.spent_outpoints.len(), 2);
    }

    #[test]
    fn build_ordinal_transfer_tx_insufficient_funds() {
        let ord_wif = get_test_ord_wif();
        let funding_wif = get_test_wif();

        let result = build_ordinal_transfer_tx(
            ord_wif,
            UtxoInput {
                txid: "a".repeat(64),
                vout: 0,
                satoshis: 1,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            },
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            funding_wif,
            vec![make_test_utxo("b", 1)], // only 1 sat — not enough for fee
            0.01,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Insufficient funds"));
    }

    // -----------------------------------------------------------------------
    // Multi-output P2PKH transaction tests
    // -----------------------------------------------------------------------

    #[test]
    fn build_multi_output_p2pkh_tx_basic() {
        let wif = get_test_wif();
        let address = get_test_address();

        let result = build_multi_output_p2pkh_tx(
            wif,
            vec![
                OutputDescriptor {
                    address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
                    satoshis: 1000,
                },
                OutputDescriptor {
                    address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
                    satoshis: 2000,
                },
            ],
            vec![make_test_utxo("a", 20000)],
            20000,
            0.1,
        );

        assert!(result.is_ok(), "build_multi_output_p2pkh_tx failed: {:?}", result.err());
        let built = result.unwrap();

        assert!(!built.raw_tx.is_empty());
        assert_eq!(built.txid.len(), 64);
        assert!(built.fee > 0);
        assert!(built.change > 0);
        assert_eq!(built.change_address, address);
        // fee + change + 3000 = 20000
        assert_eq!(built.fee + built.change + 3000, 20000);
    }

    #[test]
    fn build_multi_output_p2pkh_tx_empty_outputs() {
        let wif = get_test_wif();

        let result = build_multi_output_p2pkh_tx(
            wif,
            vec![], // empty outputs
            vec![make_test_utxo("a", 10000)],
            10000,
            0.1,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("At least one output"));
    }

    #[test]
    fn build_multi_output_p2pkh_tx_insufficient_funds() {
        let wif = get_test_wif();

        let result = build_multi_output_p2pkh_tx(
            wif,
            vec![
                OutputDescriptor {
                    address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
                    satoshis: 50000,
                },
            ],
            vec![make_test_utxo("a", 1000)],
            1000,
            0.1,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Insufficient funds"));
    }

    #[test]
    fn build_multi_output_p2pkh_tx_multiple_inputs() {
        let wif = get_test_wif();

        let result = build_multi_output_p2pkh_tx(
            wif,
            vec![
                OutputDescriptor {
                    address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
                    satoshis: 3000,
                },
            ],
            vec![
                make_test_utxo("a", 2000),
                make_test_utxo("b", 5000),
            ],
            7000,
            0.1,
        );

        assert!(result.is_ok(), "multi-output multi-input failed: {:?}", result.err());
        let built = result.unwrap();
        assert_eq!(built.spent_outpoints.len(), 2);
        assert_eq!(built.fee + built.change + 3000, 7000);
    }

    // -----------------------------------------------------------------------
    // Inscription helper tests
    // -----------------------------------------------------------------------

    #[test]
    fn push_data_bytes_small() {
        // 3 bytes: "ord" → 0x03 followed by the bytes
        let result = push_data_bytes(b"ord");
        assert_eq!(result[0], 3); // length byte
        assert_eq!(&result[1..], b"ord");
    }

    #[test]
    fn push_data_bytes_max_direct() {
        // 0x4b (75) bytes — max for direct push
        let data = vec![0xAB; 0x4b];
        let result = push_data_bytes(&data);
        assert_eq!(result[0], 0x4b);
        assert_eq!(&result[1..], data.as_slice());
    }

    #[test]
    fn push_data_bytes_op_pushdata1() {
        // 0x4c (76) bytes — requires OP_PUSHDATA1
        let data = vec![0xCD; 0x4c];
        let result = push_data_bytes(&data);
        assert_eq!(result[0], 0x4c); // OP_PUSHDATA1
        assert_eq!(result[1], 0x4c); // length = 76
        assert_eq!(&result[2..], data.as_slice());
    }

    #[test]
    fn push_data_bytes_op_pushdata1_max() {
        // 255 bytes — still OP_PUSHDATA1
        let data = vec![0xEF; 255];
        let result = push_data_bytes(&data);
        assert_eq!(result[0], 0x4c); // OP_PUSHDATA1
        assert_eq!(result[1], 255); // length
        assert_eq!(&result[2..], data.as_slice());
    }

    #[test]
    fn push_data_bytes_op_pushdata2() {
        // 256 bytes — requires OP_PUSHDATA2
        let data = vec![0x42; 256];
        let result = push_data_bytes(&data);
        assert_eq!(result[0], 0x4d); // OP_PUSHDATA2
        assert_eq!(result[1], 0x00); // low byte of 256
        assert_eq!(result[2], 0x01); // high byte of 256
        assert_eq!(&result[3..], data.as_slice());
    }

    #[test]
    fn push_data_bytes_empty() {
        let result = push_data_bytes(b"");
        assert_eq!(result, vec![0x00]); // OP_0 for empty data
    }

    #[test]
    fn build_inscription_script_structure() {
        let content = b"test content";
        let content_type = "text/plain";
        let pkh = [0x11u8; 20];

        let script = build_inscription_script(content, content_type, &pkh);

        // Check envelope structure
        assert_eq!(script[0], 0x00, "OP_FALSE");
        assert_eq!(script[1], 0x63, "OP_IF");

        // "ord" push: 0x03 + "ord"
        assert_eq!(script[2], 0x03);
        assert_eq!(&script[3..6], b"ord");

        // OP_1 (content type tag)
        assert_eq!(script[6], 0x51, "OP_1");

        // content type push
        let ct_len = content_type.len();
        assert_eq!(script[7], ct_len as u8);
        assert_eq!(
            &script[8..8 + ct_len],
            content_type.as_bytes()
        );

        // OP_0 (content tag)
        let pos = 8 + ct_len;
        assert_eq!(script[pos], 0x00, "OP_0");

        // content push
        let content_len = content.len();
        assert_eq!(script[pos + 1], content_len as u8);
        assert_eq!(
            &script[pos + 2..pos + 2 + content_len],
            content
        );

        // OP_ENDIF
        let pos = pos + 2 + content_len;
        assert_eq!(script[pos], 0x68, "OP_ENDIF");

        // P2PKH suffix
        assert_eq!(script[pos + 1], 0x76, "OP_DUP");
        assert_eq!(script[pos + 2], 0xa9, "OP_HASH160");
        assert_eq!(script[pos + 3], 0x14, "push 20 bytes");
        assert_eq!(&script[pos + 4..pos + 24], &pkh);
        assert_eq!(script[pos + 24], 0x88, "OP_EQUALVERIFY");
        assert_eq!(script[pos + 25], 0xac, "OP_CHECKSIG");
    }

    #[test]
    fn pkh_from_address_valid() {
        // 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa is a well-known mainnet address
        let pkh = pkh_from_address("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
        assert!(pkh.is_ok(), "pkh_from_address failed: {:?}", pkh.err());
        assert_eq!(pkh.unwrap().len(), 20);
    }

    #[test]
    fn pkh_from_address_invalid() {
        let pkh = pkh_from_address("not_an_address");
        assert!(pkh.is_err());
    }

    // -----------------------------------------------------------------------
    // Inscription transaction tests
    // -----------------------------------------------------------------------

    #[test]
    fn build_inscription_tx_basic() {
        let wif = get_test_wif();

        let result = build_inscription_tx(
            wif,
            b"hello inscription".to_vec(),
            "text/plain".to_string(),
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            vec![make_test_utxo("a", 10000)],
            0.05,
        );

        assert!(result.is_ok(), "build_inscription_tx failed: {:?}", result.err());
        let built = result.unwrap();

        assert!(!built.raw_tx.is_empty());
        assert_eq!(built.txid.len(), 64);
        assert!(built.fee > 0);
        assert!(built.change > 0);
        assert_eq!(built.spent_outpoints.len(), 1);

        // Verify the inscription content is in the raw tx (hex-encoded)
        let content_hex = hex::encode(b"hello inscription");
        assert!(
            built.raw_tx.contains(&content_hex),
            "Raw tx should contain inscription content"
        );

        // Verify "ord" marker is in the raw tx
        let ord_hex = hex::encode(b"ord");
        assert!(
            built.raw_tx.contains(&ord_hex),
            "Raw tx should contain 'ord' marker"
        );
    }

    #[test]
    fn build_inscription_tx_empty_content() {
        let wif = get_test_wif();

        let result = build_inscription_tx(
            wif,
            vec![],
            "text/plain".to_string(),
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            vec![make_test_utxo("a", 10000)],
            0.05,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("content cannot be empty"));
    }

    #[test]
    fn build_inscription_tx_no_utxos() {
        let wif = get_test_wif();

        let result = build_inscription_tx(
            wif,
            b"content".to_vec(),
            "text/plain".to_string(),
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            vec![],
            0.05,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("At least one funding UTXO"));
    }

    #[test]
    fn build_inscription_tx_insufficient_funds() {
        let wif = get_test_wif();

        let result = build_inscription_tx(
            wif,
            b"content".to_vec(),
            "text/plain".to_string(),
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            vec![make_test_utxo("a", 1)], // only 1 sat — not enough for 1 sat output + fee
            0.05,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Insufficient funds"));
    }

    #[test]
    fn build_inscription_tx_bsv20_content() {
        let wif = get_test_wif();
        let content = r#"{"p":"bsv-20","op":"transfer","tick":"TICK","amt":"100"}"#;

        let result = build_inscription_tx(
            wif,
            content.as_bytes().to_vec(),
            "application/bsv-20".to_string(),
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            vec![make_test_utxo("a", 10000)],
            0.05,
        );

        assert!(result.is_ok(), "BSV-20 inscription failed: {:?}", result.err());
        let built = result.unwrap();

        // Verify BSV-20 content type is in the tx
        let ct_hex = hex::encode(b"application/bsv-20");
        assert!(built.raw_tx.contains(&ct_hex));
    }

    // -----------------------------------------------------------------------
    // Token transfer transaction tests
    // -----------------------------------------------------------------------

    #[test]
    fn build_token_transfer_tx_basic() {
        let token_wif = get_test_ord_wif();
        let funding_wif = get_test_wif();
        let funding_address = get_test_address();

        let result = build_token_transfer_tx(
            token_wif,
            vec![UtxoInput {
                txid: "a".repeat(64),
                vout: 0,
                satoshis: 1,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            funding_wif,
            vec![make_test_utxo("b", 10000)],
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            "100".to_string(),
            "TICK".to_string(),
            "bsv-20".to_string(),
            funding_address,
        );

        assert!(result.is_ok(), "build_token_transfer_tx failed: {:?}", result.err());
        let built = result.unwrap();

        assert!(!built.raw_tx.is_empty());
        assert_eq!(built.txid.len(), 64);
        assert!(built.fee > 0);
        assert!(built.change > 0);
        // 1 token input + 1 funding input = 2 spent outpoints
        assert_eq!(built.spent_outpoints.len(), 2);

        // Verify inscription content is present
        let content_hex = hex::encode(b"bsv-20");
        assert!(built.raw_tx.contains(&content_hex));
    }

    #[test]
    fn build_token_transfer_tx_bsv21() {
        let token_wif = get_test_ord_wif();
        let funding_wif = get_test_wif();
        let funding_address = get_test_address();

        let result = build_token_transfer_tx(
            token_wif,
            vec![UtxoInput {
                txid: "a".repeat(64),
                vout: 0,
                satoshis: 1,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            funding_wif,
            vec![make_test_utxo("b", 10000)],
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            "50".to_string(),
            "abc123def456".to_string(), // contract ID for BSV-21
            "bsv-21".to_string(),
            funding_address,
        );

        assert!(result.is_ok(), "BSV-21 token transfer failed: {:?}", result.err());
        let built = result.unwrap();

        // Verify BSV-21 content type is present
        let ct_hex = hex::encode(b"application/bsv-21");
        assert!(built.raw_tx.contains(&ct_hex));
    }

    #[test]
    fn build_token_transfer_tx_no_token_utxos() {
        let funding_wif = get_test_wif();
        let funding_address = get_test_address();

        let result = build_token_transfer_tx(
            "L1secret".to_string(),
            vec![], // no token UTXOs
            funding_wif,
            vec![make_test_utxo("b", 10000)],
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            "100".to_string(),
            "TICK".to_string(),
            "bsv-20".to_string(),
            funding_address,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("At least one token UTXO"));
    }

    #[test]
    fn build_token_transfer_tx_zero_amount() {
        let token_wif = get_test_ord_wif();
        let funding_wif = get_test_wif();
        let funding_address = get_test_address();

        let result = build_token_transfer_tx(
            token_wif,
            vec![make_test_utxo("a", 1)],
            funding_wif,
            vec![make_test_utxo("b", 10000)],
            "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(),
            "0".to_string(),
            "TICK".to_string(),
            "bsv-20".to_string(),
            funding_address,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("greater than 0"));
    }

    #[test]
    fn build_custom_output_tx_single_p2pkh() {
        let wif = get_test_wif();
        let address = get_test_address();

        // Build a standard P2PKH locking script for the destination
        let dest_script = "76a914".to_string() + &"11".repeat(20) + "88ac"; // 25-byte P2PKH

        let result = build_custom_output_tx(
            wif,
            vec![CustomOutput {
                satoshis: 5000,
                locking_script_hex: dest_script,
            }],
            vec![UtxoInput {
                txid: "a".repeat(64),
                vout: 0,
                satoshis: 10000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            10000,
            0.1,
        );

        assert!(result.is_ok(), "build_custom_output_tx failed: {:?}", result.err());
        let built = result.unwrap();
        assert!(!built.raw_tx.is_empty());
        assert_eq!(built.txid.len(), 64);
        assert!(built.fee > 0);
        assert!(built.change > 0);
        assert_eq!(built.change_address, address);
        assert_eq!(built.spent_outpoints.len(), 1);
    }

    #[test]
    fn build_custom_output_tx_multi_mixed_scripts() {
        let wif = get_test_wif();

        // P2PKH output
        let p2pkh_script = "76a914".to_string() + &"22".repeat(20) + "88ac";
        // OP_RETURN output (OP_FALSE OP_RETURN <data>)
        let op_return_script = "006a".to_string() + &"ff".repeat(10);

        let result = build_custom_output_tx(
            wif,
            vec![
                CustomOutput { satoshis: 3000, locking_script_hex: p2pkh_script },
                CustomOutput { satoshis: 0, locking_script_hex: op_return_script },
            ],
            vec![UtxoInput {
                txid: "b".repeat(64),
                vout: 0,
                satoshis: 10000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            10000,
            0.1,
        );

        assert!(result.is_ok(), "multi mixed failed: {:?}", result.err());
        let built = result.unwrap();
        assert!(!built.raw_tx.is_empty());
        assert!(built.fee > 0);
        // Change = 10000 - 3000 - 0 - fee
        assert!(built.change > 0);
    }

    #[test]
    fn build_custom_output_tx_empty_outputs_error() {
        let wif = get_test_wif();

        let result = build_custom_output_tx(
            wif,
            vec![],
            vec![UtxoInput {
                txid: "c".repeat(64),
                vout: 0,
                satoshis: 10000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            10000,
            0.1,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("At least one output"));
    }

    #[test]
    fn build_custom_output_tx_invalid_hex_error() {
        let wif = get_test_wif();

        let result = build_custom_output_tx(
            wif,
            vec![CustomOutput {
                satoshis: 5000,
                locking_script_hex: "ZZZZ_not_hex".to_string(),
            }],
            vec![UtxoInput {
                txid: "d".repeat(64),
                vout: 0,
                satoshis: 10000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            10000,
            0.1,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid locking script hex"));
    }

    #[test]
    fn build_custom_output_tx_insufficient_funds() {
        let wif = get_test_wif();

        let result = build_custom_output_tx(
            wif,
            vec![CustomOutput {
                satoshis: 100000,
                locking_script_hex: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            vec![UtxoInput {
                txid: "e".repeat(64),
                vout: 0,
                satoshis: 1000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            1000,
            0.1,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Insufficient funds"));
    }

    #[test]
    fn build_custom_output_tx_no_change() {
        let wif = get_test_wif();

        // Use an amount that leaves very little for change (less than fee threshold)
        let script = "76a914".to_string() + &"00".repeat(20) + "88ac";
        let result = build_custom_output_tx(
            wif,
            vec![CustomOutput {
                satoshis: 9950,
                locking_script_hex: script,
            }],
            vec![UtxoInput {
                txid: "f".repeat(64),
                vout: 0,
                satoshis: 10000,
                script: "76a914".to_string() + &"00".repeat(20) + "88ac",
            }],
            10000,
            0.1,
        );

        assert!(result.is_ok(), "no-change failed: {:?}", result.err());
        let built = result.unwrap();
        assert!(built.fee > 0);
    }
}
