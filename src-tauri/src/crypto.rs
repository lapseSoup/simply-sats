//! Native Cryptographic Operations
//!
//! Provides PBKDF2 key derivation and AES-256-GCM encryption/decryption
//! as Tauri commands. This keeps decrypted plaintext (mnemonics, WIFs)
//! in native Rust memory rather than the webview's JavaScript heap,
//! which is significantly harder to extract via injection attacks.
//!
//! Wire format is byte-for-byte compatible with the TypeScript Web Crypto
//! implementation in `src/services/crypto.ts`.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

/// Current encryption format version (must match TypeScript CURRENT_VERSION)
const CURRENT_VERSION: u32 = 1;
/// PBKDF2 iterations — OWASP 2024 recommended minimum
const PBKDF2_ITERATIONS: u32 = 100_000;
/// Salt length in bytes (128 bits)
const SALT_LENGTH: usize = 16;
/// IV length in bytes (96 bits for AES-GCM)
const IV_LENGTH: usize = 12;
/// AES key length in bytes (256-bit)
const KEY_LENGTH: usize = 32;

/// Encrypted data envelope — matches TypeScript `EncryptedData` interface exactly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedData {
    pub version: u32,
    pub ciphertext: String,
    pub iv: String,
    pub salt: String,
    pub iterations: u32,
}

/// Derive a 256-bit AES key from a password using PBKDF2-HMAC-SHA256.
fn derive_key(password: &str, salt: &[u8], iterations: u32) -> [u8; KEY_LENGTH] {
    let mut key = [0u8; KEY_LENGTH];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations, &mut key);
    key
}

/// Encrypt plaintext with a password using PBKDF2 + AES-256-GCM.
///
/// Produces output byte-for-byte compatible with the TypeScript Web Crypto
/// implementation: same PBKDF2 parameters, same AES-GCM nonce size, same
/// base64 encoding of ciphertext (which includes the 16-byte auth tag
/// appended by AES-GCM, matching Web Crypto's default behavior).
#[tauri::command]
pub fn encrypt_data(plaintext: String, password: String) -> Result<EncryptedData, String> {
    // Generate random salt and IV
    let mut salt = [0u8; SALT_LENGTH];
    let mut iv = [0u8; IV_LENGTH];
    let mut rng = rand::thread_rng();
    rng.fill_bytes(&mut salt);
    rng.fill_bytes(&mut iv);

    // Derive key
    let key = derive_key(&password, &salt, PBKDF2_ITERATIONS);

    // Encrypt with AES-256-GCM
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&iv);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    Ok(EncryptedData {
        version: CURRENT_VERSION,
        ciphertext: BASE64.encode(&ciphertext),
        iv: BASE64.encode(iv),
        salt: BASE64.encode(salt),
        iterations: PBKDF2_ITERATIONS,
    })
}

/// Decrypt data encrypted by `encrypt_data` (or the TypeScript equivalent).
#[tauri::command]
pub fn decrypt_data(
    encrypted_data: EncryptedData,
    password: String,
) -> Result<String, String> {
    // Decode base64 fields
    let ciphertext = BASE64
        .decode(&encrypted_data.ciphertext)
        .map_err(|e| format!("Invalid ciphertext base64: {}", e))?;
    let iv = BASE64
        .decode(&encrypted_data.iv)
        .map_err(|e| format!("Invalid IV base64: {}", e))?;
    let salt = BASE64
        .decode(&encrypted_data.salt)
        .map_err(|e| format!("Invalid salt base64: {}", e))?;

    if iv.len() != IV_LENGTH {
        return Err(format!("Invalid IV length: expected {}, got {}", IV_LENGTH, iv.len()));
    }

    // Derive key using stored iterations for forward compatibility
    let key = derive_key(&password, &salt, encrypted_data.iterations);

    // Decrypt with AES-256-GCM
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&iv);
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "Decryption failed - invalid password or corrupted data".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8 in decrypted data: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let plaintext = "sensitive wallet data";
        let password = "testpassword123456";

        let encrypted = encrypt_data(plaintext.to_string(), password.to_string()).unwrap();
        let decrypted = decrypt_data(encrypted, password.to_string()).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn encrypt_produces_different_output_each_time() {
        let plaintext = "same data";
        let password = "testpassword123456";

        let e1 = encrypt_data(plaintext.to_string(), password.to_string()).unwrap();
        let e2 = encrypt_data(plaintext.to_string(), password.to_string()).unwrap();

        assert_ne!(e1.ciphertext, e2.ciphertext);
        assert_ne!(e1.iv, e2.iv);
        assert_ne!(e1.salt, e2.salt);
    }

    #[test]
    fn wrong_password_fails() {
        let encrypted =
            encrypt_data("secret".to_string(), "correctpassword1".to_string()).unwrap();
        let result = decrypt_data(encrypted, "wrongpassword123".to_string());

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Decryption failed"));
    }

    #[test]
    fn tampered_ciphertext_fails() {
        let mut encrypted =
            encrypt_data("secret".to_string(), "testpassword123456".to_string()).unwrap();
        // Tamper with the last 4 chars of ciphertext
        let len = encrypted.ciphertext.len();
        encrypted.ciphertext = format!("{}XXXX", &encrypted.ciphertext[..len - 4]);

        let result = decrypt_data(encrypted, "testpassword123456".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn version_and_iterations_correct() {
        let encrypted =
            encrypt_data("data".to_string(), "testpassword123456".to_string()).unwrap();
        assert_eq!(encrypted.version, CURRENT_VERSION);
        assert_eq!(encrypted.iterations, PBKDF2_ITERATIONS);
    }

    #[test]
    fn json_object_roundtrip() {
        let obj = r#"{"mnemonic":"test words","walletWif":"L123456"}"#;
        let password = "testpassword123456";

        let encrypted = encrypt_data(obj.to_string(), password.to_string()).unwrap();
        let decrypted = decrypt_data(encrypted, password.to_string()).unwrap();

        assert_eq!(decrypted, obj);
    }
}
