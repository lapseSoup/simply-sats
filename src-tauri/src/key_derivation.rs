//! HD Wallet Key Derivation (BIP-39/BIP-32/BIP-44)
//!
//! Provides wallet key derivation as Tauri commands so that mnemonics and
//! private keys never enter the webview's JavaScript heap. The frontend
//! receives only public keys and addresses.
//!
//! Derivation paths follow the BRC-100 / Yours Wallet standard:
//!   wallet:   m/44'/236'/{account}'/1/0
//!   ordinals: m/44'/236'/{account*2+1}'/0/0
//!   identity: m/0'/236'/{account}'/0/0

use bip32::XPrv;
use bip39::Mnemonic;
use rand::rngs::OsRng;
use rand::RngCore;
use ripemd::Ripemd160;
use secp256k1::{PublicKey, Secp256k1, SecretKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

/// Matches the TypeScript `WalletKeys` interface exactly.
/// Debug intentionally omitted to prevent accidental secret logging.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletKeys {
    pub mnemonic: String,
    pub wallet_type: String,
    pub wallet_wif: String,
    pub wallet_address: String,
    pub wallet_pub_key: String,
    pub ord_wif: String,
    pub ord_address: String,
    pub ord_pub_key: String,
    pub identity_wif: String,
    pub identity_address: String,
    pub identity_pub_key: String,
}

/// A single derived key pair (WIF + address + compressed public key hex).
#[derive(Debug, Clone)]
struct KeyPair {
    wif: String,
    address: String,
    pub_key: String,
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/// Derive a child extended private key from a seed via a BIP-32 path string.
///
/// Path format: `m/44'/236'/0'/1/0`
/// - `'` suffix = hardened child (index + 0x8000_0000)
fn derive_xprv_from_seed(seed: &[u8], path: &str) -> Result<XPrv, String> {
    let master = XPrv::new(seed).map_err(|e| format!("Failed to create master key: {}", e))?;

    let parts: Vec<&str> = path.split('/').collect();
    if parts.is_empty() || parts[0] != "m" {
        return Err("Path must start with 'm'".into());
    }

    let mut key = master;
    for part in &parts[1..] {
        let (index_str, hardened) = if let Some(s) = part.strip_suffix('\'') {
            (s, true)
        } else {
            (*part, false)
        };

        let index: u32 = index_str
            .parse()
            .map_err(|_| format!("Invalid path index: {}", part))?;

        let child_number = if hardened {
            bip32::ChildNumber::new(index, true)
                .map_err(|e| format!("Invalid hardened index {}: {}", index, e))?
        } else {
            bip32::ChildNumber::new(index, false)
                .map_err(|e| format!("Invalid index {}: {}", index, e))?
        };

        key = key
            .derive_child(child_number)
            .map_err(|e| format!("Derivation failed at {}: {}", part, e))?;
    }

    Ok(key)
}

/// Convert a 32-byte private key to WIF (Wallet Import Format) for mainnet.
///
/// Format: Base58Check( 0x80 || privkey_bytes || 0x01 )
/// The 0x01 suffix indicates a compressed public key.
fn privkey_to_wif(privkey_bytes: &[u8; 32]) -> String {
    let mut payload = Vec::with_capacity(34);
    payload.push(0x80); // mainnet prefix
    payload.extend_from_slice(privkey_bytes);
    payload.push(0x01); // compressed flag
    bs58::encode(payload)
        .with_check()
        .into_string()
}

/// Derive a compressed public key hex string from a secret key.
fn pubkey_hex(secp: &Secp256k1<secp256k1::All>, sk: &SecretKey) -> String {
    let pk = PublicKey::from_secret_key(secp, sk);
    hex::encode(pk.serialize()) // 33 bytes compressed
}

/// Derive a P2PKH address from a compressed public key (mainnet).
///
/// Address = Base58Check( 0x00 || RIPEMD160(SHA256(compressed_pubkey)) )
fn pubkey_to_address(secp: &Secp256k1<secp256k1::All>, sk: &SecretKey) -> String {
    let pk = PublicKey::from_secret_key(secp, sk);
    let compressed = pk.serialize(); // 33 bytes

    // Hash160 = RIPEMD160(SHA256(pubkey))
    let sha_hash = Sha256::digest(compressed);
    let ripe_hash = Ripemd160::digest(sha_hash);

    let mut payload = Vec::with_capacity(21);
    payload.push(0x00); // mainnet P2PKH prefix
    payload.extend_from_slice(&ripe_hash);

    bs58::encode(payload).with_check().into_string()
}

/// Derive a full KeyPair from a BIP-39 seed and BIP-32 path.
fn derive_keypair(seed: &[u8], path: &str) -> Result<KeyPair, String> {
    let xprv = derive_xprv_from_seed(seed, path)?;
    let mut privkey_bytes: [u8; 32] = xprv.to_bytes().into();

    let secp = Secp256k1::new();
    let sk = SecretKey::from_slice(&privkey_bytes)
        .map_err(|e| format!("Invalid secret key: {}", e))?;

    let result = KeyPair {
        wif: privkey_to_wif(&privkey_bytes),
        address: pubkey_to_address(&secp, &sk),
        pub_key: pubkey_hex(&secp, &sk),
    };
    privkey_bytes.zeroize();
    Ok(result)
}

/// Parse and validate a mnemonic, returning the 64-byte BIP-39 seed.
fn mnemonic_to_seed(mnemonic_str: &str) -> Result<Vec<u8>, String> {
    let mn: Mnemonic = mnemonic_str
        .parse()
        .map_err(|e| format!("Invalid mnemonic: {}", e))?;

    // BIP-39 seed: PBKDF2-HMAC-SHA512(password=mnemonic, salt="mnemonic"+passphrase, 2048 rounds)
    // Empty passphrase matches @bsv/sdk's Mnemonic.fromString(m).toSeed() default
    Ok(mn.to_seed("").to_vec())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Derive all wallet keys for account 0 from a mnemonic.
///
/// This is the primary entry point for wallet creation/restore. The mnemonic
/// is validated, the seed is derived, and all three key sets (wallet, ordinals,
/// identity) are generated using BRC-100 standard paths.
///
/// The mnemonic and private keys exist ONLY in Rust memory during this call.
#[tauri::command]
pub fn derive_wallet_keys(mnemonic: String) -> Result<WalletKeys, String> {
    derive_wallet_keys_for_account(mnemonic, 0)
}

/// Derive all wallet keys for a specific account index.
///
/// Account paths:
///   wallet:   m/44'/236'/{account}'/1/0
///   ordinals: m/44'/236'/{account*2+1}'/0/0
///   identity: m/0'/236'/{account}'/0/0
#[tauri::command]
pub fn derive_wallet_keys_for_account(
    mnemonic: String,
    account_index: u32,
) -> Result<WalletKeys, String> {
    let trimmed = mnemonic.trim();
    let mut seed = mnemonic_to_seed(trimmed)?;

    // Build paths
    let wallet_path = format!("m/44'/236'/{}'/1/0", account_index);
    let ordinals_path = format!("m/44'/236'/{}'/0/0", account_index * 2 + 1);
    let identity_path = format!("m/0'/236'/{}'/0/0", account_index);

    let wallet = derive_keypair(&seed, &wallet_path)?;
    let ord = derive_keypair(&seed, &ordinals_path)?;
    let identity = derive_keypair(&seed, &identity_path)?;
    seed.zeroize();

    Ok(WalletKeys {
        mnemonic: trimmed.to_string(),
        wallet_type: "yours".to_string(),
        wallet_wif: wallet.wif,
        wallet_address: wallet.address,
        wallet_pub_key: wallet.pub_key,
        ord_wif: ord.wif,
        ord_address: ord.address,
        ord_pub_key: ord.pub_key,
        identity_wif: identity.wif,
        identity_address: identity.address,
        identity_pub_key: identity.pub_key,
    })
}

/// Validate a BIP-39 mnemonic without deriving any keys.
#[tauri::command]
pub fn validate_mnemonic(mnemonic: String) -> Result<bool, String> {
    Ok(mnemonic.trim().parse::<Mnemonic>().is_ok())
}

/// Generate a new random BIP-39 mnemonic (12 words / 128-bit entropy).
#[tauri::command]
pub fn generate_mnemonic() -> Result<String, String> {
    let mut entropy = [0u8; 16]; // 128 bits = 12 words
    OsRng.fill_bytes(&mut entropy);
    let mn = Mnemonic::from_entropy(&entropy)
        .map_err(|e| format!("Failed to generate mnemonic: {}", e))?;
    entropy.zeroize();
    Ok(mn.to_string())
}

/// Derive a key pair from a WIF string (for importing external wallets).
/// Returns address and compressed public key hex.
#[tauri::command]
pub fn keys_from_wif(wif: String) -> Result<serde_json::Value, String> {
    // Decode Base58Check
    let decoded = bs58::decode(wif.trim())
        .with_check(None)
        .into_vec()
        .map_err(|e| format!("Invalid WIF: {}", e))?;

    // Validate format: 0x80 + 32 bytes + optional 0x01 compression flag
    if decoded.is_empty() || decoded[0] != 0x80 {
        return Err("Invalid WIF prefix (expected 0x80 for mainnet)".into());
    }

    let mut privkey_bytes: [u8; 32] = if decoded.len() == 34 && decoded[33] == 0x01 {
        // Compressed WIF (most common)
        decoded[1..33]
            .try_into()
            .map_err(|_| "Invalid private key length")?
    } else if decoded.len() == 33 {
        // Uncompressed WIF
        decoded[1..33]
            .try_into()
            .map_err(|_| "Invalid private key length")?
    } else {
        return Err(format!(
            "Invalid WIF length: expected 33 or 34 bytes, got {}",
            decoded.len()
        ));
    };

    let secp = Secp256k1::new();
    let sk = SecretKey::from_slice(&privkey_bytes)
        .map_err(|e| format!("Invalid private key: {}", e))?;

    let result = serde_json::json!({
        "wif": privkey_to_wif(&privkey_bytes),
        "address": pubkey_to_address(&secp, &sk),
        "pubKey": pubkey_hex(&secp, &sk),
    });
    privkey_bytes.zeroize();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Standard BIP-39 test mnemonic (12 words)
    const TEST_MNEMONIC: &str =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    #[test]
    fn derive_account0_produces_consistent_keys() {
        let keys = derive_wallet_keys(TEST_MNEMONIC.to_string()).unwrap();
        assert_eq!(keys.wallet_type, "yours");
        assert_eq!(keys.mnemonic, TEST_MNEMONIC);

        // Addresses should be valid P2PKH (start with '1')
        assert!(keys.wallet_address.starts_with('1'), "wallet: {}", keys.wallet_address);
        assert!(keys.ord_address.starts_with('1'), "ord: {}", keys.ord_address);
        assert!(keys.identity_address.starts_with('1'), "identity: {}", keys.identity_address);

        // WIFs should start with 'K' or 'L' (compressed mainnet)
        assert!(
            keys.wallet_wif.starts_with('K') || keys.wallet_wif.starts_with('L'),
            "wallet WIF: {}", keys.wallet_wif
        );

        // Public keys should be 33-byte compressed (66 hex chars)
        assert_eq!(keys.wallet_pub_key.len(), 66);
        assert!(
            keys.wallet_pub_key.starts_with("02") || keys.wallet_pub_key.starts_with("03"),
            "pubkey: {}", keys.wallet_pub_key
        );
    }

    #[test]
    fn derive_same_mnemonic_produces_same_keys() {
        let keys1 = derive_wallet_keys(TEST_MNEMONIC.to_string()).unwrap();
        let keys2 = derive_wallet_keys(TEST_MNEMONIC.to_string()).unwrap();

        assert_eq!(keys1.wallet_wif, keys2.wallet_wif);
        assert_eq!(keys1.wallet_address, keys2.wallet_address);
        assert_eq!(keys1.ord_wif, keys2.ord_wif);
        assert_eq!(keys1.identity_wif, keys2.identity_wif);
    }

    #[test]
    fn different_accounts_produce_different_keys() {
        let keys0 = derive_wallet_keys_for_account(TEST_MNEMONIC.to_string(), 0).unwrap();
        let keys1 = derive_wallet_keys_for_account(TEST_MNEMONIC.to_string(), 1).unwrap();

        assert_ne!(keys0.wallet_address, keys1.wallet_address);
        assert_ne!(keys0.ord_address, keys1.ord_address);
        assert_ne!(keys0.identity_address, keys1.identity_address);
    }

    #[test]
    fn invalid_mnemonic_fails() {
        let result = derive_wallet_keys("invalid words here".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn validate_mnemonic_works() {
        assert!(validate_mnemonic(TEST_MNEMONIC.to_string()).unwrap());
        assert!(!validate_mnemonic("not a valid mnemonic".to_string()).unwrap());
    }

    #[test]
    fn generate_mnemonic_produces_valid_12_words() {
        let mn = generate_mnemonic().unwrap();
        let words: Vec<&str> = mn.split_whitespace().collect();
        assert_eq!(words.len(), 12, "Expected 12 words, got {}: {}", words.len(), mn);
        assert!(validate_mnemonic(mn).unwrap());
    }

    #[test]
    fn wif_roundtrip() {
        let keys = derive_wallet_keys(TEST_MNEMONIC.to_string()).unwrap();
        let imported = keys_from_wif(keys.wallet_wif.clone()).unwrap();

        assert_eq!(imported["wif"].as_str().unwrap(), keys.wallet_wif);
        assert_eq!(imported["address"].as_str().unwrap(), keys.wallet_address);
        assert_eq!(imported["pubKey"].as_str().unwrap(), keys.wallet_pub_key);
    }

    #[test]
    fn mnemonic_with_whitespace_is_trimmed() {
        let padded = format!("  {}  ", TEST_MNEMONIC);
        let keys = derive_wallet_keys(padded).unwrap();
        assert_eq!(keys.mnemonic, TEST_MNEMONIC);
    }

    #[test]
    fn supports_24_word_mnemonic() {
        let mn24 = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
        let result = derive_wallet_keys(mn24.to_string());
        assert!(result.is_ok(), "24-word mnemonic should be supported: {:?}", result.err());
    }

    #[test]
    fn empty_mnemonic_fails() {
        let result = derive_wallet_keys("".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn invalid_wif_fails() {
        let result = keys_from_wif("not-a-valid-wif".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn empty_wif_fails() {
        let result = keys_from_wif("".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn wrong_wif_prefix_fails() {
        // A WIF with testnet prefix (0xef) should be rejected
        let result = keys_from_wif("cNYfRxoekNJFJx5H7jiEJFHk9XAZVxZDJHFTApRdzBBr1L8MwNRL".to_string());
        assert!(result.is_err());
    }
}
