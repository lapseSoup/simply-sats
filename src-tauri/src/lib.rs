use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tauri_plugin_sql::{Migration, MigrationKind};
use rand::distributions::Alphanumeric;
use rand::Rng;

mod http_server;

// Session state for HTTP server authentication
pub struct SessionState {
    pub token: String,
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
        Self { token }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let brc100_state: SharedBRC100State = Arc::new(Mutex::new(BRC100State::default()));
    let brc100_state_for_server = brc100_state.clone();

    // Generate session token for HTTP server authentication
    let session_state: SharedSessionState = Arc::new(Mutex::new(SessionState::new()));
    let session_state_for_server = session_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::new()
            .add_migrations("sqlite:simplysats.db", include_migrations())
            .build())
        .manage(brc100_state)
        .manage(session_state)
        .invoke_handler(tauri::generate_handler![respond_to_brc100, get_session_token])
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
