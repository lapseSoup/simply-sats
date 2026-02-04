use axum::{
    routing::post,
    http::{StatusCode, Method, HeaderValue, Request},
    body::Body,
    middleware::{self, Next},
    response::Response,
    Json, Router,
    extract::State,
};
use tower_http::cors::CorsLayer;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use crate::{SharedBRC100State, SharedSessionState};

const SESSION_TOKEN_HEADER: &str = "X-Simply-Sats-Token";

const PORT: u16 = 3322; // Simply Sats uses 3322 (Metanet Desktop uses 3321)

// Allowed origins for CORS - only localhost and Tauri webview
const ALLOWED_ORIGINS: &[&str] = &[
    "http://localhost",
    "http://localhost:1420",      // Vite dev server
    "http://127.0.0.1",
    "http://127.0.0.1:1420",
    "tauri://localhost",          // Tauri webview on macOS/Linux
    "https://tauri.localhost",    // Tauri webview on Windows
];

#[derive(Clone)]
struct AppState {
    app_handle: AppHandle,
    brc100_state: SharedBRC100State,
    session_state: SharedSessionState,
}

#[derive(Deserialize, Serialize, Debug, Default)]
#[serde(default)]
struct GetPublicKeyArgs {
    #[serde(rename = "identityKey")]
    identity_key: Option<bool>,
    #[serde(rename = "forSelf")]
    for_self: Option<bool>,
}

#[derive(Deserialize, Serialize, Debug, Default)]
#[serde(default)]
struct EmptyArgs {}

#[derive(Serialize)]
struct VersionResponse {
    version: String,
}

#[derive(Serialize)]
struct NetworkResponse {
    network: String,
}

#[derive(Serialize)]
struct AuthResponse {
    authenticated: bool,
}

#[derive(Serialize)]
struct HeightResponse {
    height: u32,
}

/// Middleware to validate session token on all requests except /getVersion
async fn validate_session_token(
    State(state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    // Allow getVersion without token for connection testing
    if request.uri().path() == "/getVersion" {
        return Ok(next.run(request).await);
    }

    let token_header = request
        .headers()
        .get(SESSION_TOKEN_HEADER)
        .and_then(|v| v.to_str().ok());

    let session = state.session_state.lock().await;

    match token_header {
        Some(token) if token == session.token => {
            drop(session);
            Ok(next.run(request).await)
        }
        _ => {
            eprintln!("Rejected request to {}: invalid or missing session token", request.uri().path());
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

pub async fn start_server(
    app_handle: AppHandle,
    brc100_state: SharedBRC100State,
    session_state: SharedSessionState,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state = AppState {
        app_handle,
        brc100_state,
        session_state,
    };

    // Configure CORS to only allow localhost and Tauri webview origins
    // This prevents malicious websites from accessing the wallet API
    let allowed_origins: Vec<HeaderValue> = ALLOWED_ORIGINS
        .iter()
        .filter_map(|origin| origin.parse().ok())
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::ACCEPT,
            axum::http::HeaderName::from_static("x-simply-sats-token"),
        ]);

    // REST-style routes matching HTTPWalletJSON substrate format from @bsv/sdk
    let app = Router::new()
        .route("/getVersion", post(handle_get_version))
        .route("/getNetwork", post(handle_get_network))
        .route("/isAuthenticated", post(handle_is_authenticated))
        .route("/waitForAuthentication", post(handle_wait_for_authentication))
        .route("/getHeight", post(handle_get_height))
        .route("/getPublicKey", post(handle_get_public_key))
        .route("/createSignature", post(handle_create_signature))
        .route("/createAction", post(handle_create_action))
        .route("/listOutputs", post(handle_list_outputs))
        // Simply Sats native locking (OP_PUSH_TX timelock)
        .route("/lockBSV", post(handle_lock_bsv))
        .route("/unlockBSV", post(handle_unlock_bsv))
        .route("/listLocks", post(handle_list_locks))
        .layer(middleware::from_fn_with_state(state.clone(), validate_session_token))
        .layer(cors)
        .with_state(state);

    let addr = format!("127.0.0.1:{}", PORT);
    println!("Starting BRC-100 HTTP-JSON server on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn handle_get_version(Json(_args): Json<EmptyArgs>) -> Json<VersionResponse> {
    println!("getVersion request");
    Json(VersionResponse {
        version: "0.1.0".to_string(),
    })
}

async fn handle_get_network(Json(_args): Json<EmptyArgs>) -> Json<NetworkResponse> {
    println!("getNetwork request");
    Json(NetworkResponse {
        network: "mainnet".to_string(),
    })
}

async fn handle_is_authenticated(Json(_args): Json<EmptyArgs>) -> Json<AuthResponse> {
    println!("isAuthenticated request");
    Json(AuthResponse {
        authenticated: true,
    })
}

async fn handle_wait_for_authentication(Json(_args): Json<EmptyArgs>) -> Json<AuthResponse> {
    println!("waitForAuthentication request");
    // Simply Sats is always authenticated when wallet is loaded
    Json(AuthResponse {
        authenticated: true,
    })
}

async fn handle_get_height(Json(_args): Json<EmptyArgs>) -> Json<HeightResponse> {
    println!("getHeight request");

    // Fetch real block height from WhatsOnChain
    let height = match fetch_block_height().await {
        Ok(h) => h,
        Err(e) => {
            eprintln!("Failed to fetch block height: {}, using fallback", e);
            880000 // Fallback value if API fails
        }
    };

    Json(HeightResponse { height })
}

async fn fetch_block_height() -> Result<u32, Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.whatsonchain.com/v1/bsv/main/chain/info")
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await?;

    let data: serde_json::Value = response.json().await?;
    let height = data["blocks"]
        .as_u64()
        .ok_or("Missing blocks field")? as u32;

    Ok(height)
}

async fn handle_get_public_key(
    State(state): State<AppState>,
    Json(args): Json<GetPublicKeyArgs>,
) -> (StatusCode, Json<serde_json::Value>) {
    println!("getPublicKey request: {:?}", args);
    forward_to_frontend(state, "getPublicKey", serde_json::json!({
        "identityKey": args.identity_key.unwrap_or(false),
    })).await
}

async fn handle_create_signature(
    State(state): State<AppState>,
    Json(args): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    println!("createSignature request: {:?}", args);
    forward_to_frontend(state, "createSignature", args).await
}

async fn handle_create_action(
    State(state): State<AppState>,
    Json(args): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    println!("createAction request: {:?}", args);
    forward_to_frontend(state, "createAction", args).await
}

async fn handle_list_outputs(
    State(state): State<AppState>,
    Json(args): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    println!("listOutputs request: {:?}", args);
    forward_to_frontend(state, "listOutputs", args).await
}

async fn handle_lock_bsv(
    State(state): State<AppState>,
    Json(args): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    println!("lockBSV request: {:?}", args);
    forward_to_frontend(state, "lockBSV", args).await
}

async fn handle_unlock_bsv(
    State(state): State<AppState>,
    Json(args): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    println!("unlockBSV request: {:?}", args);
    forward_to_frontend(state, "unlockBSV", args).await
}

async fn handle_list_locks(
    State(state): State<AppState>,
    Json(args): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    println!("listLocks request: {:?}", args);
    forward_to_frontend(state, "listLocks", args).await
}

async fn forward_to_frontend(
    state: AppState,
    method: &str,
    args: serde_json::Value,
) -> (StatusCode, Json<serde_json::Value>) {
    let internal_id = format!("req_{}", uuid_simple());
    let (tx, rx) = tokio::sync::oneshot::channel();

    {
        let mut brc100_state = state.brc100_state.lock().await;
        brc100_state.pending_responses.insert(internal_id.clone(), tx);
    }

    let frontend_request = serde_json::json!({
        "id": internal_id,
        "method": method,
        "params": args,
        "origin": "wrootz"
    });

    if let Err(e) = state.app_handle.emit("brc100-request", frontend_request) {
        eprintln!("Failed to emit brc100-request event: {}", e);
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
            "isError": true,
            "code": -32000,
            "message": "Internal error"
        })));
    }

    match tokio::time::timeout(std::time::Duration::from_secs(120), rx).await {
        Ok(Ok(response)) => {
            if let Some(error) = response.get("error") {
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
                    "isError": true,
                    "code": error.get("code").and_then(|c| c.as_i64()).unwrap_or(-32000),
                    "message": error.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown error")
                })));
            }

            if let Some(result) = response.get("result") {
                (StatusCode::OK, Json(result.clone()))
            } else {
                (StatusCode::OK, Json(response))
            }
        }
        Ok(Err(_)) => {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({
                "isError": true,
                "code": -32003,
                "message": "Request cancelled"
            })))
        }
        Err(_) => {
            let mut brc100_state = state.brc100_state.lock().await;
            brc100_state.pending_responses.remove(&internal_id);

            (StatusCode::BAD_REQUEST, Json(serde_json::json!({
                "isError": true,
                "code": -32000,
                "message": "Request timeout"
            })))
        }
    }
}

/// Generate a cryptographically secure unique request ID
/// Uses CSPRNG for unpredictability to prevent request ID prediction attacks
fn uuid_simple() -> String {
    use rand::Rng;
    use std::time::{SystemTime, UNIX_EPOCH};

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    // Use cryptographically secure random number generator
    let mut rng = rand::thread_rng();
    let random_part: u64 = rng.gen();

    format!("{}_{:016x}", timestamp, random_part)
}
