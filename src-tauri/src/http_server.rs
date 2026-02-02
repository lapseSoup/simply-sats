use axum::{
    routing::post,
    http::{StatusCode, Method},
    Json, Router,
    extract::State,
};
use tower_http::cors::{CorsLayer, Any};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use crate::SharedBRC100State;

const PORT: u16 = 3322; // Simply Sats uses 3322 (Metanet Desktop uses 3321)

#[derive(Clone)]
struct AppState {
    app_handle: AppHandle,
    brc100_state: SharedBRC100State,
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

pub async fn start_server(app_handle: AppHandle, brc100_state: SharedBRC100State) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state = AppState {
        app_handle,
        brc100_state,
    };

    // Configure CORS to allow any origin (for local development)
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any);

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
    // Return a placeholder - frontend will fetch actual height
    Json(HeightResponse {
        height: 880000,
    })
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

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("{}_{}", timestamp, rand_simple())
}

fn rand_simple() -> u32 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .subsec_nanos();
    nanos
}
