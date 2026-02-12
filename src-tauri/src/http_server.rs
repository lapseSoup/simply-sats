use axum::{
    routing::post,
    http::{StatusCode, Method, HeaderValue, Request},
    body::Body,
    middleware::{self, Next},
    response::{Response, IntoResponse},
    Json, Router,
    extract::State,
};
use tower_http::cors::CorsLayer;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use governor::{Quota, RateLimiter};
use std::num::NonZeroU32;
use std::sync::Arc;
use subtle::ConstantTimeEq;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use crate::{SharedBRC100State, SharedSessionState};

type HmacSha256 = Hmac<Sha256>;

const SESSION_TOKEN_HEADER: &str = "X-Simply-Sats-Token";
const CSRF_NONCE_HEADER: &str = "X-Simply-Sats-Nonce";

const PORT: u16 = 3322; // Simply Sats uses 3322 (Metanet Desktop uses 3321)

// Rate limiting configuration: 60 requests per minute
const RATE_LIMIT_PER_MINUTE: u32 = 60;

// Type alias for the rate limiter
type SharedRateLimiter = Arc<RateLimiter<governor::state::NotKeyed, governor::state::InMemoryState, governor::clock::DefaultClock>>;

// Allowed hosts for DNS rebinding protection (matched case-insensitively)
const ALLOWED_HOSTS: &[&str] = &[
    "127.0.0.1",
    "localhost",
    "127.0.0.1:3322",
    "localhost:3322",
    "[::1]",
    "[::1]:3322",
];

// Allowed origins for CORS - Tauri webview and integrated apps
// Dev server ports (1420, 3000, 3001) only included in debug builds
#[cfg(debug_assertions)]
const ALLOWED_ORIGINS: &[&str] = &[
    "http://localhost",
    "http://localhost:1420",      // Vite dev server
    "http://localhost:3000",      // Next.js dev server (Wrootz)
    "http://localhost:3001",      // Next.js alternate port
    "http://127.0.0.1",
    "http://127.0.0.1:1420",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "tauri://localhost",          // Tauri webview on macOS/Linux
    "https://tauri.localhost",    // Tauri webview on Windows
];

#[cfg(not(debug_assertions))]
const ALLOWED_ORIGINS: &[&str] = &[
    "http://localhost",
    "http://127.0.0.1",
    "tauri://localhost",          // Tauri webview on macOS/Linux
    "https://tauri.localhost",    // Tauri webview on Windows
];

#[derive(Clone)]
struct AppState {
    app_handle: AppHandle,
    brc100_state: SharedBRC100State,
    session_state: SharedSessionState,
    rate_limiter: SharedRateLimiter,
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

/// Middleware to validate Host header for DNS rebinding protection
async fn validate_host_header(
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let host = request.headers()
        .get("Host")
        .and_then(|v| v.to_str().ok());

    match host {
        Some(h) if ALLOWED_HOSTS.iter().any(|allowed| h.eq_ignore_ascii_case(allowed)) => {
            Ok(next.run(request).await)
        }
        _ => {
            log::warn!("[Security] Rejected request: invalid Host header: {:?}", host);
            Err(StatusCode::FORBIDDEN)
        }
    }
}

/// Middleware to validate session token and apply rate limiting
async fn validate_session_token(
    State(state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let token_header = request
        .headers()
        .get(SESSION_TOKEN_HEADER)
        .and_then(|v| v.to_str().ok());

    let session = state.session_state.lock().await;

    match token_header {
        Some(token) => {
            // Use constant-time comparison to prevent timing attacks
            let token_bytes = token.as_bytes();
            let session_bytes = session.token.as_bytes();
            let is_valid = token_bytes.len() == session_bytes.len()
                && token_bytes.ct_eq(session_bytes).into();
            let is_expired = session.is_token_expired();

            drop(session);

            if is_valid {
                // Apply rate limiting after authentication
                match state.rate_limiter.check() {
                    Ok(_) => {
                        let mut response = next.run(request).await;
                        // Auto-rotate expired tokens — include new token in response header
                        if is_expired {
                            let mut session = state.session_state.lock().await;
                            let new_token = session.rotate_token();
                            if let Ok(hv) = HeaderValue::from_str(&new_token) {
                                response.headers_mut().insert("X-Simply-Sats-New-Token", hv);
                            }
                        }
                        Ok(response)
                    },
                    Err(_) => {
                        log::warn!("[Rate Limit] Request to {} exceeded rate limit", request.uri().path());
                        Err(StatusCode::TOO_MANY_REQUESTS)
                    }
                }
            } else {
                log::warn!("Rejected request to {}: invalid session token", request.uri().path());
                Err(StatusCode::UNAUTHORIZED)
            }
        }
        None => {
            log::warn!("Rejected request to {}: missing session token", request.uri().path());
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

pub async fn start_server(
    app_handle: AppHandle,
    brc100_state: SharedBRC100State,
    session_state: SharedSessionState,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Create rate limiter: RATE_LIMIT_PER_MINUTE requests per minute
    let quota = Quota::per_minute(NonZeroU32::new(RATE_LIMIT_PER_MINUTE).unwrap());
    let rate_limiter = Arc::new(RateLimiter::direct(quota));

    let state = AppState {
        app_handle,
        brc100_state,
        session_state,
        rate_limiter,
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
            axum::http::HeaderName::from_static("x-simply-sats-nonce"),
        ])
        .expose_headers([
            axum::http::HeaderName::from_static("x-simply-sats-new-token"),
            axum::http::HeaderName::from_static("x-simply-sats-signature"),
        ]);

    // Security response headers middleware
    let security_headers = axum::middleware::from_fn(|request: Request<Body>, next: Next| async move {
        let mut response = next.run(request).await;
        let headers = response.headers_mut();
        headers.insert("X-Content-Type-Options", HeaderValue::from_static("nosniff"));
        headers.insert("X-Frame-Options", HeaderValue::from_static("DENY"));
        headers.insert("Cache-Control", HeaderValue::from_static("no-store"));
        response
    });

    // Response HMAC signing middleware — signs response body with session token
    let sign_state = state.clone();
    let response_signing = axum::middleware::from_fn(move |request: Request<Body>, next: Next| {
        let sign_state = sign_state.clone();
        async move {
            let response = next.run(request).await;
            let (mut parts, body) = response.into_parts();

            // Read the response body
            match axum::body::to_bytes(body, 10 * 1024 * 1024).await {
                Ok(body_bytes) => {
                    // Compute HMAC-SHA256 using session token as key
                    let session = sign_state.session_state.lock().await;
                    let mut mac = HmacSha256::new_from_slice(session.token.as_bytes())
                        .expect("HMAC can take key of any size");
                    mac.update(&body_bytes);
                    let signature = hex::encode(mac.finalize().into_bytes());
                    drop(session);

                    if let Ok(hv) = HeaderValue::from_str(&signature) {
                        parts.headers.insert("X-Simply-Sats-Signature", hv);
                    }

                    Response::from_parts(parts, Body::from(body_bytes))
                }
                Err(_) => {
                    // If body can't be read, return as-is without signature
                    Response::from_parts(parts, Body::empty())
                }
            }
        }
    });

    // REST-style routes matching HTTPWalletJSON substrate format from @bsv/sdk
    let v1_routes = Router::new()
        .route("/getVersion", post(handle_get_version))
        .route("/getNetwork", post(handle_get_network))
        .route("/isAuthenticated", post(handle_is_authenticated))
        .route("/waitForAuthentication", post(handle_wait_for_authentication))
        .route("/getHeight", post(handle_get_height))
        .route("/getNonce", post(handle_get_nonce))
        .route("/getPublicKey", post(handle_get_public_key))
        .route("/createSignature", post(handle_create_signature))
        .route("/createAction", post(handle_create_action))
        .route("/listOutputs", post(handle_list_outputs))
        .route("/lockBSV", post(handle_lock_bsv))
        .route("/unlockBSV", post(handle_unlock_bsv))
        .route("/listLocks", post(handle_list_locks));

    // Legacy routes at root (backward compat) + versioned routes under /v1
    let app = Router::new()
        .merge(v1_routes.clone())
        .nest("/v1", v1_routes)
        .layer(response_signing)
        .layer(middleware::from_fn_with_state(state.clone(), validate_session_token))
        .layer(middleware::from_fn(validate_host_header))
        .layer(security_headers)
        .layer(cors)
        .with_state(state);

    let addr = format!("127.0.0.1:{}", PORT);
    log::info!("Starting BRC-100 HTTP-JSON server on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn handle_get_version(Json(_args): Json<EmptyArgs>) -> Json<VersionResponse> {
    log::debug!("getVersion request");
    Json(VersionResponse {
        version: "0.1.0".to_string(),
    })
}

#[derive(Serialize)]
struct NonceResponse {
    nonce: String,
}

/// Generate a CSRF nonce for state-changing operations
async fn handle_get_nonce(
    State(state): State<AppState>,
    Json(_args): Json<EmptyArgs>,
) -> Json<NonceResponse> {
    log::debug!("getNonce request");
    let session = state.session_state.lock().await;
    Json(NonceResponse {
        nonce: session.generate_nonce(),
    })
}

async fn handle_get_network(Json(_args): Json<EmptyArgs>) -> Json<NetworkResponse> {
    log::debug!("getNetwork request");
    Json(NetworkResponse {
        network: "mainnet".to_string(),
    })
}

async fn handle_is_authenticated(Json(_args): Json<EmptyArgs>) -> Json<AuthResponse> {
    log::debug!("isAuthenticated request");
    Json(AuthResponse {
        authenticated: true,
    })
}

async fn handle_wait_for_authentication(Json(_args): Json<EmptyArgs>) -> Json<AuthResponse> {
    log::debug!("waitForAuthentication request");
    // Simply Sats is always authenticated when wallet is loaded
    Json(AuthResponse {
        authenticated: true,
    })
}

async fn handle_get_height(Json(_args): Json<EmptyArgs>) -> Json<HeightResponse> {
    log::debug!("getHeight request");

    // Fetch real block height from WhatsOnChain
    let height = match fetch_block_height().await {
        Ok(h) => h,
        Err(e) => {
            // Estimate block height based on time since genesis
            // BSV genesis: Jan 3, 2009, ~10 min/block average
            use std::time::{SystemTime, UNIX_EPOCH};
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let genesis_time: u64 = 1231006505; // Jan 3, 2009
            let avg_block_time: u64 = 600; // 10 minutes in seconds
            let estimated = ((now - genesis_time) / avg_block_time) as u32;
            log::warn!("Failed to fetch block height: {}, using estimated: {}", e, estimated);
            estimated
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
    request: Request<Body>,
) -> Response {
    let origin = extract_origin(&request);

    let body_bytes = match axum::body::to_bytes(request.into_body(), 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "isError": true,
            "code": -32700,
            "message": "Invalid request body"
        }))).into_response(),
    };

    let args: GetPublicKeyArgs = match serde_json::from_slice(&body_bytes) {
        Ok(v) => v,
        Err(_) => GetPublicKeyArgs::default(),
    };

    log::debug!("getPublicKey request: {:?}", args);
    forward_to_frontend(state, "getPublicKey", serde_json::json!({
        "identityKey": args.identity_key.unwrap_or(false),
    }), origin).await
}

/// Extract origin from request headers
fn extract_origin(request: &Request<Body>) -> Option<String> {
    request.headers()
        .get("Origin")
        .or_else(|| request.headers().get("Referer"))
        .and_then(|v| v.to_str().ok())
        .and_then(|s| {
            // Parse and reconstruct origin to prevent validation bypass
            match url::Url::parse(s) {
                Ok(url) => Some(format!("{}://{}", url.scheme(), url.host_str().unwrap_or("unknown"))),
                Err(_) => {
                    log::warn!("Rejected unparseable origin header: {}", s);
                    None
                }
            }
        })
}

/// Validate that the request origin is in the allowed list (for state-changing operations)
fn validate_origin(origin: &Option<String>) -> Result<(), Response> {
    match origin {
        Some(ref o) if ALLOWED_ORIGINS.iter().any(|allowed| o == *allowed) => Ok(()),
        Some(ref o) => {
            log::warn!("[Security] Rejected request: origin not in whitelist: {}", o);
            Err((StatusCode::FORBIDDEN, Json(serde_json::json!({
                "isError": true,
                "code": -32002,
                "message": "Origin not allowed"
            }))).into_response())
        }
        None => {
            log::warn!("[Security] Rejected request: missing Origin header");
            Err((StatusCode::FORBIDDEN, Json(serde_json::json!({
                "isError": true,
                "code": -32002,
                "message": "Missing Origin header"
            }))).into_response())
        }
    }
}

/// Extract CSRF nonce from request headers
fn extract_nonce(request: &Request<Body>) -> Option<String> {
    request.headers()
        .get(CSRF_NONCE_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// Validate a nonce string against the session state
async fn validate_nonce(state: &AppState, nonce: Option<String>) -> Result<(), Response> {
    match nonce {
        Some(nonce_str) => {
            let mut session = state.session_state.lock().await;
            if session.validate_nonce(&nonce_str) {
                Ok(())
            } else {
                log::warn!("Invalid or expired CSRF nonce");
                Err((StatusCode::FORBIDDEN, Json(serde_json::json!({
                    "isError": true,
                    "code": -32001,
                    "message": "Invalid or expired CSRF nonce"
                }))).into_response())
            }
        }
        None => {
            log::warn!("Missing CSRF nonce header");
            Err((StatusCode::FORBIDDEN, Json(serde_json::json!({
                "isError": true,
                "code": -32001,
                "message": "Missing CSRF nonce"
            }))).into_response())
        }
    }
}

async fn handle_create_signature(
    State(state): State<AppState>,
    request: Request<Body>,
) -> Response {
    // Extract origin and nonce before consuming the request body
    let origin = extract_origin(&request);
    let nonce = extract_nonce(&request);

    // Validate origin for this state-changing operation
    if let Err(err) = validate_origin(&origin) {
        return err;
    }

    // Validate CSRF nonce for this state-changing operation
    if let Err(err) = validate_nonce(&state, nonce).await {
        return err;
    }

    // Parse the body manually since we already borrowed the request
    let body_bytes = match axum::body::to_bytes(request.into_body(), 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "isError": true,
            "code": -32700,
            "message": "Invalid request body"
        }))).into_response(),
    };

    let args: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "isError": true,
            "code": -32700,
            "message": "Invalid JSON"
        }))).into_response(),
    };

    log::debug!("createSignature request: {:?}", args);
    forward_to_frontend_with_rotation(state, "createSignature", args, origin).await
}

async fn handle_create_action(
    State(state): State<AppState>,
    request: Request<Body>,
) -> Response {
    let origin = extract_origin(&request);
    let nonce = extract_nonce(&request);

    // Validate origin for this state-changing operation
    if let Err(err) = validate_origin(&origin) {
        return err;
    }

    // Validate CSRF nonce for this state-changing operation
    if let Err(err) = validate_nonce(&state, nonce).await {
        return err;
    }

    let body_bytes = match axum::body::to_bytes(request.into_body(), 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "isError": true,
            "code": -32700,
            "message": "Invalid request body"
        }))).into_response(),
    };

    let args: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "isError": true,
            "code": -32700,
            "message": "Invalid JSON"
        }))).into_response(),
    };

    log::debug!("createAction request: {:?}", args);
    forward_to_frontend_with_rotation(state, "createAction", args, origin).await
}

async fn handle_list_outputs(
    State(state): State<AppState>,
    request: Request<Body>,
) -> Response {
    let origin = extract_origin(&request);
    let nonce = extract_nonce(&request);

    // Validate origin — read endpoints can leak sensitive UTXO data
    if let Err(err) = validate_origin(&origin) {
        return err;
    }

    // Validate CSRF nonce — read endpoints can still leak sensitive data
    if let Err(err) = validate_nonce(&state, nonce).await {
        return err;
    }

    let body_bytes = match axum::body::to_bytes(request.into_body(), 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "isError": true,
            "code": -32700,
            "message": "Invalid request body"
        }))).into_response(),
    };

    let args: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "isError": true,
            "code": -32700,
            "message": "Invalid JSON"
        }))).into_response(),
    };

    log::debug!("listOutputs request: {:?}", args);
    forward_to_frontend(state, "listOutputs", args, origin).await
}

async fn handle_lock_bsv(
    State(state): State<AppState>,
    request: Request<Body>,
) -> Response {
    let origin = extract_origin(&request);
    let nonce = extract_nonce(&request);

    // Validate origin for this state-changing operation
    if let Err(err) = validate_origin(&origin) {
        return err;
    }

    // Validate CSRF nonce for this state-changing operation
    if let Err(err) = validate_nonce(&state, nonce).await {
        return err;
    }

    let body_bytes = match axum::body::to_bytes(request.into_body(), 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "isError": true,
            "code": -32700,
            "message": "Invalid request body"
        }))).into_response(),
    };

    let args: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "isError": true,
            "code": -32700,
            "message": "Invalid JSON"
        }))).into_response(),
    };

    log::debug!("lockBSV request: {:?}", args);
    forward_to_frontend_with_rotation(state, "lockBSV", args, origin).await
}

async fn handle_unlock_bsv(
    State(state): State<AppState>,
    request: Request<Body>,
) -> Response {
    let origin = extract_origin(&request);
    let nonce = extract_nonce(&request);

    // Validate origin for this state-changing operation
    if let Err(err) = validate_origin(&origin) {
        return err;
    }

    // Validate CSRF nonce for this state-changing operation
    if let Err(err) = validate_nonce(&state, nonce).await {
        return err;
    }

    let body_bytes = match axum::body::to_bytes(request.into_body(), 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "isError": true,
            "code": -32700,
            "message": "Invalid request body"
        }))).into_response(),
    };

    let args: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "isError": true,
            "code": -32700,
            "message": "Invalid JSON"
        }))).into_response(),
    };

    log::debug!("unlockBSV request: {:?}", args);
    forward_to_frontend_with_rotation(state, "unlockBSV", args, origin).await
}

async fn handle_list_locks(
    State(state): State<AppState>,
    request: Request<Body>,
) -> Response {
    let origin = extract_origin(&request);
    let nonce = extract_nonce(&request);

    // Validate origin — read endpoints can leak sensitive lock data
    if let Err(err) = validate_origin(&origin) {
        return err;
    }

    // Validate CSRF nonce — read endpoints can still leak sensitive data
    if let Err(err) = validate_nonce(&state, nonce).await {
        return err;
    }

    let body_bytes = match axum::body::to_bytes(request.into_body(), 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "isError": true,
            "code": -32700,
            "message": "Invalid request body"
        }))).into_response(),
    };

    let args: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "isError": true,
            "code": -32700,
            "message": "Invalid JSON"
        }))).into_response(),
    };

    log::debug!("listLocks request: {:?}", args);
    forward_to_frontend(state, "listLocks", args, origin).await
}

async fn forward_to_frontend(
    state: AppState,
    method: &str,
    args: serde_json::Value,
    origin: Option<String>,
) -> Response {
    forward_to_frontend_impl(state, method, args, origin, false).await
}

async fn forward_to_frontend_with_rotation(
    state: AppState,
    method: &str,
    args: serde_json::Value,
    origin: Option<String>,
) -> Response {
    forward_to_frontend_impl(state, method, args, origin, true).await
}

async fn forward_to_frontend_impl(
    state: AppState,
    method: &str,
    args: serde_json::Value,
    origin: Option<String>,
    rotate_token: bool,
) -> Response {
    let internal_id = format!("req_{}", uuid_simple());
    let (tx, rx) = tokio::sync::oneshot::channel();

    {
        let mut brc100_state = state.brc100_state.lock().await;
        brc100_state.pending_responses.insert(internal_id.clone(), tx);
    }

    // Use actual origin from request, default to "unknown" if not provided
    let request_origin = origin.unwrap_or_else(|| "unknown".to_string());

    // Include account_id from session state for account-scoped request handling
    let account_id = {
        let session = state.session_state.lock().await;
        session.account_id
    };

    let frontend_request = serde_json::json!({
        "id": internal_id,
        "method": method,
        "params": args,
        "origin": request_origin,
        "accountId": account_id
    });

    if let Err(e) = state.app_handle.emit("brc100-request", frontend_request) {
        log::error!("Failed to emit brc100-request event: {}", e);
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
            "isError": true,
            "code": -32000,
            "message": "Internal error"
        }))).into_response();
    }

    match tokio::time::timeout(std::time::Duration::from_secs(120), rx).await {
        Ok(Ok(response)) => {
            if let Some(error) = response.get("error") {
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
                    "isError": true,
                    "code": error.get("code").and_then(|c| c.as_i64()).unwrap_or(-32000),
                    "message": error.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown error")
                }))).into_response();
            }

            let json_body = if let Some(result) = response.get("result") {
                Json(result.clone())
            } else {
                Json(response)
            };

            // Rotate session token after successful state-changing operations
            if rotate_token {
                let mut session = state.session_state.lock().await;
                let new_token = session.rotate_token();
                let mut resp = (StatusCode::OK, json_body).into_response();
                if let Ok(hv) = HeaderValue::from_str(&new_token) {
                    resp.headers_mut().insert("X-Simply-Sats-New-Token", hv);
                }
                resp
            } else {
                (StatusCode::OK, json_body).into_response()
            }
        }
        Ok(Err(_)) => {
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({
                "isError": true,
                "code": -32003,
                "message": "Request cancelled"
            }))).into_response()
        }
        Err(_) => {
            let mut brc100_state = state.brc100_state.lock().await;
            brc100_state.pending_responses.remove(&internal_id);

            (StatusCode::BAD_REQUEST, Json(serde_json::json!({
                "isError": true,
                "code": -32000,
                "message": "Request timeout"
            }))).into_response()
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
