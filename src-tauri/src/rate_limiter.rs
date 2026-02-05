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

/// Rate limit configuration constants
const MAX_ATTEMPTS: u32 = 5;
const BASE_LOCKOUT_MS: u64 = 1000; // 1 second
const MAX_LOCKOUT_MS: u64 = 300000; // 5 minutes
const RESET_AFTER_MS: u64 = 900000; // 15 minutes - reset if no attempts

/// Rate limit state stored in memory
#[derive(Debug, Clone, Default)]
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

pub type SharedRateLimitState = Arc<Mutex<RateLimitState>>;

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
    state: tauri::State<'_, SharedRateLimitState>,
) -> Result<CheckRateLimitResponse, String> {
    let mut rate_limit = state.lock().await;
    let (is_limited, remaining_ms) = rate_limit.check_limit();
    Ok(CheckRateLimitResponse {
        is_limited,
        remaining_ms,
    })
}

/// Tauri command: Record a failed unlock attempt
#[tauri::command]
pub async fn record_failed_unlock(
    state: tauri::State<'_, SharedRateLimitState>,
) -> Result<RecordFailedResponse, String> {
    let mut rate_limit = state.lock().await;
    let (is_locked, lockout_ms, attempts_remaining) = rate_limit.record_failed();

    if is_locked {
        eprintln!("[Security] Unlock locked out due to {} failed attempts, lockout: {}ms",
                  rate_limit.attempts, lockout_ms);
    } else {
        eprintln!("[Security] Failed unlock attempt {}/{}",
                  rate_limit.attempts, MAX_ATTEMPTS);
    }

    Ok(RecordFailedResponse {
        is_locked,
        lockout_ms,
        attempts_remaining,
    })
}

/// Tauri command: Record a successful unlock
#[tauri::command]
pub async fn record_successful_unlock(
    state: tauri::State<'_, SharedRateLimitState>,
) -> Result<(), String> {
    let mut rate_limit = state.lock().await;
    rate_limit.record_success();
    Ok(())
}

/// Tauri command: Get remaining attempts before lockout
#[tauri::command]
pub async fn get_remaining_unlock_attempts(
    state: tauri::State<'_, SharedRateLimitState>,
) -> Result<u32, String> {
    let mut rate_limit = state.lock().await;
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
