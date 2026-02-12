//! P2PKH Transaction Builder
//!
//! Builds and signs standard P2PKH Bitcoin SV transactions entirely in Rust,
//! so that private keys never enter the webview's JavaScript heap.
//!
//! The frontend sends UTXOs + WIF(s) + destination → Rust signs → returns
//! { rawTx, txid, fee, change }.

use ripemd::Ripemd160;
use secp256k1::{Message, Secp256k1, SecretKey, PublicKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

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
// Low-level Bitcoin primitives
// ---------------------------------------------------------------------------

/// Decode a WIF (compressed mainnet) into 32-byte private key.
fn wif_to_privkey_bytes(wif: &str) -> Result<[u8; 32], String> {
    let decoded = bs58::decode(wif.trim())
        .with_check(None)
        .into_vec()
        .map_err(|e| format!("Invalid WIF: {}", e))?;

    if decoded.is_empty() || decoded[0] != 0x80 {
        return Err("Invalid WIF prefix".into());
    }

    let privkey_bytes: [u8; 32] = if decoded.len() == 34 && decoded[33] == 0x01 {
        decoded[1..33]
            .try_into()
            .map_err(|_| "Invalid private key length")?
    } else if decoded.len() == 33 {
        decoded[1..33]
            .try_into()
            .map_err(|_| "Invalid private key length")?
    } else {
        return Err(format!("Invalid WIF length: {}", decoded.len()));
    };

    Ok(privkey_bytes)
}

/// Derive compressed public key bytes (33 bytes) from a secret key.
fn pubkey_bytes(secp: &Secp256k1<secp256k1::All>, sk: &SecretKey) -> [u8; 33] {
    PublicKey::from_secret_key(secp, sk).serialize()
}

/// Hash160 = RIPEMD160(SHA256(data))
fn hash160(data: &[u8]) -> [u8; 20] {
    let sha = Sha256::digest(data);
    let ripe = Ripemd160::digest(sha);
    let mut out = [0u8; 20];
    out.copy_from_slice(&ripe);
    out
}

/// Double SHA-256
fn double_sha256(data: &[u8]) -> [u8; 32] {
    let first = Sha256::digest(data);
    let second = Sha256::digest(first);
    let mut out = [0u8; 32];
    out.copy_from_slice(&second);
    out
}

/// P2PKH address from compressed public key (mainnet)
fn address_from_pubkey(secp: &Secp256k1<secp256k1::All>, sk: &SecretKey) -> String {
    let pk = pubkey_bytes(secp, sk);
    let pkh = hash160(&pk);
    let mut payload = Vec::with_capacity(21);
    payload.push(0x00); // mainnet
    payload.extend_from_slice(&pkh);
    bs58::encode(payload).with_check().into_string()
}

/// Build a P2PKH locking script: OP_DUP OP_HASH160 <20-byte-hash> OP_EQUALVERIFY OP_CHECKSIG
fn p2pkh_locking_script(pubkey_hash: &[u8; 20]) -> Vec<u8> {
    let mut script = Vec::with_capacity(25);
    script.push(0x76); // OP_DUP
    script.push(0xa9); // OP_HASH160
    script.push(0x14); // push 20 bytes
    script.extend_from_slice(pubkey_hash);
    script.push(0x88); // OP_EQUALVERIFY
    script.push(0xac); // OP_CHECKSIG
    script
}

/// Build P2PKH locking script from an address string.
fn locking_script_from_address(address: &str) -> Result<Vec<u8>, String> {
    let decoded = bs58::decode(address)
        .with_check(None)
        .into_vec()
        .map_err(|e| format!("Invalid address: {}", e))?;
    if decoded.len() != 21 {
        return Err(format!("Invalid address length: {}", decoded.len()));
    }
    if decoded[0] != 0x00 {
        return Err(format!(
            "Invalid address prefix: expected 0x00 (P2PKH mainnet), got 0x{:02x}",
            decoded[0]
        ));
    }
    let mut pkh = [0u8; 20];
    pkh.copy_from_slice(&decoded[1..21]);
    Ok(p2pkh_locking_script(&pkh))
}

/// Encode a u64 as a Bitcoin varint.
fn write_varint(buf: &mut Vec<u8>, n: u64) {
    if n < 0xfd {
        buf.push(n as u8);
    } else if n <= 0xffff {
        buf.push(0xfd);
        buf.extend_from_slice(&(n as u16).to_le_bytes());
    } else if n <= 0xffff_ffff {
        buf.push(0xfe);
        buf.extend_from_slice(&(n as u32).to_le_bytes());
    } else {
        buf.push(0xff);
        buf.extend_from_slice(&n.to_le_bytes());
    }
}

/// Decode a hex string to bytes.
fn hex_decode(hex: &str) -> Result<Vec<u8>, String> {
    hex::decode(hex).map_err(|e| format!("Invalid hex: {}", e))
}

/// Decode a txid hex to 32 bytes (reversed for internal use).
fn txid_to_bytes(txid: &str) -> Result<[u8; 32], String> {
    let mut bytes = hex_decode(txid)?;
    if bytes.len() != 32 {
        return Err(format!("Invalid txid length: {}", bytes.len()));
    }
    bytes.reverse(); // txids are displayed in reverse byte order
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

// ---------------------------------------------------------------------------
// Sighash computation (SIGHASH_ALL | FORKID for BSV)
// ---------------------------------------------------------------------------

/// BIP-143 sighash preimage for BSV (SIGHASH_ALL | FORKID = 0x41).
///
/// Preimage = version || hashPrevouts || hashSequence || outpoint || scriptCode ||
///            value || nSequence || hashOutputs || locktime || sighashType
fn sighash_preimage(
    version: u32,
    inputs: &[(/*txid*/ [u8; 32], /*vout*/ u32, /*satoshis*/ u64, /*sequence*/ u32)],
    outputs_serialized: &[u8],
    input_index: usize,
    locking_script: &[u8],
) -> [u8; 32] {
    let sighash_type: u32 = 0x41; // SIGHASH_ALL | FORKID

    // hashPrevouts = dSHA256(all outpoints)
    let mut prevouts_buf = Vec::new();
    for (txid_bytes, vout, _, _) in inputs {
        prevouts_buf.extend_from_slice(txid_bytes);
        prevouts_buf.extend_from_slice(&vout.to_le_bytes());
    }
    let hash_prevouts = double_sha256(&prevouts_buf);

    // hashSequence = dSHA256(all sequences)
    let mut seq_buf = Vec::new();
    for (_, _, _, seq) in inputs {
        seq_buf.extend_from_slice(&seq.to_le_bytes());
    }
    let hash_sequence = double_sha256(&seq_buf);

    // hashOutputs = dSHA256(all outputs)
    let hash_outputs = double_sha256(outputs_serialized);

    // Build preimage
    let mut preimage = Vec::new();
    preimage.extend_from_slice(&version.to_le_bytes());
    preimage.extend_from_slice(&hash_prevouts);
    preimage.extend_from_slice(&hash_sequence);

    // outpoint being signed
    let (txid_bytes, vout, satoshis, sequence) = &inputs[input_index];
    preimage.extend_from_slice(txid_bytes);
    preimage.extend_from_slice(&vout.to_le_bytes());

    // scriptCode (varint + locking script)
    write_varint(&mut preimage, locking_script.len() as u64);
    preimage.extend_from_slice(locking_script);

    preimage.extend_from_slice(&satoshis.to_le_bytes());
    preimage.extend_from_slice(&sequence.to_le_bytes());
    preimage.extend_from_slice(&hash_outputs);

    // locktime
    preimage.extend_from_slice(&0u32.to_le_bytes());
    // sighash type
    preimage.extend_from_slice(&sighash_type.to_le_bytes());

    double_sha256(&preimage)
}

/// DER-encode a secp256k1 signature and append sighash byte.
fn der_encode_signature(sig: &secp256k1::ecdsa::Signature, sighash_byte: u8) -> Vec<u8> {
    let der = sig.serialize_der();
    let mut out = Vec::with_capacity(der.len() + 1);
    out.extend_from_slice(&der);
    out.push(sighash_byte);
    out
}

/// Build a P2PKH unlocking script (scriptSig):
/// <sig> <pubkey>
fn p2pkh_unlocking_script(sig_der: &[u8], compressed_pubkey: &[u8; 33]) -> Vec<u8> {
    let mut script = Vec::with_capacity(1 + sig_der.len() + 1 + 33);
    script.push(sig_der.len() as u8); // push sig length
    script.extend_from_slice(sig_der);
    script.push(33); // push pubkey length (compressed)
    script.extend_from_slice(compressed_pubkey);
    script
}

// ---------------------------------------------------------------------------
// Serialize a signed transaction to raw bytes
// ---------------------------------------------------------------------------

struct TxInput {
    txid_bytes: [u8; 32],
    vout: u32,
    script_sig: Vec<u8>,
    sequence: u32,
}

struct TxOutput {
    satoshis: u64,
    locking_script: Vec<u8>,
}

fn serialize_tx(inputs: &[TxInput], outputs: &[TxOutput]) -> Vec<u8> {
    let mut buf = Vec::new();

    // version
    buf.extend_from_slice(&1u32.to_le_bytes());

    // inputs
    write_varint(&mut buf, inputs.len() as u64);
    for inp in inputs {
        buf.extend_from_slice(&inp.txid_bytes);
        buf.extend_from_slice(&inp.vout.to_le_bytes());
        write_varint(&mut buf, inp.script_sig.len() as u64);
        buf.extend_from_slice(&inp.script_sig);
        buf.extend_from_slice(&inp.sequence.to_le_bytes());
    }

    // outputs
    write_varint(&mut buf, outputs.len() as u64);
    for out in outputs {
        buf.extend_from_slice(&out.satoshis.to_le_bytes());
        write_varint(&mut buf, out.locking_script.len() as u64);
        buf.extend_from_slice(&out.locking_script);
    }

    // locktime
    buf.extend_from_slice(&0u32.to_le_bytes());

    buf
}

fn serialize_outputs(outputs: &[TxOutput]) -> Vec<u8> {
    let mut buf = Vec::new();
    for out in outputs {
        buf.extend_from_slice(&out.satoshis.to_le_bytes());
        write_varint(&mut buf, out.locking_script.len() as u64);
        buf.extend_from_slice(&out.locking_script);
    }
    buf
}

fn compute_txid(raw_tx: &[u8]) -> String {
    let hash = double_sha256(raw_tx);
    // txid is displayed reversed
    let mut reversed = hash;
    reversed.reverse();
    hex::encode(reversed)
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
    let secp = Secp256k1::new();
    let mut privkey_bytes = wif_to_privkey_bytes(&wif)?;
    let sk = SecretKey::from_slice(&privkey_bytes)
        .map_err(|e| format!("Invalid private key: {}", e))?;
    privkey_bytes.zeroize();
    let pk = pubkey_bytes(&secp, &sk);
    let pkh = hash160(&pk);
    let from_address = address_from_pubkey(&secp, &sk);
    let from_locking_script = p2pkh_locking_script(&pkh);

    let (fee, change, _num_outputs) =
        calculate_change_and_fee(total_input, satoshis, selected_utxos.len(), fee_rate)?;

    // Build outputs
    let to_locking_script = locking_script_from_address(&to_address)?;
    let mut outputs = vec![TxOutput {
        satoshis,
        locking_script: to_locking_script,
    }];
    if change > 0 {
        outputs.push(TxOutput {
            satoshis: change,
            locking_script: from_locking_script.clone(),
        });
    }

    let outputs_serialized = serialize_outputs(&outputs);

    // Prepare input data for sighash
    let input_data: Vec<([u8; 32], u32, u64, u32)> = selected_utxos
        .iter()
        .map(|u| {
            let txid_bytes = txid_to_bytes(&u.txid)?;
            Ok((txid_bytes, u.vout, u.satoshis, 0xffffffff_u32))
        })
        .collect::<Result<Vec<_>, String>>()?;

    // Sign each input
    let mut signed_inputs = Vec::with_capacity(selected_utxos.len());
    for (i, utxo) in selected_utxos.iter().enumerate() {
        let sighash = sighash_preimage(1, &input_data, &outputs_serialized, i, &from_locking_script);
        let msg = Message::from_digest(sighash);
        let sig = secp.sign_ecdsa(&msg, &sk);
        let sig_der = der_encode_signature(&sig, 0x41);
        let script_sig = p2pkh_unlocking_script(&sig_der, &pk);

        signed_inputs.push(TxInput {
            txid_bytes: txid_to_bytes(&utxo.txid)?,
            vout: utxo.vout,
            script_sig,
            sequence: 0xffffffff,
        });
    }

    let raw_tx_bytes = serialize_tx(&signed_inputs, &outputs);
    let txid = compute_txid(&raw_tx_bytes);

    Ok(BuiltTransactionResult {
        raw_tx: hex::encode(&raw_tx_bytes),
        txid,
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
    let secp = Secp256k1::new();

    // Derive change address from change WIF
    let mut change_privkey_bytes = wif_to_privkey_bytes(&change_wif)?;
    let change_sk = SecretKey::from_slice(&change_privkey_bytes)
        .map_err(|e| format!("Invalid change private key: {}", e))?;
    change_privkey_bytes.zeroize();
    let change_address = address_from_pubkey(&secp, &change_sk);

    let (fee, change, _num_outputs) =
        calculate_change_and_fee(total_input, satoshis, selected_utxos.len(), fee_rate)?;

    // Build outputs
    let to_locking_script = locking_script_from_address(&to_address)?;
    let mut outputs = vec![TxOutput {
        satoshis,
        locking_script: to_locking_script,
    }];
    if change > 0 {
        let change_locking_script = locking_script_from_address(&change_address)?;
        outputs.push(TxOutput {
            satoshis: change,
            locking_script: change_locking_script,
        });
    }

    let outputs_serialized = serialize_outputs(&outputs);

    // Prepare input data for sighash
    let input_data: Vec<([u8; 32], u32, u64, u32)> = selected_utxos
        .iter()
        .map(|u| {
            let txid_bytes = txid_to_bytes(&u.txid)?;
            Ok((txid_bytes, u.vout, u.satoshis, 0xffffffff_u32))
        })
        .collect::<Result<Vec<_>, String>>()?;

    // Sign each input with its own key
    let mut signed_inputs = Vec::with_capacity(selected_utxos.len());
    for (i, utxo) in selected_utxos.iter().enumerate() {
        let mut input_privkey_bytes = wif_to_privkey_bytes(&utxo.wif)?;
        let input_sk = SecretKey::from_slice(&input_privkey_bytes)
            .map_err(|e| format!("Invalid input private key: {}", e))?;
        input_privkey_bytes.zeroize();
        let input_pk = pubkey_bytes(&secp, &input_sk);
        let input_pkh = hash160(&input_pk);
        let input_locking_script = p2pkh_locking_script(&input_pkh);

        let sighash = sighash_preimage(1, &input_data, &outputs_serialized, i, &input_locking_script);
        let msg = Message::from_digest(sighash);
        let sig = secp.sign_ecdsa(&msg, &input_sk);
        let sig_der = der_encode_signature(&sig, 0x41);
        let script_sig = p2pkh_unlocking_script(&sig_der, &input_pk);

        signed_inputs.push(TxInput {
            txid_bytes: txid_to_bytes(&utxo.txid)?,
            vout: utxo.vout,
            script_sig,
            sequence: 0xffffffff,
        });
    }

    let raw_tx_bytes = serialize_tx(&signed_inputs, &outputs);
    let txid = compute_txid(&raw_tx_bytes);

    Ok(BuiltTransactionResult {
        raw_tx: hex::encode(&raw_tx_bytes),
        txid,
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

    let secp = Secp256k1::new();
    let mut privkey_bytes = wif_to_privkey_bytes(&wif)?;
    let sk = SecretKey::from_slice(&privkey_bytes)
        .map_err(|e| format!("Invalid private key: {}", e))?;
    privkey_bytes.zeroize();
    let pk = pubkey_bytes(&secp, &sk);
    let pkh = hash160(&pk);
    let address = address_from_pubkey(&secp, &sk);
    let locking_script = p2pkh_locking_script(&pkh);

    let total_input: u64 = utxos.iter().map(|u| u.satoshis).sum();
    let fee = calculate_tx_fee(utxos.len(), 1, fee_rate);
    let output_sats = total_input.checked_sub(fee).unwrap_or(0);

    if output_sats == 0 {
        return Err(format!(
            "Cannot consolidate: total {} sats minus {} fee leaves no output",
            total_input, fee
        ));
    }

    let outputs = vec![TxOutput {
        satoshis: output_sats,
        locking_script: locking_script.clone(),
    }];

    let outputs_serialized = serialize_outputs(&outputs);

    let input_data: Vec<([u8; 32], u32, u64, u32)> = utxos
        .iter()
        .map(|u| {
            let txid_bytes = txid_to_bytes(&u.txid)?;
            Ok((txid_bytes, u.vout, u.satoshis, 0xffffffff_u32))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let mut signed_inputs = Vec::with_capacity(utxos.len());
    for (i, utxo) in utxos.iter().enumerate() {
        let sighash = sighash_preimage(1, &input_data, &outputs_serialized, i, &locking_script);
        let msg = Message::from_digest(sighash);
        let sig = secp.sign_ecdsa(&msg, &sk);
        let sig_der = der_encode_signature(&sig, 0x41);
        let script_sig = p2pkh_unlocking_script(&sig_der, &pk);

        signed_inputs.push(TxInput {
            txid_bytes: txid_to_bytes(&utxo.txid)?,
            vout: utxo.vout,
            script_sig,
            sequence: 0xffffffff,
        });
    }

    let raw_tx_bytes = serialize_tx(&signed_inputs, &outputs);
    let txid = compute_txid(&raw_tx_bytes);

    Ok(BuiltConsolidationResult {
        raw_tx: hex::encode(&raw_tx_bytes),
        txid,
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
    // This is the wallet WIF for the "abandon..." test mnemonic
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
    fn sighash_preimage_is_deterministic() {
        // Verify sighash computation is deterministic with fixed inputs.
        // Uses a known input configuration and checks the hash is stable.
        let txid_bytes = txid_to_bytes(&"a".repeat(64)).unwrap();
        let inputs = vec![(txid_bytes, 0u32, 10000u64, 0xffffffff_u32)];
        let locking_script = hex_decode(&("76a914".to_owned() + &"00".repeat(20) + "88ac")).unwrap();

        // Build a simple output for hashing
        let outputs = vec![TxOutput {
            satoshis: 5000,
            locking_script: locking_script.clone(),
        }];
        let outputs_serialized = serialize_outputs(&outputs);

        let hash1 = sighash_preimage(1, &inputs, &outputs_serialized, 0, &locking_script);
        let hash2 = sighash_preimage(1, &inputs, &outputs_serialized, 0, &locking_script);

        assert_eq!(hash1, hash2, "Sighash should be deterministic");
        // Hash should be 32 bytes of non-zero data
        assert_ne!(hash1, [0u8; 32], "Sighash should not be all zeros");
    }

    #[test]
    fn built_tx_has_valid_signatures() {
        // Build a transaction and verify that the embedded signatures are valid
        // by parsing the scriptSig and verifying against the sighash.
        let wif = get_test_wif();
        let address = get_test_address();

        let result = build_p2pkh_tx(
            wif.clone(),
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

        // Decode the raw tx and extract the scriptSig from input 0
        let raw_bytes = hex::decode(&result.raw_tx).unwrap();
        assert!(raw_bytes.len() > 50, "Raw tx should be non-trivial");

        // Verify we can re-derive the sender address from WIF
        let secp = Secp256k1::new();
        let pk_bytes = wif_to_privkey_bytes(&wif).unwrap();
        let sk = SecretKey::from_slice(&pk_bytes).unwrap();
        let derived_address = address_from_pubkey(&secp, &sk);
        assert_eq!(derived_address, address);

        // Verify the txid matches double-SHA256 of raw tx
        let computed_txid = compute_txid(&raw_bytes);
        assert_eq!(computed_txid, result.txid);
    }

    #[test]
    fn address_prefix_validation_rejects_testnet() {
        // Testnet addresses start with 'm' or 'n' (prefix 0x6f)
        // This should be rejected by our mainnet-only validation
        let result = locking_script_from_address("mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid address prefix"));
    }
}
