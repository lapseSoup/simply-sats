//! Rate Limiter Module
//!
//! Implements exponential backoff for security-sensitive operations
//! like password unlock attempts to prevent brute-force attacks.
//!
//! This module stores state in memory (protected by Mutex) rather than
//! localStorage, preventing bypass through browser storage clearing.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use rand::Rng;

type HmacSha256 = Hmac<Sha256>;

/// Rate limit configuration constants
const MAX_ATTEMPTS: u32 = 5;
const BASE_LOCKOUT_MS: u64 = 1000; // 1 second
const MAX_LOCKOUT_MS: u64 = 300000; // 5 minutes
const RESET_AFTER_MS: u64 = 900000; // 15 minutes - reset if no attempts

/// Rate limit state stored in memory and persisted to disk
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RateLimitState {
    pub attempts: u32,
    pub last_attempt: u64,
    pub locked_until: u64,
}

impl RateLimitState {
    pub fn new() -> Self {
        Self {
            attempts: 0,
            last_attempt: 0,
            locked_until: 0,
        }
    }

    fn current_time_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }

    /// Calculate exponential backoff duration
    /// Doubles each time: 1s, 2s, 4s, 8s, 16s, up to max
    fn calculate_lockout_duration(attempts: u32) -> u64 {
        if attempts < MAX_ATTEMPTS {
            return 0;
        }
        let exponent = attempts - MAX_ATTEMPTS;
        let duration = BASE_LOCKOUT_MS * 2u64.pow(exponent);
        duration.min(MAX_LOCKOUT_MS)
    }

    /// Check if rate limited and return remaining time
    pub fn check_limit(&mut self) -> (bool, u64) {
        let now = Self::current_time_ms();

        // Reset if last attempt was more than 15 minutes ago
        if now > self.last_attempt + RESET_AFTER_MS && self.last_attempt > 0 {
            self.attempts = 0;
            self.last_attempt = 0;
            self.locked_until = 0;
            return (false, 0);
        }

        if self.locked_until > now {
            let remaining = self.locked_until - now;
            return (true, remaining);
        }

        (false, 0)
    }

    /// Record a failed attempt and return lockout status
    pub fn record_failed(&mut self) -> (bool, u64, u32) {
        let now = Self::current_time_ms();

        // Reset if last attempt was more than 15 minutes ago
        if now > self.last_attempt + RESET_AFTER_MS && self.last_attempt > 0 {
            self.attempts = 0;
            self.locked_until = 0;
        }

        self.attempts += 1;
        self.last_attempt = now;

        if self.attempts >= MAX_ATTEMPTS {
            let lockout_ms = Self::calculate_lockout_duration(self.attempts);
            self.locked_until = now + lockout_ms;
            return (true, lockout_ms, 0);
        }

        (false, 0, MAX_ATTEMPTS - self.attempts)
    }

    /// Record a successful attempt (resets counter)
    pub fn record_success(&mut self) {
        self.attempts = 0;
        self.last_attempt = 0;
        self.locked_until = 0;
    }

    /// Get remaining attempts before lockout
    pub fn remaining_attempts(&mut self) -> u32 {
        let now = Self::current_time_ms();

        // Reset if last attempt was more than 15 minutes ago
        if now > self.last_attempt + RESET_AFTER_MS && self.last_attempt > 0 {
            return MAX_ATTEMPTS;
        }

        if self.attempts >= MAX_ATTEMPTS {
            return 0;
        }

        MAX_ATTEMPTS - self.attempts
    }
}

const STORE_FILENAME: &str = "rate_limit.json";
const STORE_KEY: &str = "rate_limit_state";

/// Wrapper for persisted state with HMAC integrity check
#[derive(Serialize, Deserialize)]
struct PersistedRateLimitState {
    state: RateLimitState,
    hmac: String,
}

/// Compute HMAC-SHA256 over serialized state JSON
fn compute_state_hmac(state: &RateLimitState, key: &[u8]) -> String {
    let json = serde_json::to_string(state).unwrap_or_default();
    let mut mac = HmacSha256::new_from_slice(key)
        .expect("HMAC can take key of any size");
    mac.update(json.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Save rate limit state to persistent store with HMAC integrity
fn persist_state(app: &tauri::AppHandle, state: &RateLimitState, key: &[u8]) {
    if let Ok(store) = app.store(STORE_FILENAME) {
        let hmac = compute_state_hmac(state, key);
        let wrapper = PersistedRateLimitState {
            state: state.clone(),
            hmac,
        };
        let value = serde_json::to_value(wrapper).unwrap_or_default();
        let _ = store.set(STORE_KEY, value);
    }
}

/// Load rate limit state from persistent store, verifying HMAC integrity
pub fn load_persisted_state(app: &tauri::AppHandle, key: &[u8]) -> RateLimitState {
    if let Ok(store) = app.store(STORE_FILENAME) {
        if let Some(value) = store.get(STORE_KEY) {
            // Try new format (with HMAC)
            if let Ok(wrapper) = serde_json::from_value::<PersistedRateLimitState>(value.clone()) {
                let expected_hmac = compute_state_hmac(&wrapper.state, key);
                if wrapper.hmac == expected_hmac {
                    return wrapper.state;
                }
                log::warn!("[Security] Rate limit state HMAC mismatch — resetting to fresh state");
                return RateLimitState::new();
            }
            // Legacy migration: accept old format without HMAC, re-persist with HMAC on next save
            if let Ok(state) = serde_json::from_value::<RateLimitState>(value.clone()) {
                log::info!("Migrating legacy rate limit state to HMAC-protected format");
                persist_state(app, &state, key);
                return state;
            }
        }
    }
    RateLimitState::new()
}

/// Generate or load the HMAC integrity key from the app data directory.
///
/// On first launch, generates a random 32-byte key and persists it to disk.
/// On subsequent launches, reads the existing key. This prevents an attacker
/// with binary access from forging valid HMACs to reset the lockout counter,
/// since the key is unique per installation and not embedded in the binary.
pub fn get_or_create_integrity_key(app_data_dir: &std::path::Path) -> Vec<u8> {
    let key_path = app_data_dir.join(".rate-limit-key");

    // Try to read existing key
    if let Ok(key_bytes) = std::fs::read(&key_path) {
        if key_bytes.len() == 32 {
            return key_bytes;
        }
        log::warn!("[Security] Rate limit integrity key has unexpected length ({}), regenerating", key_bytes.len());
    }

    // Generate new random 32-byte key
    let key: Vec<u8> = (0..32).map(|_| rand::thread_rng().gen()).collect();

    // Ensure directory exists
    if let Some(parent) = key_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // Save to disk (best effort — if this fails, we'll regenerate next launch,
    // which means any existing HMAC-protected state will fail verification and reset)
    std::fs::write(&key_path, &key).unwrap_or_else(|e| {
        // Failing to persist the integrity key is security-critical: without it,
        // the rate limiter resets on every launch, enabling brute-force attacks.
        log::error!("[Security] FATAL: Cannot persist rate limit integrity key: {}", e);
        panic!("Cannot persist rate limit integrity key to {:?}: {}", key_path, e);
    });

    key
}

/// Manages rate limiting state with per-installation HMAC integrity key.
pub struct RateLimitManager {
    pub(crate) state: Mutex<RateLimitState>,
    pub(crate) integrity_key: Vec<u8>,
}

impl RateLimitManager {
    /// Create a new RateLimitManager with the given integrity key and initial state.
    pub fn new(integrity_key: Vec<u8>, initial_state: RateLimitState) -> Self {
        Self {
            state: Mutex::new(initial_state),
            integrity_key,
        }
    }
}

pub type SharedRateLimitManager = Arc<RateLimitManager>;

/// Response types for Tauri commands
#[derive(Serialize, Deserialize)]
pub struct CheckRateLimitResponse {
    pub is_limited: bool,
    pub remaining_ms: u64,
}

#[derive(Serialize, Deserialize)]
pub struct RecordFailedResponse {
    pub is_locked: bool,
    pub lockout_ms: u64,
    pub attempts_remaining: u32,
}

/// Tauri command: Check if unlock attempts are rate limited
#[tauri::command]
pub async fn check_unlock_rate_limit(
    manager: tauri::State<'_, SharedRateLimitManager>,
) -> Result<CheckRateLimitResponse, String> {
    let mut rate_limit = manager.state.lock().await;
    let (is_limited, remaining_ms) = rate_limit.check_limit();
    Ok(CheckRateLimitResponse {
        is_limited,
        remaining_ms,
    })
}

/// Tauri command: Record a failed unlock attempt
#[tauri::command]
pub async fn record_failed_unlock(
    app: tauri::AppHandle,
    manager: tauri::State<'_, SharedRateLimitManager>,
) -> Result<RecordFailedResponse, String> {
    let mut rate_limit = manager.state.lock().await;
    let (is_locked, lockout_ms, attempts_remaining) = rate_limit.record_failed();

    if is_locked {
        log::warn!("[Security] Unlock locked out due to {} failed attempts, lockout: {}ms",
                  rate_limit.attempts, lockout_ms);
    } else {
        log::info!("[Security] Failed unlock attempt {}/{}",
                  rate_limit.attempts, MAX_ATTEMPTS);
    }

    persist_state(&app, &rate_limit, &manager.integrity_key);

    Ok(RecordFailedResponse {
        is_locked,
        lockout_ms,
        attempts_remaining,
    })
}

/// Tauri command: Record a successful unlock
#[tauri::command]
pub async fn record_successful_unlock(
    app: tauri::AppHandle,
    manager: tauri::State<'_, SharedRateLimitManager>,
) -> Result<(), String> {
    let mut rate_limit = manager.state.lock().await;
    rate_limit.record_success();
    persist_state(&app, &rate_limit, &manager.integrity_key);
    Ok(())
}

/// Tauri command: Get remaining attempts before lockout
#[tauri::command]
pub async fn get_remaining_unlock_attempts(
    manager: tauri::State<'_, SharedRateLimitManager>,
) -> Result<u32, String> {
    let mut rate_limit = manager.state.lock().await;
    Ok(rate_limit.remaining_attempts())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_state() {
        let mut state = RateLimitState::new();
        assert_eq!(state.remaining_attempts(), MAX_ATTEMPTS);
        let (is_limited, _) = state.check_limit();
        assert!(!is_limited);
    }

    #[test]
    fn test_failed_attempts_before_lockout() {
        let mut state = RateLimitState::new();

        for i in 1..MAX_ATTEMPTS {
            let (is_locked, _, remaining) = state.record_failed();
            assert!(!is_locked);
            assert_eq!(remaining, MAX_ATTEMPTS - i);
        }
    }

    #[test]
    fn test_lockout_after_max_attempts() {
        let mut state = RateLimitState::new();

        for _ in 0..MAX_ATTEMPTS {
            state.record_failed();
        }

        let (is_limited, remaining_ms) = state.check_limit();
        assert!(is_limited);
        assert!(remaining_ms > 0);
    }

    #[test]
    fn test_success_resets_counter() {
        let mut state = RateLimitState::new();

        // Make some failed attempts
        for _ in 0..3 {
            state.record_failed();
        }

        // Success should reset
        state.record_success();
        assert_eq!(state.remaining_attempts(), MAX_ATTEMPTS);
    }

    #[test]
    fn test_exponential_backoff() {
        assert_eq!(RateLimitState::calculate_lockout_duration(5), 1000); // 1s
        assert_eq!(RateLimitState::calculate_lockout_duration(6), 2000); // 2s
        assert_eq!(RateLimitState::calculate_lockout_duration(7), 4000); // 4s
        assert_eq!(RateLimitState::calculate_lockout_duration(10), 32000); // 32s
        assert_eq!(RateLimitState::calculate_lockout_duration(20), MAX_LOCKOUT_MS); // capped at max
    }
}
