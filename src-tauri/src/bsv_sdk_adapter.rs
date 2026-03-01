//! BSV SDK Adapter Layer
//!
//! Wraps `bsv-sdk-rust` types behind the same API signatures used by
//! `transaction.rs`, `key_derivation.rs`, and `brc100_signing.rs`.
//!
//! Phase 1: Adapter + byte-identical comparison tests.
//! Phase 2: Replace existing internal functions with these wrappers.

use bsv_sdk::primitives::ec::{PrivateKey as SdkPrivateKey, PublicKey as SdkPublicKey};
use bsv_sdk::primitives::hash;
use bsv_sdk::script::address::Address;
use bsv_sdk::transaction::template::p2pkh;
use bsv_sdk::transaction::template::UnlockingScriptTemplate;
use bsv_sdk::transaction::{Transaction as SdkTransaction, TransactionOutput};

// ---------------------------------------------------------------------------
// Primitives — drop-in replacements for hand-rolled crypto helpers
// ---------------------------------------------------------------------------

/// Hash160 = RIPEMD160(SHA256(data)) via SDK
pub fn sdk_hash160(data: &[u8]) -> [u8; 20] {
    hash::hash160(data)
}

/// Double SHA-256 via SDK
pub fn sdk_double_sha256(data: &[u8]) -> [u8; 32] {
    hash::sha256d(data)
}

/// SHA-256 via SDK
pub fn sdk_sha256(data: &[u8]) -> [u8; 32] {
    hash::sha256(data)
}

/// Parse a WIF string into an SDK PrivateKey
pub fn sdk_privkey_from_wif(wif: &str) -> Result<SdkPrivateKey, String> {
    SdkPrivateKey::from_wif(wif.trim()).map_err(|e| format!("SDK WIF error: {}", e))
}

/// Get 32-byte raw private key from WIF
pub fn sdk_wif_to_bytes(wif: &str) -> Result<[u8; 32], String> {
    let pk = sdk_privkey_from_wif(wif)?;
    Ok(pk.to_bytes())
}

/// Derive compressed public key bytes (33 bytes) from WIF
pub fn sdk_pubkey_bytes_from_wif(wif: &str) -> Result<[u8; 33], String> {
    let pk = sdk_privkey_from_wif(wif)?;
    Ok(pk.pub_key().to_compressed())
}

/// Derive P2PKH address from WIF (mainnet)
pub fn sdk_address_from_wif(wif: &str) -> Result<String, String> {
    let pk = sdk_privkey_from_wif(wif)?;
    Ok(pk.pub_key().to_address())
}

/// Derive compressed public key hex from WIF
pub fn sdk_pubkey_hex_from_wif(wif: &str) -> Result<String, String> {
    let pk = sdk_privkey_from_wif(wif)?;
    Ok(pk.pub_key().to_hex())
}

/// Convert raw 32-byte privkey to WIF (mainnet compressed)
pub fn sdk_privkey_to_wif(privkey_bytes: &[u8; 32]) -> Result<String, String> {
    let pk = SdkPrivateKey::from_bytes(privkey_bytes)
        .map_err(|e| format!("SDK privkey error: {}", e))?;
    Ok(pk.to_wif())
}

/// Build P2PKH locking script from address string
pub fn sdk_p2pkh_locking_script(address: &str) -> Result<Vec<u8>, String> {
    let addr = Address::from_string(address).map_err(|e| format!("SDK address error: {}", e))?;
    let script =
        p2pkh::lock(&addr).map_err(|e| format!("SDK P2PKH lock error: {}", e))?;
    Ok(script.to_bytes().to_vec())
}

/// Sign a SHA-256 hash with a private key (returns DER-encoded signature)
pub fn sdk_sign_hash(wif: &str, hash: &[u8; 32]) -> Result<Vec<u8>, String> {
    let pk = sdk_privkey_from_wif(wif)?;
    let sig = pk
        .sign(hash)
        .map_err(|e| format!("SDK sign error: {}", e))?;
    Ok(sig.to_der())
}

/// Verify a DER-encoded signature against a hash and public key hex
pub fn sdk_verify_signature(
    pubkey_hex: &str,
    hash: &[u8; 32],
    sig_der: &[u8],
) -> Result<bool, String> {
    let pubkey =
        SdkPublicKey::from_hex(pubkey_hex).map_err(|e| format!("SDK pubkey error: {}", e))?;
    let sig = bsv_sdk::primitives::ec::Signature::from_der(sig_der)
        .map_err(|e| format!("SDK sig error: {}", e))?;
    Ok(pubkey.verify(hash, &sig))
}

/// Derive a child private key using BRC-42 protocol.
///
/// Implements: ECDH(receiver_priv, sender_pub) → HMAC-SHA256 → scalar addition.
/// Returns (child_wif, child_address, child_pubkey_hex).
pub fn sdk_derive_child_key(
    wif: &str,
    sender_pubkey_hex: &str,
    invoice_number: &str,
) -> Result<(String, String, String), String> {
    let privkey = sdk_privkey_from_wif(wif)?;
    let sender_pubkey = SdkPublicKey::from_hex(sender_pubkey_hex)
        .map_err(|e| format!("SDK pubkey error: {}", e))?;

    let child_privkey = privkey
        .derive_child(&sender_pubkey, invoice_number)
        .map_err(|e| format!("BRC-42 derive_child error: {}", e))?;

    let child_wif = child_privkey.to_wif();
    let child_address = child_privkey.pub_key().to_address();
    let child_pubkey_hex = child_privkey.pub_key().to_hex();

    Ok((child_wif, child_address, child_pubkey_hex))
}

/// Derive a child public key using BRC-42 protocol (no private key output).
///
/// Used when we only need the derived address, not the private key.
/// Returns (child_address, child_pubkey_hex).
pub fn sdk_derive_child_pubkey(
    privkey_wif: &str,
    target_pubkey_hex: &str,
    invoice_number: &str,
) -> Result<(String, String), String> {
    let privkey = sdk_privkey_from_wif(privkey_wif)?;
    let target_pubkey = SdkPublicKey::from_hex(target_pubkey_hex)
        .map_err(|e| format!("SDK pubkey error: {}", e))?;

    let child_pubkey = target_pubkey
        .derive_child(&privkey, invoice_number)
        .map_err(|e| format!("BRC-42 derive_child pubkey error: {}", e))?;

    let child_address = child_pubkey.to_address();
    let child_pubkey_hex = child_pubkey.to_hex();

    Ok((child_address, child_pubkey_hex))
}

/// Convert a compressed public key hex to a P2PKH address.
pub fn sdk_pubkey_to_address(pubkey_hex: &str) -> Result<String, String> {
    let pubkey = SdkPublicKey::from_hex(pubkey_hex)
        .map_err(|e| format!("SDK pubkey error: {}", e))?;
    Ok(pubkey.to_address())
}

/// Validate a BSV address (Base58Check checksum + prefix check).
pub fn sdk_validate_address(address: &str) -> bool {
    Address::from_string(address).is_ok()
}

/// Compute ECDH shared key: SHA256(compress(privkey_scalar * pubkey_point)).
///
/// Uses secp256k1 crate internally for EC point multiplication (transitional —
/// will migrate to k256 or SDK native ECDH when secp256k1 is removed in Phase 2.4).
pub fn sdk_ecdh_shared_key(wif: &str, pubkey_hex: &str) -> Result<[u8; 32], String> {
    let privkey = sdk_privkey_from_wif(wif)?;
    let pubkey = SdkPublicKey::from_hex(pubkey_hex)
        .map_err(|e| format!("SDK pubkey error: {}", e))?;

    let privkey_bytes = privkey.to_bytes();
    let pubkey_bytes = pubkey.to_compressed();

    // EC point multiplication via secp256k1
    let secp = secp256k1::Secp256k1::new();
    let sk = secp256k1::SecretKey::from_slice(&privkey_bytes)
        .map_err(|e| format!("ECDH SK error: {}", e))?;
    let pk = secp256k1::PublicKey::from_slice(&pubkey_bytes)
        .map_err(|e| format!("ECDH PK error: {}", e))?;

    let shared_point = pk
        .mul_tweak(&secp, &secp256k1::Scalar::from(sk))
        .map_err(|e| format!("ECDH multiplication failed: {}", e))?;

    let compressed = shared_point.serialize();
    Ok(hash::sha256(&compressed))
}

/// Build a complete P2PKH transaction using the SDK's Transaction builder.
///
/// Returns (raw_tx_hex, txid_hex).
pub fn sdk_build_p2pkh_tx(
    wif: &str,
    utxos: &[(String, u32, u64, String)], // (txid_hex, vout, satoshis, locking_script_hex)
    outputs: &[(String, u64)],            // (address, satoshis)
) -> Result<(String, String), String> {
    let privkey = sdk_privkey_from_wif(wif)?;

    let mut tx = SdkTransaction::new();

    // Add inputs with source output info for sighash
    for (txid_hex, vout, satoshis, script_hex) in utxos {
        tx.add_input_from(txid_hex, *vout, script_hex, *satoshis)
            .map_err(|e| format!("SDK add_input error: {}", e))?;
    }

    // Add outputs
    for (address, sats) in outputs {
        let addr =
            Address::from_string(address).map_err(|e| format!("SDK address error: {}", e))?;
        let locking_script =
            p2pkh::lock(&addr).map_err(|e| format!("SDK P2PKH lock error: {}", e))?;
        let mut output = TransactionOutput::new();
        output.satoshis = *sats;
        output.locking_script = locking_script;
        tx.add_output(output);
    }

    // Sign each input with P2PKH template
    let template = p2pkh::unlock(privkey, None); // defaults to SIGHASH_ALL_FORKID (0x41)
    for i in 0..tx.input_count() {
        let unlock_script = template
            .sign(&tx, i as u32)
            .map_err(|e| format!("SDK sign input {} error: {}", i, e))?;
        tx.inputs[i].unlocking_script = Some(unlock_script);
    }

    let raw_hex = tx.to_hex();
    let txid = tx.tx_id_hex();

    Ok((raw_hex, txid))
}

// ---------------------------------------------------------------------------
// Tests — byte-identical comparison between existing code and SDK
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // Known test WIF (from existing test suite — "abandon" mnemonic derivative)
    // This is the same WIF used in transaction.rs tests
    fn test_wif() -> String {
        // Derive from "abandon" mnemonic using BIP-44 path m/44'/236'/0'/1/0
        // We'll use a known WIF for deterministic testing
        let mnemonic_str =
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let mn: bip39::Mnemonic = mnemonic_str.parse().unwrap();
        let seed = mn.to_seed("");
        let master = bip32::XPrv::new(seed).unwrap();
        // m/44'/236'/0'/1/0
        let child = master
            .derive_child(bip32::ChildNumber::new(44, true).unwrap()).unwrap()
            .derive_child(bip32::ChildNumber::new(236, true).unwrap()).unwrap()
            .derive_child(bip32::ChildNumber::new(0, true).unwrap()).unwrap()
            .derive_child(bip32::ChildNumber::new(1, false).unwrap()).unwrap()
            .derive_child(bip32::ChildNumber::new(0, false).unwrap());
        let privkey_bytes: [u8; 32] = child.unwrap().to_bytes().into();
        // Hand-compute WIF
        let mut payload = Vec::with_capacity(34);
        payload.push(0x80);
        payload.extend_from_slice(&privkey_bytes);
        payload.push(0x01);
        bs58::encode(payload).with_check().into_string()
    }

    // -----------------------------------------------------------------------
    // Hash comparison tests
    // -----------------------------------------------------------------------

    #[test]
    fn hash160_matches_existing() {
        // Compare SDK hash160 with existing implementation
        use ripemd::Ripemd160;
        use sha2::{Digest, Sha256};

        let data = b"test data for hash comparison";

        // Existing implementation
        let sha = Sha256::digest(data);
        let ripe = Ripemd160::digest(sha);
        let mut existing = [0u8; 20];
        existing.copy_from_slice(&ripe);

        // SDK implementation
        let sdk_result = sdk_hash160(data);

        assert_eq!(existing, sdk_result, "hash160 must be byte-identical");
    }

    #[test]
    fn double_sha256_matches_existing() {
        use sha2::{Digest, Sha256};

        let data = b"test data for double sha256";

        // Existing
        let first = Sha256::digest(data);
        let second = Sha256::digest(first);
        let mut existing = [0u8; 32];
        existing.copy_from_slice(&second);

        // SDK
        let sdk_result = sdk_double_sha256(data);

        assert_eq!(existing, sdk_result, "double_sha256 must be byte-identical");
    }

    #[test]
    fn sha256_matches_existing() {
        use sha2::{Digest, Sha256};

        let data = b"test data for sha256";

        let mut existing = [0u8; 32];
        existing.copy_from_slice(&Sha256::digest(data));

        let sdk_result = sdk_sha256(data);

        assert_eq!(existing, sdk_result, "sha256 must be byte-identical");
    }

    // -----------------------------------------------------------------------
    // Key comparison tests
    // -----------------------------------------------------------------------

    #[test]
    fn wif_to_privkey_bytes_matches() {
        let wif = test_wif();

        // Existing: manual Base58Check decode
        let decoded = bs58::decode(wif.trim())
            .with_check(None)
            .into_vec()
            .unwrap();
        let mut existing = [0u8; 32];
        existing.copy_from_slice(&decoded[1..33]);

        // SDK
        let sdk_result = sdk_wif_to_bytes(&wif).unwrap();

        assert_eq!(existing, sdk_result, "WIF → privkey bytes must match");
    }

    #[test]
    fn pubkey_bytes_matches() {
        let wif = test_wif();

        // Existing: secp256k1 crate
        let decoded = bs58::decode(wif.trim())
            .with_check(None)
            .into_vec()
            .unwrap();
        let sk = secp256k1::SecretKey::from_slice(&decoded[1..33]).unwrap();
        let secp = secp256k1::Secp256k1::new();
        let existing = secp256k1::PublicKey::from_secret_key(&secp, &sk).serialize();

        // SDK
        let sdk_result = sdk_pubkey_bytes_from_wif(&wif).unwrap();

        assert_eq!(existing, sdk_result, "Compressed pubkey bytes must match");
    }

    #[test]
    fn address_from_wif_matches() {
        let wif = test_wif();

        // Existing: secp256k1 → hash160 → Base58Check
        let decoded = bs58::decode(wif.trim())
            .with_check(None)
            .into_vec()
            .unwrap();
        let sk = secp256k1::SecretKey::from_slice(&decoded[1..33]).unwrap();
        let secp = secp256k1::Secp256k1::new();
        let pk = secp256k1::PublicKey::from_secret_key(&secp, &sk);
        let compressed = pk.serialize();

        use ripemd::Ripemd160;
        use sha2::{Digest, Sha256};
        let sha = Sha256::digest(compressed);
        let ripe = Ripemd160::digest(sha);
        let mut payload = Vec::with_capacity(21);
        payload.push(0x00);
        payload.extend_from_slice(&ripe);
        let existing = bs58::encode(payload).with_check().into_string();

        // SDK
        let sdk_result = sdk_address_from_wif(&wif).unwrap();

        assert_eq!(existing, sdk_result, "P2PKH address must match");
    }

    #[test]
    fn wif_roundtrip_matches() {
        let wif = test_wif();

        // Extract privkey bytes, then re-encode to WIF using SDK
        let privkey_bytes = sdk_wif_to_bytes(&wif).unwrap();
        let roundtrip = sdk_privkey_to_wif(&privkey_bytes).unwrap();

        assert_eq!(wif, roundtrip, "WIF roundtrip must produce identical string");
    }

    #[test]
    fn pubkey_hex_matches() {
        let wif = test_wif();

        // Existing
        let decoded = bs58::decode(wif.trim())
            .with_check(None)
            .into_vec()
            .unwrap();
        let sk = secp256k1::SecretKey::from_slice(&decoded[1..33]).unwrap();
        let secp = secp256k1::Secp256k1::new();
        let existing = hex::encode(
            secp256k1::PublicKey::from_secret_key(&secp, &sk).serialize(),
        );

        // SDK
        let sdk_result = sdk_pubkey_hex_from_wif(&wif).unwrap();

        assert_eq!(existing, sdk_result, "Public key hex must match");
    }

    // -----------------------------------------------------------------------
    // P2PKH locking script comparison
    // -----------------------------------------------------------------------

    #[test]
    fn p2pkh_locking_script_matches() {
        let wif = test_wif();
        let address = sdk_address_from_wif(&wif).unwrap();

        // Existing: manual script construction
        let decoded = bs58::decode(&address)
            .with_check(None)
            .into_vec()
            .unwrap();
        let mut pkh = [0u8; 20];
        pkh.copy_from_slice(&decoded[1..21]);
        let mut existing = Vec::with_capacity(25);
        existing.push(0x76); // OP_DUP
        existing.push(0xa9); // OP_HASH160
        existing.push(0x14); // push 20 bytes
        existing.extend_from_slice(&pkh);
        existing.push(0x88); // OP_EQUALVERIFY
        existing.push(0xac); // OP_CHECKSIG

        // SDK
        let sdk_result = sdk_p2pkh_locking_script(&address).unwrap();

        assert_eq!(existing, sdk_result, "P2PKH locking script must match");
    }

    // -----------------------------------------------------------------------
    // Signature comparison tests
    // -----------------------------------------------------------------------

    #[test]
    fn sign_and_verify_roundtrip() {
        let wif = test_wif();
        let message = b"test message for signing";
        let msg_hash = sdk_sha256(message);

        // Sign with SDK
        let sig_der = sdk_sign_hash(&wif, &msg_hash).unwrap();

        // Verify with SDK
        let pubkey_hex = sdk_pubkey_hex_from_wif(&wif).unwrap();
        let valid = sdk_verify_signature(&pubkey_hex, &msg_hash, &sig_der).unwrap();
        assert!(valid, "SDK signature should verify");
    }

    #[test]
    fn sdk_signature_verifies_with_existing_secp256k1() {
        let wif = test_wif();
        let message = b"cross-verify test";
        let msg_hash = sdk_sha256(message);

        // Sign with SDK
        let sig_der = sdk_sign_hash(&wif, &msg_hash).unwrap();

        // Verify with existing secp256k1 crate
        let decoded = bs58::decode(wif.trim())
            .with_check(None)
            .into_vec()
            .unwrap();
        let sk = secp256k1::SecretKey::from_slice(&decoded[1..33]).unwrap();
        let secp = secp256k1::Secp256k1::new();
        let pk = secp256k1::PublicKey::from_secret_key(&secp, &sk);

        let sig =
            secp256k1::ecdsa::Signature::from_der(&sig_der).expect("DER should parse");
        let msg = secp256k1::Message::from_digest(msg_hash);

        assert!(
            secp.verify_ecdsa(&msg, &sig, &pk).is_ok(),
            "SDK signature must verify with existing secp256k1 crate"
        );
    }

    #[test]
    fn existing_signature_verifies_with_sdk() {
        let wif = test_wif();
        let message = b"cross-verify test reverse";
        let msg_hash = sdk_sha256(message);

        // Sign with existing secp256k1 crate
        let decoded = bs58::decode(wif.trim())
            .with_check(None)
            .into_vec()
            .unwrap();
        let sk = secp256k1::SecretKey::from_slice(&decoded[1..33]).unwrap();
        let secp = secp256k1::Secp256k1::new();
        let msg = secp256k1::Message::from_digest(msg_hash);
        let sig = secp.sign_ecdsa(&msg, &sk);
        let sig_der = sig.serialize_der();

        // Verify with SDK
        let pubkey_hex = sdk_pubkey_hex_from_wif(&wif).unwrap();
        let valid = sdk_verify_signature(&pubkey_hex, &msg_hash, &sig_der).unwrap();
        assert!(
            valid,
            "Existing secp256k1 signature must verify with SDK"
        );
    }

    #[test]
    fn deterministic_signatures_match() {
        // Both libraries should produce identical signatures for the same
        // message (both use RFC 6979 deterministic nonces).
        let wif = test_wif();
        let message = b"deterministic signature test";
        let msg_hash = sdk_sha256(message);

        // Sign with existing secp256k1 crate
        let decoded = bs58::decode(wif.trim())
            .with_check(None)
            .into_vec()
            .unwrap();
        let sk = secp256k1::SecretKey::from_slice(&decoded[1..33]).unwrap();
        let secp = secp256k1::Secp256k1::new();
        let msg = secp256k1::Message::from_digest(msg_hash);
        let existing_sig = secp.sign_ecdsa(&msg, &sk);
        let existing_der = existing_sig.serialize_der();

        // Sign with SDK
        let sdk_der = sdk_sign_hash(&wif, &msg_hash).unwrap();

        // Both should produce the same DER bytes (both use RFC 6979)
        assert_eq!(
            existing_der.as_ref(),
            sdk_der.as_slice(),
            "Deterministic signatures (RFC 6979) should produce identical DER bytes"
        );
    }

    // -----------------------------------------------------------------------
    // Transaction comparison tests
    // -----------------------------------------------------------------------

    #[test]
    fn sdk_transaction_builds_and_signs() {
        let wif = test_wif();

        // Build using SDK
        let (raw_hex, txid) = sdk_build_p2pkh_tx(
            &wif,
            &[(
                "a".repeat(64),
                0,
                10000,
                "76a914".to_string() + &"00".repeat(20) + "88ac",
            )],
            &[("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(), 5000)],
        )
        .unwrap();

        // Basic sanity checks
        assert!(!raw_hex.is_empty(), "Raw tx should be non-empty");
        assert_eq!(txid.len(), 64, "TXID should be 64 hex chars");

        // Verify txid matches double-SHA256 of raw tx
        let raw_bytes = hex::decode(&raw_hex).unwrap();
        let computed_hash = sdk_double_sha256(&raw_bytes);
        let mut reversed = computed_hash;
        reversed.reverse();
        let computed_txid = hex::encode(reversed);
        assert_eq!(txid, computed_txid, "TXID should match dSHA256 of raw tx");
    }

    #[test]
    fn sdk_tx_serialization_format_is_valid() {
        let wif = test_wif();

        let (raw_hex, _) = sdk_build_p2pkh_tx(
            &wif,
            &[(
                "b".repeat(64),
                1,
                20000,
                "76a914".to_string() + &"11".repeat(20) + "88ac",
            )],
            &[("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_string(), 8000)],
        )
        .unwrap();

        let raw_bytes = hex::decode(&raw_hex).unwrap();

        // Check version (first 4 bytes = 01000000)
        assert_eq!(&raw_bytes[0..4], &[1, 0, 0, 0], "Version should be 1");

        // Check input count (varint after version)
        assert_eq!(raw_bytes[4], 1, "Should have 1 input");

        // Check last 4 bytes = locktime (00000000)
        let len = raw_bytes.len();
        assert_eq!(
            &raw_bytes[len - 4..],
            &[0, 0, 0, 0],
            "Locktime should be 0"
        );
    }

    // -----------------------------------------------------------------------
    // Multiple key/address tests for broader coverage
    // -----------------------------------------------------------------------

    #[test]
    fn multiple_accounts_produce_consistent_results() {
        let mnemonic_str =
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let mn: bip39::Mnemonic = mnemonic_str.parse().unwrap();
        let seed = mn.to_seed("");

        // Test multiple accounts
        for account in 0..3u32 {
            let wallet_path = format!("m/44'/236'/{}'/1/0", account);
            let master = bip32::XPrv::new(&seed).unwrap();

            // Derive via BIP-32
            let parts: Vec<&str> = wallet_path.split('/').collect();
            let mut key = master;
            for part in &parts[1..] {
                let (index_str, hardened) = if let Some(s) = part.strip_suffix('\'') {
                    (s, true)
                } else {
                    (*part, false)
                };
                let index: u32 = index_str.parse().unwrap();
                let child_number = bip32::ChildNumber::new(index, hardened).unwrap();
                key = key.derive_child(child_number).unwrap();
            }
            let privkey_bytes: [u8; 32] = key.to_bytes().into();

            // Convert to WIF using existing method
            let mut payload = Vec::with_capacity(34);
            payload.push(0x80);
            payload.extend_from_slice(&privkey_bytes);
            payload.push(0x01);
            let existing_wif = bs58::encode(&payload).with_check().into_string();

            // Convert using SDK
            let sdk_wif = sdk_privkey_to_wif(&privkey_bytes).unwrap();
            assert_eq!(existing_wif, sdk_wif, "WIF should match for account {}", account);

            // Address should also match
            let existing_address = {
                let sk = secp256k1::SecretKey::from_slice(&privkey_bytes).unwrap();
                let secp = secp256k1::Secp256k1::new();
                let pk = secp256k1::PublicKey::from_secret_key(&secp, &sk);
                let compressed = pk.serialize();
                use ripemd::Ripemd160;
                use sha2::{Digest, Sha256};
                let sha = Sha256::digest(compressed);
                let ripe = Ripemd160::digest(sha);
                let mut addr_payload = Vec::with_capacity(21);
                addr_payload.push(0x00);
                addr_payload.extend_from_slice(&ripe);
                bs58::encode(addr_payload).with_check().into_string()
            };

            let sdk_address = sdk_address_from_wif(&sdk_wif).unwrap();
            assert_eq!(
                existing_address, sdk_address,
                "Address should match for account {}",
                account
            );
        }
    }
}
