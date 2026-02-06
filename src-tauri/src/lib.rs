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
    record_successful_unlock, get_remaining_unlock_attempts,
    load_persisted_state
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

    /// Rotate the session token (call after state-changing operations)
    pub fn rotate_token(&mut self) -> String {
        self.token = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(48)
            .map(char::from)
            .collect();
        self.token.clone()
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

/// Get the platform-specific app data directory before Tauri is initialized.
/// Matches Tauri's default path resolution for the app identifier.
fn get_app_data_dir() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    {
        dirs::data_dir().map(|d| d.join("com.simplysats.wallet"))
    }
    #[cfg(target_os = "windows")]
    {
        dirs::data_dir().map(|d| d.join("com.simplysats.wallet"))
    }
    #[cfg(target_os = "linux")]
    {
        dirs::data_dir().map(|d| d.join("com.simplysats.wallet"))
    }
}

/// Pre-initialize the database for fresh installs.
///
/// tauri_plugin_sql hangs when migrations contain DML (INSERT/UPDATE/DELETE).
/// For existing databases, migrations are already applied so this is a no-op.
/// For fresh installs, we create the database with the final consolidated schema
/// and mark all migrations as applied, so the plugin skips them entirely.
fn pre_init_database(app_data_dir: &std::path::Path) {
    let db_path = app_data_dir.join("simplysats.db");

    // Only needed for fresh installs — existing DBs already have migrations applied
    if db_path.exists() {
        return;
    }

    // Ensure the directory exists
    if let Err(e) = std::fs::create_dir_all(app_data_dir) {
        eprintln!("Failed to create app data dir: {}", e);
        return;
    }

    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to create database: {}", e);
            return;
        }
    };

    // Execute the consolidated schema
    let schema = include_str!("../migrations/fresh_install_schema.sql");
    if let Err(e) = conn.execute_batch(schema) {
        eprintln!("Failed to execute schema: {}", e);
        // Clean up the broken DB file
        let _ = std::fs::remove_file(&db_path);
        return;
    }

    // Mark all 12 migrations as applied with their correct checksums
    // Checksums must match the SQL content exactly or tauri_plugin_sql will re-run them
    let migrations: Vec<(i64, &str, &str)> = vec![
        (1, "Initial database schema", "C00D163C545940AF1CB0E2DC1AABE4A8D66902CFDA8BAAE50DD8D091E4A4D22BD36389CC70B5F95308BB8C29A79C7211"),
        (2, "Derived addresses, address column, and transaction amount", "B74217698A1EA4F9FC2BEBA142D3ACDCFE288917C9BA51A1BEDD173C30A2B904585DF0ECE48EEA4DA6F0F849708F54D7"),
        (3, "Multi-account system", "3E5E2B8934DDE97181F53FCA6EA9AB41BDF2061CFE32370675F142BA76CE03786016AA932319E332521078D96A12B92E"),
        (4, "BSV20 token support", "22204B67014BB2AC66B6BE9CF4CA1E689373FFD6046E63E33E7BB07265148FE8D7211BBF3ED0D997D640F387F2B152B0"),
        (5, "Tagged key derivation and messaging", "E7B9D14B94C622E98E078742ED0E7A3C105D5060EB3D6ACE8026121E7EDDCDDF42D41212020FEC5EC49BA4C1835729DB"),
        (6, "UTXO pending/spent status tracking", "6871DBF8F89509446959E4D1CAE7EFB5F0F01395FACF3991207550AC97AA5A67E2D8F8FD744A5FDEAABF77EA4249AE3E"),
        (7, "Add timestamps to existing tables", "6365EB3E2A63A1270E7A458973E88D5FC6CC127565FFC0337D4C911B475CB7CE7B0384B8D145750683C577D35FEE7345"),
        (8, "Audit log for security monitoring", "0DF94DB4EE8188A37DC15B4859FCA8AF1D6E9AB78ECA503489FAC776F3435F42B4035C2F340B43EF73C02D5D09E66111"),
        (9, "Per-account transaction uniqueness", "C31E62D5BD11868743A22787E75AF75B7FC22D81DCEC20044BEA2657B341F2865E7F56060F0572DBF066191874E26884"),
        (10, "Reset transaction amounts for recalculation", "FC857C579014ED6348868FBCD45CD61B7EE6381FE4DFA0E75DB42BF737DEFF6BAEA906C0AFFB4F1026135F408F2C59B7"),
        (11, "Reset transaction amounts v2 (API fallback)", "091FFB058C9D7CC3C3017E12E680785572255990136F597C67ED018D49260864D13CA09301A2DE1C458F9A887BB0009E"),
        (12, "Clean up cross-account data contamination", "2E64BE0485EE42B15E900B7DF79FF2A2873E525402C903311E6D2AD35F92DB9EE293248131A67B93D053E53C8C75DA56"),
    ];

    for (version, description, checksum_hex) in migrations {
        let checksum = hex_to_bytes(checksum_hex);
        if let Err(e) = conn.execute(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (?1, ?2, 1, ?3, 0)",
            rusqlite::params![version, description, checksum],
        ) {
            eprintln!("Failed to insert migration {}: {}", version, e);
        }
    }
}

/// Convert hex string to bytes for migration checksums
fn hex_to_bytes(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0))
        .collect()
}

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
            description: "Derived addresses, address column, and transaction amount",
            sql: include_str!("../migrations/002_consolidated.sql"),
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
            description: "UTXO pending/spent status tracking",
            sql: include_str!("../migrations/006_utxo_pending_status.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "Add timestamps to existing tables",
            sql: include_str!("../migrations/007_add_timestamps.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "Audit log for security monitoring",
            sql: include_str!("../migrations/008_audit_log.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "Per-account transaction uniqueness",
            sql: include_str!("../migrations/009_tx_per_account.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "Reset transaction amounts for recalculation",
            sql: include_str!("../migrations/010_reset_tx_amounts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "Reset transaction amounts v2 (API fallback)",
            sql: include_str!("../migrations/011_reset_tx_amounts_v2.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "Clean up cross-account data contamination",
            sql: include_str!("../migrations/012_cleanup_cross_account.sql"),
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
    // Pre-initialize database for fresh installs BEFORE Tauri builder runs.
    // Must happen before tauri_plugin_sql plugin init, which runs migrations.
    // Uses platform-specific app data directory since Tauri isn't initialized yet.
    if let Some(app_data_dir) = get_app_data_dir() {
        pre_init_database(&app_data_dir);
    }

    let brc100_state: SharedBRC100State = Arc::new(Mutex::new(BRC100State::default()));
    let brc100_state_for_server = brc100_state.clone();

    // Generate session token for HTTP server authentication
    let session_state: SharedSessionState = Arc::new(Mutex::new(SessionState::new()));
    let session_state_for_server = session_state.clone();

    // Rate limiter state — initialized empty, loaded from disk in setup()
    let rate_limit_state: SharedRateLimitState = Arc::new(Mutex::new(RateLimitState::new()));
    let rate_limit_state_for_setup = rate_limit_state.clone();

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

            // Load persisted rate limit state from disk
            let persisted = load_persisted_state(&app_handle);
            let rate_limit_for_load = rate_limit_state_for_setup.clone();
            tauri::async_runtime::block_on(async move {
                let mut state = rate_limit_for_load.lock().await;
                *state = persisted;
            });

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
