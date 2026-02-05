//! Secure Storage Module
//!
//! Provides secure storage operations for wallet data using Tauri's store plugin.
//! This keeps sensitive data out of browser-accessible localStorage.
//!
//! Security benefits:
//! - Data stored in app-specific file location (not accessible from web context)
//! - File permissions managed by OS
//! - Not accessible via JavaScript injection attacks

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const WALLET_STORE_PATH: &str = "secure_wallet.json";
const WALLET_KEY: &str = "wallet_data";

/// Encrypted wallet data structure (matches TypeScript EncryptedData)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedData {
    pub version: u32,
    pub salt: String,
    pub iv: String,
    pub data: String,
}

/// Save encrypted wallet data to secure storage
#[tauri::command]
pub async fn secure_storage_save(
    app: AppHandle,
    data: EncryptedData,
) -> Result<(), String> {
    let store = app
        .store(WALLET_STORE_PATH)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    // set() returns () - just call it
    store.set(
        WALLET_KEY.to_string(),
        serde_json::to_value(&data).map_err(|e| e.to_string())?
    );

    // save() returns Result<()>
    store
        .save()
        .map_err(|e| format!("Failed to persist store: {}", e))?;

    Ok(())
}

/// Load encrypted wallet data from secure storage
#[tauri::command]
pub async fn secure_storage_load(
    app: AppHandle,
) -> Result<Option<EncryptedData>, String> {
    let store = app
        .store(WALLET_STORE_PATH)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    match store.get(WALLET_KEY) {
        Some(value) => {
            let data: EncryptedData = serde_json::from_value(value.clone())
                .map_err(|e| format!("Failed to parse wallet data: {}", e))?;
            Ok(Some(data))
        }
        None => Ok(None),
    }
}

/// Check if wallet data exists in secure storage
#[tauri::command]
pub async fn secure_storage_exists(
    app: AppHandle,
) -> Result<bool, String> {
    let store = app
        .store(WALLET_STORE_PATH)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    Ok(store.has(WALLET_KEY))
}

/// Clear wallet data from secure storage
#[tauri::command]
pub async fn secure_storage_clear(
    app: AppHandle,
) -> Result<(), String> {
    let store = app
        .store(WALLET_STORE_PATH)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    // delete() returns bool - we don't need to check it
    store.delete(WALLET_KEY);

    // save() returns Result<()>
    store
        .save()
        .map_err(|e| format!("Failed to persist store: {}", e))?;

    Ok(())
}

/// Migrate data from localStorage to secure storage
/// Returns true if migration occurred, false if already migrated or no data to migrate
#[tauri::command]
pub async fn secure_storage_migrate(
    app: AppHandle,
    legacy_data: String,
) -> Result<bool, String> {
    // Check if we already have secure storage data
    let store = app
        .store(WALLET_STORE_PATH)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    if store.has(WALLET_KEY) {
        // Already migrated, no need to migrate again
        return Ok(false);
    }

    // Parse the legacy data
    let encrypted: EncryptedData = serde_json::from_str(&legacy_data)
        .map_err(|e| format!("Failed to parse legacy data: {}", e))?;

    // Save to secure storage - set() returns ()
    store.set(
        WALLET_KEY.to_string(),
        serde_json::to_value(&encrypted).map_err(|e| e.to_string())?
    );

    // save() returns Result<()>
    store
        .save()
        .map_err(|e| format!("Failed to persist store: {}", e))?;

    Ok(true)
}
