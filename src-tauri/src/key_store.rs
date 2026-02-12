//! Rust Key Store Module
//!
//! Stores wallet private keys (WIFs) in Rust-only memory, never exposing them
//! to the frontend JavaScript context. Keys are zeroized on Drop.
//!
//! The frontend receives only `PublicWalletKeys` (addresses + public keys).
//! All cryptographic operations that need private keys use `_from_store`
//! command variants that read keys from this store.

use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use zeroize::{Zeroize, Zeroizing};

use crate::key_derivation;
use crate::brc100_signing;
use crate::transaction;

/// Internal key storage — holds sensitive WIFs and mnemonic.
/// All fields are zeroized on Drop to prevent memory leakage.
pub struct KeyStoreInner {
    wallet_wif: Option<String>,
    ord_wif: Option<String>,
    identity_wif: Option<String>,
    mnemonic: Option<String>,
    // Public keys cached for quick access
    pub_keys: Option<PublicWalletKeys>,
}

impl Drop for KeyStoreInner {
    fn drop(&mut self) {
        self.clear();
    }
}

impl KeyStoreInner {
    pub fn new() -> Self {
        Self {
            wallet_wif: None,
            ord_wif: None,
            identity_wif: None,
            mnemonic: None,
            pub_keys: None,
        }
    }

    /// Clear all keys and zeroize sensitive data
    pub fn clear(&mut self) {
        if let Some(ref mut wif) = self.wallet_wif {
            wif.zeroize();
        }
        if let Some(ref mut wif) = self.ord_wif {
            wif.zeroize();
        }
        if let Some(ref mut wif) = self.identity_wif {
            wif.zeroize();
        }
        if let Some(ref mut m) = self.mnemonic {
            m.zeroize();
        }
        self.wallet_wif = None;
        self.ord_wif = None;
        self.identity_wif = None;
        self.mnemonic = None;
        self.pub_keys = None;
    }

    pub fn has_keys(&self) -> bool {
        self.wallet_wif.is_some()
    }

    /// Get the WIF for a given key type
    fn get_wif(&self, key_type: &str) -> Result<String, String> {
        match key_type {
            "wallet" => self.wallet_wif.clone().ok_or_else(|| "No wallet key stored".to_string()),
            "ord" | "ordinals" => self.ord_wif.clone().ok_or_else(|| "No ordinals key stored".to_string()),
            "identity" => self.identity_wif.clone().ok_or_else(|| "No identity key stored".to_string()),
            _ => Err(format!("Invalid key type: {}", key_type)),
        }
    }
}

/// Public-only wallet keys — safe to return to the frontend.
/// Contains addresses and public keys but NO private keys.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicWalletKeys {
    pub wallet_type: String,
    pub wallet_address: String,
    pub wallet_pub_key: String,
    pub ord_address: String,
    pub ord_pub_key: String,
    pub identity_address: String,
    pub identity_pub_key: String,
}

pub type SharedKeyStore = Arc<Mutex<KeyStoreInner>>;

// ==================== Tauri Commands ====================

/// Derive keys from mnemonic, store WIFs in Rust memory, return public keys only
#[tauri::command]
pub async fn store_keys(
    key_store: tauri::State<'_, SharedKeyStore>,
    mnemonic: String,
    account_index: Option<u32>,
) -> Result<PublicWalletKeys, String> {
    // Derive full keys using existing key_derivation module
    // Use Zeroizing wrapper for the mnemonic clone to ensure it's cleared after derivation
    let mnemonic_for_derive = Zeroizing::new(mnemonic.clone());
    let full_keys = if let Some(idx) = account_index {
        key_derivation::derive_wallet_keys_for_account((*mnemonic_for_derive).clone(), idx)?
    } else {
        key_derivation::derive_wallet_keys((*mnemonic_for_derive).clone())?
    };
    drop(mnemonic_for_derive);

    let pub_keys = PublicWalletKeys {
        wallet_type: full_keys.wallet_type.clone(),
        wallet_address: full_keys.wallet_address.clone(),
        wallet_pub_key: full_keys.wallet_pub_key.clone(),
        ord_address: full_keys.ord_address.clone(),
        ord_pub_key: full_keys.ord_pub_key.clone(),
        identity_address: full_keys.identity_address.clone(),
        identity_pub_key: full_keys.identity_pub_key.clone(),
    };

    // Store WIFs and mnemonic in Rust-only memory
    let mut store = key_store.lock().await;
    // Clear any existing keys first
    store.clear();
    store.wallet_wif = Some(full_keys.wallet_wif);
    store.ord_wif = Some(full_keys.ord_wif);
    store.identity_wif = Some(full_keys.identity_wif);
    store.mnemonic = Some(mnemonic);
    store.pub_keys = Some(pub_keys.clone());

    log::info!("Keys stored in Rust key store (account_index: {:?})", account_index);
    Ok(pub_keys)
}

/// Store pre-derived keys directly (for account switching where keys come from encrypted storage)
#[tauri::command]
pub async fn store_keys_direct(
    key_store: tauri::State<'_, SharedKeyStore>,
    wallet_wif: String,
    ord_wif: String,
    identity_wif: String,
    wallet_address: String,
    wallet_pub_key: String,
    ord_address: String,
    ord_pub_key: String,
    identity_address: String,
    identity_pub_key: String,
    mnemonic: Option<String>,
) -> Result<PublicWalletKeys, String> {
    let pub_keys = PublicWalletKeys {
        wallet_type: "yours".to_string(),
        wallet_address: wallet_address.clone(),
        wallet_pub_key: wallet_pub_key.clone(),
        ord_address: ord_address.clone(),
        ord_pub_key: ord_pub_key.clone(),
        identity_address: identity_address.clone(),
        identity_pub_key: identity_pub_key.clone(),
    };

    let mut store = key_store.lock().await;
    store.clear();
    store.wallet_wif = Some(wallet_wif);
    store.ord_wif = Some(ord_wif);
    store.identity_wif = Some(identity_wif);
    store.mnemonic = mnemonic;
    store.pub_keys = Some(pub_keys.clone());

    log::info!("Keys stored directly in Rust key store");
    Ok(pub_keys)
}

/// Clear all keys from the store (call on lock/logout)
#[tauri::command]
pub async fn clear_keys(
    key_store: tauri::State<'_, SharedKeyStore>,
) -> Result<(), String> {
    let mut store = key_store.lock().await;
    store.clear();
    log::info!("Keys cleared from Rust key store");
    Ok(())
}

/// Get public keys (returns None fields if no keys stored)
#[tauri::command]
pub async fn get_public_keys(
    key_store: tauri::State<'_, SharedKeyStore>,
) -> Result<Option<PublicWalletKeys>, String> {
    let store = key_store.lock().await;
    Ok(store.pub_keys.clone())
}

/// Check if keys are currently stored
#[tauri::command]
pub async fn has_keys(
    key_store: tauri::State<'_, SharedKeyStore>,
) -> Result<bool, String> {
    let store = key_store.lock().await;
    Ok(store.has_keys())
}

/// Get mnemonic once for backup display, then clear it from memory
#[tauri::command]
pub async fn get_mnemonic_once(
    key_store: tauri::State<'_, SharedKeyStore>,
) -> Result<Option<String>, String> {
    let mut store = key_store.lock().await;
    let mnemonic = store.mnemonic.clone();
    // Clear mnemonic from memory after retrieval
    if let Some(ref mut m) = store.mnemonic {
        m.zeroize();
    }
    store.mnemonic = None;
    Ok(mnemonic)
}

// ==================== Signing Commands (from store) ====================

/// Sign a message using a key from the store
#[tauri::command]
pub async fn sign_message_from_store(
    key_store: tauri::State<'_, SharedKeyStore>,
    message: String,
    key_type: String,
) -> Result<String, String> {
    let store = key_store.lock().await;
    let wif = Zeroizing::new(store.get_wif(&key_type)?);
    drop(store); // Release lock before signing
    brc100_signing::sign_message((*wif).clone(), message)
    // wif zeroized on drop
}

/// Sign raw data using a key from the store
#[tauri::command]
pub async fn sign_data_from_store(
    key_store: tauri::State<'_, SharedKeyStore>,
    data: Vec<u8>,
    key_type: String,
) -> Result<String, String> {
    let store = key_store.lock().await;
    let wif = Zeroizing::new(store.get_wif(&key_type)?);
    drop(store);
    brc100_signing::sign_data((*wif).clone(), data)
}

/// ECIES encrypt using a key from the store
#[tauri::command]
pub async fn encrypt_ecies_from_store(
    key_store: tauri::State<'_, SharedKeyStore>,
    plaintext: String,
    recipient_pub_key: String,
    sender_pub_key: String,
    key_type: String,
) -> Result<brc100_signing::EncryptResult, String> {
    let store = key_store.lock().await;
    let wif = Zeroizing::new(store.get_wif(&key_type)?);
    drop(store);
    brc100_signing::encrypt_ecies((*wif).clone(), plaintext, recipient_pub_key, sender_pub_key)
}

/// ECIES decrypt using a key from the store
#[tauri::command]
pub async fn decrypt_ecies_from_store(
    key_store: tauri::State<'_, SharedKeyStore>,
    ciphertext_bytes: Vec<u8>,
    sender_pub_key: String,
    key_type: String,
) -> Result<String, String> {
    let store = key_store.lock().await;
    let wif = Zeroizing::new(store.get_wif(&key_type)?);
    drop(store);
    brc100_signing::decrypt_ecies((*wif).clone(), ciphertext_bytes, sender_pub_key)
}

// ==================== Transaction Commands (from store) ====================

/// Build a P2PKH transaction using the wallet key from the store
#[tauri::command]
pub async fn build_p2pkh_tx_from_store(
    key_store: tauri::State<'_, SharedKeyStore>,
    to_address: String,
    satoshis: u64,
    selected_utxos: Vec<transaction::UtxoInput>,
    total_input: u64,
    fee_rate: f64,
) -> Result<transaction::BuiltTransactionResult, String> {
    let store = key_store.lock().await;
    let wif = Zeroizing::new(store.get_wif("wallet")?);
    drop(store);
    transaction::build_p2pkh_tx((*wif).clone(), to_address, satoshis, selected_utxos, total_input, fee_rate)
}

/// Build a multi-key P2PKH transaction using the wallet key for change
#[tauri::command]
pub async fn build_multi_key_p2pkh_tx_from_store(
    key_store: tauri::State<'_, SharedKeyStore>,
    to_address: String,
    satoshis: u64,
    selected_utxos: Vec<transaction::ExtendedUtxoInput>,
    total_input: u64,
    fee_rate: f64,
) -> Result<transaction::BuiltTransactionResult, String> {
    let store = key_store.lock().await;
    let wif = Zeroizing::new(store.get_wif("wallet")?);
    drop(store);
    transaction::build_multi_key_p2pkh_tx((*wif).clone(), to_address, satoshis, selected_utxos, total_input, fee_rate)
}

/// Build a consolidation transaction using the wallet key from the store
#[tauri::command]
pub async fn build_consolidation_tx_from_store(
    key_store: tauri::State<'_, SharedKeyStore>,
    utxos: Vec<transaction::UtxoInput>,
    fee_rate: f64,
) -> Result<transaction::BuiltConsolidationResult, String> {
    let store = key_store.lock().await;
    let wif = Zeroizing::new(store.get_wif("wallet")?);
    drop(store);
    transaction::build_consolidation_tx((*wif).clone(), utxos, fee_rate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_store_clear_zeroizes() {
        let mut store = KeyStoreInner::new();
        store.wallet_wif = Some("L1secret".to_string());
        store.mnemonic = Some("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string());
        assert!(store.has_keys());

        store.clear();
        assert!(!store.has_keys());
        assert!(store.wallet_wif.is_none());
        assert!(store.mnemonic.is_none());
    }

    #[test]
    fn test_get_wif_validates_key_type() {
        let mut store = KeyStoreInner::new();
        store.wallet_wif = Some("test_wif".to_string());
        store.ord_wif = Some("test_ord_wif".to_string());
        store.identity_wif = Some("test_id_wif".to_string());

        assert!(store.get_wif("wallet").is_ok());
        assert!(store.get_wif("ord").is_ok());
        assert!(store.get_wif("ordinals").is_ok());
        assert!(store.get_wif("identity").is_ok());
        assert!(store.get_wif("invalid").is_err());
    }

    #[test]
    fn test_get_wif_fails_when_empty() {
        let store = KeyStoreInner::new();
        assert!(store.get_wif("wallet").is_err());
    }
}
