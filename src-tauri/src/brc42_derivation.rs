//! BRC-42/43 Key Derivation & Utility Commands
//!
//! Provides BRC-42 child key derivation, BRC-43 tagged key derivation,
//! address validation, and utility crypto operations as Tauri commands.
//!
//! These commands replace the @bsv/sdk JavaScript dependency for:
//! - PrivateKey.deriveChild(publicKey, invoiceNumber)
//! - PublicKey.fromString(hex).toAddress()
//! - Utils.fromBase58Check(address)
//! - Hash.sha256(data)
//! - P2PKH().lock(address).toHex()

use serde::{Deserialize, Serialize};

use crate::bsv_sdk_adapter::{
    sdk_derive_child_key, sdk_hash160, sdk_p2pkh_locking_script, sdk_pubkey_to_address, sdk_sha256,
    sdk_validate_address,
};

// ---------------------------------------------------------------------------
// BRC-42 Key Derivation
// ---------------------------------------------------------------------------

/// Result of a BRC-42 child key derivation.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedKeyResult {
    pub wif: String,
    pub address: String,
    pub pub_key: String,
}

/// Derive a child key using BRC-42 protocol.
///
/// Computes: ECDH(receiver_priv, sender_pub) → HMAC-SHA256(invoice) → scalar addition.
/// Returns the child private key (WIF), address, and compressed public key hex.
#[tauri::command]
pub fn derive_child_key(
    wif: String,
    sender_pub_key: String,
    invoice_number: String,
) -> Result<DerivedKeyResult, String> {
    let (child_wif, child_address, child_pubkey) =
        sdk_derive_child_key(&wif, &sender_pub_key, &invoice_number)?;

    Ok(DerivedKeyResult {
        wif: child_wif,
        address: child_address,
        pub_key: child_pubkey,
    })
}

/// Result of a derived address (no private key exposed).
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedAddressResult {
    pub address: String,
    pub sender_pub_key: String,
    pub invoice_number: String,
}

/// Batch-derive addresses from multiple sender public keys and invoice numbers.
///
/// For each (senderPubKey, invoiceNumber) pair, derives the child address.
/// Skips invalid derivations silently. Returns all successful derivations.
///
/// This replaces getDerivedAddresses() from src/services/keyDerivation.ts.
#[tauri::command]
pub fn get_derived_addresses(
    wif: String,
    sender_pub_keys: Vec<String>,
    invoice_numbers: Vec<String>,
) -> Result<Vec<DerivedAddressResult>, String> {
    let mut results = Vec::new();

    for sender_pubkey_hex in &sender_pub_keys {
        for invoice_number in &invoice_numbers {
            match sdk_derive_child_key(&wif, sender_pubkey_hex, invoice_number) {
                Ok((_, child_address, _)) => {
                    results.push(DerivedAddressResult {
                        address: child_address,
                        sender_pub_key: sender_pubkey_hex.clone(),
                        invoice_number: invoice_number.clone(),
                    });
                }
                Err(_) => {
                    // Skip invalid derivations (matches JS behavior)
                }
            }
        }
    }

    Ok(results)
}

/// Find the invoice number that produces a target address.
///
/// Tries numeric invoice numbers 0..maxInvoiceNumber, then common invoice numbers.
/// Returns the matching invoice number and derived WIF, or null if not found.
///
/// This replaces findDerivedKeyForAddress() from src/services/keyDerivation.ts.
#[tauri::command]
pub fn find_derived_key_for_address(
    wif: String,
    target_address: String,
    sender_pub_key: String,
    invoice_numbers: Vec<String>,
    max_numeric: Option<u32>,
) -> Result<Option<DerivedKeyResult>, String> {
    let max = max_numeric.unwrap_or(100);

    // Try numeric invoice numbers first
    for i in 0..=max {
        let inv = i.to_string();
        if let Ok((child_wif, child_address, child_pubkey)) =
            sdk_derive_child_key(&wif, &sender_pub_key, &inv)
        {
            if child_address == target_address {
                return Ok(Some(DerivedKeyResult {
                    wif: child_wif,
                    address: child_address,
                    pub_key: child_pubkey,
                }));
            }
        }
    }

    // Try provided common invoice numbers
    for inv in &invoice_numbers {
        if let Ok((child_wif, child_address, child_pubkey)) =
            sdk_derive_child_key(&wif, &sender_pub_key, inv)
        {
            if child_address == target_address {
                return Ok(Some(DerivedKeyResult {
                    wif: child_wif,
                    address: child_address,
                    pub_key: child_pubkey,
                }));
            }
        }
    }

    Ok(None)
}

// ---------------------------------------------------------------------------
// BRC-43 Tagged Key Derivation
// ---------------------------------------------------------------------------

/// Result of a tagged key derivation.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaggedKeyResult {
    pub wif: String,
    pub pub_key: String,
    pub address: String,
    pub derivation_path: String,
}

/// Derive a tagged key for app-specific purposes (BRC-43 compatible).
///
/// Uses the tag as a "self-derivation" invoice: deriveChild(rootPubKey, tagString).
/// The tag string is length-prefixed to prevent collisions.
///
/// This replaces deriveTaggedKey() from src/services/keyDerivation.ts.
#[tauri::command]
pub fn derive_tagged_key(
    wif: String,
    label: String,
    id: String,
    domain: Option<String>,
) -> Result<TaggedKeyResult, String> {
    // Compute derivation path (matches JS getTaggedDerivationPath)
    let label_hash = sdk_sha256(label.as_bytes());
    let id_hash = sdk_sha256(id.as_bytes());

    let label_index = u32::from_be_bytes([label_hash[0], label_hash[1], label_hash[2], label_hash[3]])
        % 2_147_483_648;
    let id_index =
        u32::from_be_bytes([id_hash[0], id_hash[1], id_hash[2], id_hash[3]]) % 2_147_483_648;
    let derivation_path = format!("m/44'/236'/218'/{}/{}", label_index, id_index);

    // S-44: Length-prefixed serialization to prevent tag collisions
    let domain_str = domain.as_deref().unwrap_or("");
    let tag_string = format!(
        "{}:{}|{}:{}|{}:{}",
        label.len(),
        label,
        id.len(),
        id,
        domain_str.len(),
        domain_str
    );

    // Self-derivation: deriveChild(rootPubKey, tagString)
    let (child_wif, child_address, child_pubkey) = sdk_derive_child_key(&wif,
        &crate::bsv_sdk_adapter::sdk_pubkey_hex_from_wif(&wif)?,
        &tag_string)?;

    Ok(TaggedKeyResult {
        wif: child_wif,
        pub_key: child_pubkey,
        address: child_address,
        derivation_path,
    })
}

// ---------------------------------------------------------------------------
// Utility Commands
// ---------------------------------------------------------------------------

/// Validate a BSV address (Base58Check checksum + version prefix).
///
/// Returns true for valid P2PKH (0x00) and P2SH (0x05) mainnet addresses.
/// This replaces Utils.fromBase58Check() from @bsv/sdk.
#[tauri::command]
pub fn validate_bsv_address(address: String) -> bool {
    sdk_validate_address(&address)
}

/// Get P2PKH locking script hex for an address.
///
/// Returns the standard P2PKH script: OP_DUP OP_HASH160 <pubkeyHash> OP_EQUALVERIFY OP_CHECKSIG
/// This replaces P2PKH().lock(address).toHex() from @bsv/sdk.
#[tauri::command]
pub fn p2pkh_script_hex(address: String) -> Result<String, String> {
    let script_bytes = sdk_p2pkh_locking_script(&address)?;
    Ok(hex::encode(script_bytes))
}

/// Convert compressed public key hex to P2PKH address.
///
/// This replaces PublicKey.fromString(hex).toAddress() from @bsv/sdk.
#[tauri::command]
pub fn pubkey_to_address(pub_key_hex: String) -> Result<String, String> {
    sdk_pubkey_to_address(&pub_key_hex)
}

/// Compute SHA-256 hash of UTF-8 string data.
///
/// Returns hex-encoded hash. This replaces Hash.sha256() from @bsv/sdk.
#[tauri::command]
pub fn sha256_hash(data: String) -> String {
    let hash = sdk_sha256(data.as_bytes());
    hex::encode(hash)
}

/// Compute SHA-256 hash of raw byte data.
///
/// Returns hex-encoded hash.
#[tauri::command]
pub fn sha256_hash_bytes(data: Vec<u8>) -> String {
    let hash = sdk_sha256(&data);
    hex::encode(hash)
}

/// Compute Hash160 (RIPEMD-160(SHA-256(data))) of a compressed public key hex.
///
/// Returns the 20-byte hash as a 40-char hex string.
/// This replaces `PublicKey.fromString(hex).toHash()` from @bsv/sdk.
#[tauri::command]
pub fn pubkey_to_hash160(pub_key_hex: String) -> Result<String, String> {
    let pubkey_bytes = hex::decode(&pub_key_hex)
        .map_err(|e| format!("Invalid hex: {}", e))?;
    if pubkey_bytes.len() != 33 {
        return Err(format!(
            "Expected 33-byte compressed public key, got {} bytes",
            pubkey_bytes.len()
        ));
    }
    let hash = sdk_hash160(&pubkey_bytes);
    Ok(hex::encode(hash))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn get_test_keys() -> crate::key_derivation::WalletKeys {
        crate::key_derivation::derive_wallet_keys(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string()
        ).unwrap()
    }

    #[test]
    fn derive_child_key_produces_valid_output() {
        let keys = get_test_keys();

        // Self-derivation (receiver == sender identity)
        let result = derive_child_key(
            keys.identity_wif.clone(),
            keys.identity_pub_key.clone(),
            "test-invoice-1".to_string(),
        )
        .unwrap();

        // Child key should be valid
        assert!(
            result.wif.starts_with('K') || result.wif.starts_with('L'),
            "Child WIF: {}",
            result.wif
        );
        assert!(result.address.starts_with('1'), "Child address: {}", result.address);
        assert_eq!(result.pub_key.len(), 66);
        assert!(
            result.pub_key.starts_with("02") || result.pub_key.starts_with("03"),
            "Child pubkey: {}",
            result.pub_key
        );
    }

    #[test]
    fn derive_child_key_is_deterministic() {
        let keys = get_test_keys();

        let result1 = derive_child_key(
            keys.identity_wif.clone(),
            keys.identity_pub_key.clone(),
            "determinism-test".to_string(),
        )
        .unwrap();

        let result2 = derive_child_key(
            keys.identity_wif.clone(),
            keys.identity_pub_key.clone(),
            "determinism-test".to_string(),
        )
        .unwrap();

        assert_eq!(result1.wif, result2.wif);
        assert_eq!(result1.address, result2.address);
        assert_eq!(result1.pub_key, result2.pub_key);
    }

    #[test]
    fn different_invoice_numbers_produce_different_keys() {
        let keys = get_test_keys();

        let result1 = derive_child_key(
            keys.identity_wif.clone(),
            keys.identity_pub_key.clone(),
            "invoice-1".to_string(),
        )
        .unwrap();

        let result2 = derive_child_key(
            keys.identity_wif.clone(),
            keys.identity_pub_key.clone(),
            "invoice-2".to_string(),
        )
        .unwrap();

        assert_ne!(result1.address, result2.address);
    }

    #[test]
    fn derive_child_key_cross_party() {
        // Derive using two different accounts as sender/receiver
        let keys0 = crate::key_derivation::derive_wallet_keys_for_account(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string(),
            0,
        )
        .unwrap();
        let keys1 = crate::key_derivation::derive_wallet_keys_for_account(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string(),
            1,
        )
        .unwrap();

        let result = derive_child_key(
            keys0.identity_wif.clone(),
            keys1.identity_pub_key.clone(),
            "cross-party-test".to_string(),
        )
        .unwrap();

        // Should differ from both source addresses
        assert_ne!(result.address, keys0.identity_address);
        assert_ne!(result.address, keys1.identity_address);
    }

    #[test]
    fn get_derived_addresses_works() {
        let keys = get_test_keys();
        let keys1 = crate::key_derivation::derive_wallet_keys_for_account(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string(),
            1,
        )
        .unwrap();

        let results = get_derived_addresses(
            keys.identity_wif.clone(),
            vec![keys1.identity_pub_key.clone()],
            vec!["0".to_string(), "1".to_string(), "2".to_string()],
        )
        .unwrap();

        assert_eq!(results.len(), 3);
        // All addresses should be unique
        let addresses: Vec<&str> = results.iter().map(|r| r.address.as_str()).collect();
        let unique: std::collections::HashSet<&str> = addresses.iter().copied().collect();
        assert_eq!(unique.len(), 3);
    }

    #[test]
    fn find_derived_key_finds_matching_address() {
        let keys = get_test_keys();
        let keys1 = crate::key_derivation::derive_wallet_keys_for_account(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string(),
            1,
        )
        .unwrap();

        // First derive a known address with invoice "42"
        let known = derive_child_key(
            keys.identity_wif.clone(),
            keys1.identity_pub_key.clone(),
            "42".to_string(),
        )
        .unwrap();

        // Now search for it
        let found = find_derived_key_for_address(
            keys.identity_wif.clone(),
            known.address.clone(),
            keys1.identity_pub_key.clone(),
            vec![],
            Some(100),
        )
        .unwrap();

        assert!(found.is_some(), "Should find the derived key");
        let found = found.unwrap();
        assert_eq!(found.address, known.address);
        assert_eq!(found.wif, known.wif);
    }

    #[test]
    fn find_derived_key_returns_none_when_not_found() {
        let keys = get_test_keys();

        let found = find_derived_key_for_address(
            keys.identity_wif.clone(),
            "1NonExistentAddress".to_string(),
            keys.identity_pub_key.clone(),
            vec![],
            Some(10),
        )
        .unwrap();

        assert!(found.is_none());
    }

    #[test]
    fn derive_tagged_key_works() {
        let keys = get_test_keys();

        let result = derive_tagged_key(
            keys.identity_wif.clone(),
            "yours".to_string(),
            "identity".to_string(),
            None,
        )
        .unwrap();

        assert!(result.wif.starts_with('K') || result.wif.starts_with('L'));
        assert!(result.address.starts_with('1'));
        assert_eq!(result.pub_key.len(), 66);
        assert!(result.derivation_path.starts_with("m/44'/236'/218'/"));
    }

    #[test]
    fn derive_tagged_key_is_deterministic() {
        let keys = get_test_keys();

        let r1 = derive_tagged_key(
            keys.identity_wif.clone(),
            "app-name".to_string(),
            "feature".to_string(),
            Some("example.com".to_string()),
        )
        .unwrap();

        let r2 = derive_tagged_key(
            keys.identity_wif.clone(),
            "app-name".to_string(),
            "feature".to_string(),
            Some("example.com".to_string()),
        )
        .unwrap();

        assert_eq!(r1.wif, r2.wif);
        assert_eq!(r1.address, r2.address);
    }

    #[test]
    fn validate_bsv_address_works() {
        let keys = get_test_keys();
        assert!(validate_bsv_address(keys.wallet_address));
        assert!(!validate_bsv_address("invalid".to_string()));
        assert!(!validate_bsv_address("".to_string()));
    }

    #[test]
    fn p2pkh_script_hex_works() {
        let keys = get_test_keys();
        let script_hex = p2pkh_script_hex(keys.wallet_address).unwrap();

        // P2PKH script is 25 bytes = 50 hex chars
        assert_eq!(script_hex.len(), 50);
        // Starts with OP_DUP OP_HASH160 PUSH20
        assert!(script_hex.starts_with("76a914"));
        // Ends with OP_EQUALVERIFY OP_CHECKSIG
        assert!(script_hex.ends_with("88ac"));
    }

    #[test]
    fn pubkey_to_address_works() {
        let keys = get_test_keys();
        let addr = pubkey_to_address(keys.wallet_pub_key.clone()).unwrap();
        assert_eq!(addr, keys.wallet_address);
    }

    #[test]
    fn sha256_hash_works() {
        let hash = sha256_hash("test".to_string());
        assert_eq!(hash.len(), 64); // 32 bytes = 64 hex chars
        // Known SHA-256 of "test"
        assert_eq!(
            hash,
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        );
    }

    #[test]
    fn sha256_hash_bytes_works() {
        let hash = sha256_hash_bytes(vec![0x74, 0x65, 0x73, 0x74]); // "test" bytes
        assert_eq!(
            hash,
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        );
    }

    #[test]
    fn pubkey_to_hash160_works() {
        let keys = get_test_keys();
        let hash = pubkey_to_hash160(keys.wallet_pub_key).unwrap();
        // Hash160 returns 20 bytes = 40 hex chars
        assert_eq!(hash.len(), 40);
        // The hash should correspond to the same address
        // (address = Base58Check(0x00 + hash160))
    }

    #[test]
    fn pubkey_to_hash160_rejects_invalid() {
        let result = pubkey_to_hash160("not-hex".to_string());
        assert!(result.is_err());

        let result = pubkey_to_hash160("abcd".to_string());
        assert!(result.is_err()); // Wrong length
    }
}
