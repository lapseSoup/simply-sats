//! BRC-100 Signing & ECIES Operations
//!
//! Provides ECDSA signing/verification and ECIES encryption/decryption
//! as Tauri commands so that private keys never enter the webview.
//!
//! - Signing: SHA256(message) → ECDSA sign/verify (matches @bsv/sdk)
//! - ECIES: ECDH shared secret → SHA256 → AES-256-GCM encrypt/decrypt
//!   Wire format: |IV (32 bytes)|ciphertext|authTag (16 bytes)|

use aes_gcm::aead::generic_array::GenericArray;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::Aes256Gcm;
use rand::RngCore;
use secp256k1::{ecdsa::Signature, Message, PublicKey, Secp256k1, SecretKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Decode WIF (compressed mainnet) → 32-byte private key.
fn wif_to_privkey(wif: &str) -> Result<[u8; 32], String> {
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

/// Parse a compressed public key from hex (66 hex chars = 33 bytes).
fn parse_pubkey(hex_str: &str) -> Result<PublicKey, String> {
    let bytes = hex::decode(hex_str).map_err(|e| format!("Invalid pubkey hex: {}", e))?;
    PublicKey::from_slice(&bytes).map_err(|e| format!("Invalid public key: {}", e))
}

// ---------------------------------------------------------------------------
// ECDSA Signing / Verification
// ---------------------------------------------------------------------------

/// Sign a UTF-8 message with a WIF key.
///
/// Matches @bsv/sdk PrivateKey.sign(): SHA256(msg_bytes) → ECDSA sign → DER hex.
/// Low-S normalization is applied (standard for BSV).
#[tauri::command]
pub fn sign_message(wif: String, message: String) -> Result<String, String> {
    let secp = Secp256k1::new();
    let privkey_bytes = wif_to_privkey(&wif)?;
    let sk =
        SecretKey::from_slice(&privkey_bytes).map_err(|e| format!("Invalid private key: {}", e))?;

    let msg_bytes = message.as_bytes();
    let hash = Sha256::digest(msg_bytes);
    let msg = Message::from_digest(hash.into());

    let mut sig = secp.sign_ecdsa(&msg, &sk);
    sig.normalize_s();

    Ok(hex::encode(sig.serialize_der()))
}

/// Sign arbitrary byte data with a WIF key.
///
/// Matches @bsv/sdk PrivateKey.sign(data): SHA256(data) → ECDSA sign → DER hex.
#[tauri::command]
pub fn sign_data(wif: String, data: Vec<u8>) -> Result<String, String> {
    let secp = Secp256k1::new();
    let privkey_bytes = wif_to_privkey(&wif)?;
    let sk =
        SecretKey::from_slice(&privkey_bytes).map_err(|e| format!("Invalid private key: {}", e))?;

    let hash = Sha256::digest(&data);
    let msg = Message::from_digest(hash.into());

    let mut sig = secp.sign_ecdsa(&msg, &sk);
    sig.normalize_s();

    Ok(hex::encode(sig.serialize_der()))
}

/// Verify a DER-encoded signature over a UTF-8 message.
#[tauri::command]
pub fn verify_signature(
    public_key_hex: String,
    message: String,
    signature_hex: String,
) -> Result<bool, String> {
    if signature_hex.is_empty() {
        return Ok(false);
    }

    let pk = parse_pubkey(&public_key_hex)?;
    let sig_bytes =
        hex::decode(&signature_hex).map_err(|e| format!("Invalid signature hex: {}", e))?;
    let sig =
        Signature::from_der(&sig_bytes).map_err(|e| format!("Invalid DER signature: {}", e))?;

    let msg_bytes = message.as_bytes();
    let hash = Sha256::digest(msg_bytes);
    let msg = Message::from_digest(hash.into());

    let secp = Secp256k1::new();
    Ok(secp.verify_ecdsa(&msg, &sig, &pk).is_ok())
}

/// Verify a DER-encoded signature over raw byte data.
#[tauri::command]
pub fn verify_data_signature(
    public_key_hex: String,
    data: Vec<u8>,
    signature_hex: String,
) -> Result<bool, String> {
    if signature_hex.is_empty() {
        return Ok(false);
    }

    let pk = parse_pubkey(&public_key_hex)?;
    let sig_bytes =
        hex::decode(&signature_hex).map_err(|e| format!("Invalid signature hex: {}", e))?;
    let sig =
        Signature::from_der(&sig_bytes).map_err(|e| format!("Invalid DER signature: {}", e))?;

    let hash = Sha256::digest(&data);
    let msg = Message::from_digest(hash.into());

    let secp = Secp256k1::new();
    Ok(secp.verify_ecdsa(&msg, &sig, &pk).is_ok())
}

// ---------------------------------------------------------------------------
// ECIES Encryption / Decryption
// ---------------------------------------------------------------------------

/// Derive ECDH shared secret: privkey * pubkey → compressed point → SHA256.
///
/// Matches @bsv/sdk: deriveSharedSecret(pubkey).encode(true) → Hash.sha256()
fn ecdh_shared_key(
    secp: &Secp256k1<secp256k1::All>,
    sk: &SecretKey,
    remote_pk: &PublicKey,
) -> [u8; 32] {
    // EC point multiplication: shared_point = remote_pk * sk
    let mut shared_point = *remote_pk;
    shared_point = shared_point
        .mul_tweak(secp, &secp256k1::Scalar::from(sk.clone()))
        .expect("ECDH point multiplication failed");

    // Compressed encoding of the shared point (33 bytes)
    let compressed = shared_point.serialize();

    // SHA256 of compressed point → 32-byte symmetric key
    let hash = Sha256::digest(compressed);
    hash.into()
}

/// AES-256-GCM encrypt with 12-byte nonce (standard).
///
/// NOTE: The BSV SDK uses a 32-byte IV with a custom AES-GCM implementation.
/// Standard AES-GCM uses 12-byte nonce. To maintain compatibility with the
/// BSV SDK wire format (|32-byte IV|ciphertext|16-byte tag|), we use the
/// standard 12-byte nonce AES-GCM and pack/unpack the wire format to match.
///
/// For interop with the BSV SDK, we store: |12-byte nonce|20 zero bytes|ciphertext|16-byte tag|
/// This is compatible because the BSV SDK's custom AES-GCM processes the full
/// 32 bytes as IV via GHASH, but for our Rust-to-Rust path this is fine.
///
/// IMPORTANT: If full BSV SDK interop is needed, we'd need to implement
/// the custom 32-byte IV GCM mode. For now, this is Rust↔Rust only since
/// ECIES encryption/decryption both happen on the same side.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptResult {
    pub ciphertext: String,
    pub sender_public_key: String,
}

/// Encrypt plaintext using ECIES: ECDH → SHA256 → AES-256-GCM.
///
/// Wire format: |nonce (12 bytes)|ciphertext|authTag (16 bytes)|
/// Returns ciphertext as hex and the sender's public key.
#[tauri::command]
pub fn encrypt_ecies(
    wif: String,
    plaintext: String,
    recipient_pub_key: String,
    sender_pub_key: String,
) -> Result<EncryptResult, String> {
    let secp = Secp256k1::new();
    let privkey_bytes = wif_to_privkey(&wif)?;
    let sk =
        SecretKey::from_slice(&privkey_bytes).map_err(|e| format!("Invalid private key: {}", e))?;
    let remote_pk = parse_pubkey(&recipient_pub_key)?;

    // Derive shared symmetric key via ECDH + SHA256
    let shared_key = ecdh_shared_key(&secp, &sk, &remote_pk);

    // AES-256-GCM encrypt
    let cipher = Aes256Gcm::new(GenericArray::from_slice(&shared_key));

    // Generate 12-byte nonce (standard AES-GCM)
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = GenericArray::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // Pack into BSV SDK compatible format: |32-byte IV|ciphertext...|
    // We use |12-byte nonce|20 zero pad|encrypted_data_with_tag|
    // The encrypted_data from aes-gcm already includes the auth tag appended
    let mut wire = Vec::with_capacity(32 + ciphertext.len());
    wire.extend_from_slice(&nonce_bytes);
    wire.extend_from_slice(&[0u8; 20]); // pad to 32 bytes total IV
    wire.extend_from_slice(&ciphertext);

    Ok(EncryptResult {
        ciphertext: hex::encode(&wire),
        sender_public_key: sender_pub_key,
    })
}

/// Decrypt ECIES ciphertext: ECDH → SHA256 → AES-256-GCM decrypt.
///
/// Accepts ciphertext bytes in wire format: |nonce (12 bytes)|pad (20 bytes)|ciphertext|authTag|
#[tauri::command]
pub fn decrypt_ecies(
    wif: String,
    ciphertext_bytes: Vec<u8>,
    sender_pub_key: String,
) -> Result<String, String> {
    let secp = Secp256k1::new();
    let privkey_bytes = wif_to_privkey(&wif)?;
    let sk =
        SecretKey::from_slice(&privkey_bytes).map_err(|e| format!("Invalid private key: {}", e))?;
    let remote_pk = parse_pubkey(&sender_pub_key)?;

    // Derive shared symmetric key via ECDH + SHA256
    let shared_key = ecdh_shared_key(&secp, &sk, &remote_pk);

    // Unpack wire format: first 12 bytes = nonce, next 20 = padding, rest = ciphertext+tag
    if ciphertext_bytes.len() < 32 + 16 {
        return Err("Ciphertext too short".into());
    }

    let nonce_bytes = &ciphertext_bytes[..12];
    let encrypted_data = &ciphertext_bytes[32..]; // skip 32-byte IV header

    let cipher = Aes256Gcm::new(GenericArray::from_slice(&shared_key));
    let nonce = GenericArray::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, encrypted_data)
        .map_err(|e| format!("Decryption failed: {}", e))?;

    String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8 in plaintext: {}", e))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn get_test_wif() -> String {
        let keys = crate::key_derivation::derive_wallet_keys(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string()
        ).unwrap();
        keys.identity_wif
    }

    fn get_test_pubkey() -> String {
        let keys = crate::key_derivation::derive_wallet_keys(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string()
        ).unwrap();
        keys.identity_pub_key
    }

    #[test]
    fn sign_and_verify_message() {
        let wif = get_test_wif();
        let pubkey = get_test_pubkey();

        let sig = sign_message(wif, "Hello BSV".to_string()).unwrap();
        assert!(!sig.is_empty());

        let valid = verify_signature(pubkey.clone(), "Hello BSV".to_string(), sig.clone()).unwrap();
        assert!(valid);

        // Wrong message should fail
        let invalid =
            verify_signature(pubkey, "Wrong message".to_string(), sig).unwrap();
        assert!(!invalid);
    }

    #[test]
    fn sign_and_verify_data() {
        let wif = get_test_wif();
        let pubkey = get_test_pubkey();

        let data: Vec<u8> = vec![1, 2, 3, 4, 5, 6, 7, 8];
        let sig = sign_data(wif, data.clone()).unwrap();
        assert!(!sig.is_empty());

        let valid = verify_data_signature(pubkey.clone(), data.clone(), sig.clone()).unwrap();
        assert!(valid);

        // Wrong data should fail
        let invalid =
            verify_data_signature(pubkey, vec![9, 10, 11], sig).unwrap();
        assert!(!invalid);
    }

    #[test]
    fn verify_empty_signature_returns_false() {
        let pubkey = get_test_pubkey();
        let result = verify_signature(pubkey, "test".to_string(), "".to_string()).unwrap();
        assert!(!result);
    }

    #[test]
    fn ecies_roundtrip() {
        // Use two different account keys as sender and recipient
        let keys0 = crate::key_derivation::derive_wallet_keys_for_account(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string(),
            0
        ).unwrap();
        let keys1 = crate::key_derivation::derive_wallet_keys_for_account(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string(),
            1
        ).unwrap();

        let sender_wif = keys0.identity_wif.clone();
        let sender_pubkey = keys0.identity_pub_key.clone();
        let recipient_wif = keys1.identity_wif.clone();
        let recipient_pubkey = keys1.identity_pub_key.clone();

        // Encrypt with sender's key, recipient's public key
        let encrypted = encrypt_ecies(
            sender_wif,
            "Secret message".to_string(),
            recipient_pubkey,
            sender_pubkey.clone(),
        )
        .unwrap();

        assert!(!encrypted.ciphertext.is_empty());
        assert_eq!(encrypted.sender_public_key, sender_pubkey);

        // Decrypt with recipient's key, sender's public key
        let ciphertext_bytes =
            hex::decode(&encrypted.ciphertext).expect("ciphertext should be valid hex");
        let decrypted = decrypt_ecies(recipient_wif, ciphertext_bytes, sender_pubkey).unwrap();

        assert_eq!(decrypted, "Secret message");
    }

    #[test]
    fn ecies_wrong_key_fails() {
        let keys0 = crate::key_derivation::derive_wallet_keys_for_account(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string(),
            0
        ).unwrap();
        let keys1 = crate::key_derivation::derive_wallet_keys_for_account(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string(),
            1
        ).unwrap();

        let sender_wif = keys0.identity_wif.clone();
        let sender_pubkey = keys0.identity_pub_key.clone();
        let recipient_pubkey = keys1.identity_pub_key.clone();

        // Encrypt
        let encrypted = encrypt_ecies(
            sender_wif.clone(),
            "Secret".to_string(),
            recipient_pubkey,
            sender_pubkey.clone(),
        )
        .unwrap();

        // Try to decrypt with sender's key (wrong — should use recipient's key)
        let ciphertext_bytes =
            hex::decode(&encrypted.ciphertext).expect("ciphertext should be valid hex");
        let result = decrypt_ecies(sender_wif, ciphertext_bytes, sender_pubkey);

        assert!(result.is_err());
    }

    #[test]
    fn sign_message_deterministic() {
        let wif = get_test_wif();

        let sig1 = sign_message(wif.clone(), "determinism".to_string()).unwrap();
        let sig2 = sign_message(wif, "determinism".to_string()).unwrap();

        assert_eq!(sig1, sig2);
    }
}
