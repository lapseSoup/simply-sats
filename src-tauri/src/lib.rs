use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tauri_plugin_sql::{Migration, MigrationKind};

mod http_server;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let brc100_state: SharedBRC100State = Arc::new(Mutex::new(BRC100State::default()));
    let brc100_state_for_server = brc100_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::new()
            .add_migrations("sqlite:simplysats.db", include_migrations())
            .build())
        .manage(brc100_state)
        .invoke_handler(tauri::generate_handler![respond_to_brc100])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let state = brc100_state_for_server;

            // Start HTTP server in background
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async {
                    if let Err(e) = http_server::start_server(app_handle, state).await {
                        eprintln!("HTTP server error: {}", e);
                    }
                });
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
