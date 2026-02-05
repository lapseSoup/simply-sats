use std::sync::Arc;
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tauri_plugin_sql::{Migration, MigrationKind};
use rand::distributions::Alphanumeric;
use rand::Rng;

mod http_server;
mod rate_limiter;
mod secure_storage;

use rate_limiter::{
    SharedRateLimitState, RateLimitState,
    check_unlock_rate_limit, record_failed_unlock,
    record_successful_unlock, get_remaining_unlock_attempts
};

use secure_storage::{
    secure_storage_save, secure_storage_load,
    secure_storage_exists, secure_storage_clear,
    secure_storage_migrate
};

// CSRF/Replay protection constants
const NONCE_EXPIRY_SECS: u64 = 300; // 5 minutes
const MAX_USED_NONCES: usize = 1000; // Prevent memory exhaustion

// Session state for HTTP server authentication
pub struct SessionState {
    pub token: String,
    pub csrf_secret: String,
    pub used_nonces: HashSet<String>,
    pub nonce_timestamps: Vec<(String, u64)>,
}

impl SessionState {
    pub fn new() -> Self {
        // Generate 48-character alphanumeric token using CSPRNG
        // 62 possible chars (a-z, A-Z, 0-9) = ~5.95 bits per char
        // 48 chars = ~286 bits of entropy (exceeds 256-bit security)
        let token: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(48)
            .map(char::from)
            .collect();

        // Generate separate CSRF secret for nonce generation
        let csrf_secret: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(32)
            .map(char::from)
            .collect();

        Self {
            token,
            csrf_secret,
            used_nonces: HashSet::new(),
            nonce_timestamps: Vec::new(),
        }
    }

    /// Generate a new CSRF nonce
    pub fn generate_nonce(&self) -> String {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let random: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(16)
            .map(char::from)
            .collect();

        format!("{}_{}", timestamp, random)
    }

    /// Validate and consume a nonce (returns true if valid)
    pub fn validate_nonce(&mut self, nonce: &str) -> bool {
        // Clean up expired nonces first
        self.cleanup_expired_nonces();

        // Check if already used
        if self.used_nonces.contains(nonce) {
            return false;
        }

        // Parse timestamp from nonce
        let parts: Vec<&str> = nonce.split('_').collect();
        if parts.len() != 2 {
            return false;
        }

        let nonce_time: u64 = match parts[0].parse() {
            Ok(t) => t,
            Err(_) => return false,
        };

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Check if nonce is expired
        if now > nonce_time + NONCE_EXPIRY_SECS {
            return false;
        }

        // Check if nonce is from the future (clock skew tolerance: 60s)
        if nonce_time > now + 60 {
            return false;
        }

        // Mark as used
        self.used_nonces.insert(nonce.to_string());
        self.nonce_timestamps.push((nonce.to_string(), nonce_time));

        true
    }

    /// Remove expired nonces from memory
    fn cleanup_expired_nonces(&mut self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Remove expired nonces
        self.nonce_timestamps.retain(|(nonce, timestamp)| {
            if now > *timestamp + NONCE_EXPIRY_SECS {
                self.used_nonces.remove(nonce);
                false
            } else {
                true
            }
        });

        // If still too many, remove oldest
        while self.nonce_timestamps.len() > MAX_USED_NONCES {
            if let Some((nonce, _)) = self.nonce_timestamps.first() {
                self.used_nonces.remove(nonce);
            }
            self.nonce_timestamps.remove(0);
        }
    }
}

pub type SharedSessionState = Arc<Mutex<SessionState>>;

// Database migrations
fn include_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "Initial database schema",
            sql: include_str!("../migrations/001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "Add amount column to transactions",
            sql: include_str!("../migrations/002_transaction_amount.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "Multi-account system",
            sql: include_str!("../migrations/003_accounts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "BSV20 token support",
            sql: include_str!("../migrations/004_tokens.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "Tagged key derivation and messaging",
            sql: include_str!("../migrations/005_tagged_keys.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "Audit log for security monitoring",
            sql: include_str!("../migrations/008_audit_log.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

// Shared state for BRC-100 requests
#[derive(Default)]
pub struct BRC100State {
    pub pending_responses: std::collections::HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>,
}

pub type SharedBRC100State = Arc<Mutex<BRC100State>>;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BRC100Request {
    pub id: String,
    pub method: String,
    pub params: serde_json::Value,
    pub origin: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BRC100Response {
    pub id: String,
    pub result: Option<serde_json::Value>,
    pub error: Option<BRC100Error>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BRC100Error {
    pub code: i32,
    pub message: String,
}

// Command to respond to a BRC-100 request from the frontend
#[tauri::command]
async fn respond_to_brc100(
    state: tauri::State<'_, SharedBRC100State>,
    request_id: String,
    response: serde_json::Value,
) -> Result<(), String> {
    let mut state = state.lock().await;
    if let Some(sender) = state.pending_responses.remove(&request_id) {
        sender.send(response).map_err(|_| "Failed to send response")?;
    }
    Ok(())
}

// Command to get the session token for frontend use
#[tauri::command]
async fn get_session_token(
    session_state: tauri::State<'_, SharedSessionState>,
) -> Result<String, String> {
    let session = session_state.lock().await;
    Ok(session.token.clone())
}

// Command to generate a CSRF nonce for state-changing operations
#[tauri::command]
async fn generate_csrf_nonce(
    session_state: tauri::State<'_, SharedSessionState>,
) -> Result<String, String> {
    let session = session_state.lock().await;
    Ok(session.generate_nonce())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let brc100_state: SharedBRC100State = Arc::new(Mutex::new(BRC100State::default()));
    let brc100_state_for_server = brc100_state.clone();

    // Generate session token for HTTP server authentication
    let session_state: SharedSessionState = Arc::new(Mutex::new(SessionState::new()));
    let session_state_for_server = session_state.clone();

    // Rate limiter state for unlock attempts (stored in memory, not localStorage)
    let rate_limit_state: SharedRateLimitState = Arc::new(Mutex::new(RateLimitState::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::new()
            .add_migrations("sqlite:simplysats.db", include_migrations())
            .build())
        .manage(brc100_state)
        .manage(session_state)
        .manage(rate_limit_state)
        .invoke_handler(tauri::generate_handler![
            respond_to_brc100,
            get_session_token,
            generate_csrf_nonce,
            check_unlock_rate_limit,
            record_failed_unlock,
            record_successful_unlock,
            get_remaining_unlock_attempts,
            secure_storage_save,
            secure_storage_load,
            secure_storage_exists,
            secure_storage_clear,
            secure_storage_migrate
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let brc100_state = brc100_state_for_server;
            let session_state = session_state_for_server;

            // Start HTTP server in background
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async {
                    if let Err(e) = http_server::start_server(app_handle, brc100_state, session_state).await {
                        eprintln!("HTTP server error: {}", e);
                    }
                });
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
