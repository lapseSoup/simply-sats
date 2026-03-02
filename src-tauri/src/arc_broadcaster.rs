//! ARC broadcasting module — transaction broadcast with WoC fallback.
//!
//! Tries GorillaPool ARC first (low-latency, status tracking), then falls
//! back to the WhatsOnChain raw-tx endpoint if ARC is unavailable.

use bsv_sdk::arc::{ArcClient, ArcConfig};
use bsv_sdk::transaction::Transaction as SdkTransaction;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastResult {
    pub txid: String,
    pub status: String,
}

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

/// Broadcast a raw transaction hex, trying ARC (GorillaPool) first with
/// a WhatsOnChain fallback.
#[tauri::command]
pub async fn broadcast_transaction(raw_hex: String) -> Result<BroadcastResult, String> {
    let tx = SdkTransaction::from_hex(&raw_hex)
        .map_err(|e| format!("Invalid transaction hex: {}", e))?;

    // --- ARC attempt ---
    let config = ArcConfig {
        base_url: "https://arc.gorillapool.io/v1".into(),
        ..Default::default()
    };

    let client = ArcClient::new(config);

    match client.broadcast_async(&tx).await {
        Ok(resp) => {
            // "txn-already-known" is a success — mirrors existing WoC handling
            Ok(BroadcastResult {
                txid: resp.txid,
                status: resp
                    .tx_status
                    .unwrap_or_else(|| "success".to_string()),
            })
        }
        Err(arc_err) => {
            // --- WoC fallback ---
            broadcast_via_woc(&raw_hex).await.map_err(|woc_err| {
                // Sanitize: don't expose endpoint URLs in user-facing errors
                format!(
                    "Broadcast failed: {}",
                    sanitize_broadcast_error(&format!("{}, {}", arc_err, woc_err))
                )
            })
        }
    }
}

// ---------------------------------------------------------------------------
// WoC fallback
// ---------------------------------------------------------------------------

/// Broadcast via WhatsOnChain's raw-tx POST endpoint.
async fn broadcast_via_woc(raw_hex: &str) -> Result<BroadcastResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let url = "https://api.whatsonchain.com/v1/bsv/main/tx/raw";

    let resp = client
        .post(url)
        .json(&serde_json::json!({ "txhex": raw_hex }))
        .send()
        .await
        .map_err(|e| format!("WoC broadcast error: {}", e))?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();

    if status.is_success() {
        // WoC returns the txid as a quoted string
        let txid = body.trim().trim_matches('"').to_string();
        Ok(BroadcastResult {
            txid,
            status: "success".to_string(),
        })
    } else if body.contains("txn-already-known")
        || body.contains("Transaction already in the mempool")
    {
        // Transaction exists — compute txid from the raw hex
        let tx = SdkTransaction::from_hex(raw_hex)
            .map_err(|e| format!("Parse error: {}", e))?;
        Ok(BroadcastResult {
            txid: tx.tx_id_hex(),
            status: "already-known".to_string(),
        })
    } else {
        Err(format!("WoC rejected: {}", body))
    }
}

// ---------------------------------------------------------------------------
// Error sanitisation
// ---------------------------------------------------------------------------

/// Remove endpoint URLs from error messages to avoid leaking infrastructure
/// details to the frontend.
fn sanitize_broadcast_error(error: &str) -> String {
    error
        .replace("https://arc.gorillapool.io/v1", "[ARC]")
        .replace("https://api.whatsonchain.com/v1/bsv/main", "[WoC]")
        .to_string()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_broadcast_error_strips_urls() {
        let msg = "HTTP error: https://arc.gorillapool.io/v1/tx timed out, WoC broadcast error: https://api.whatsonchain.com/v1/bsv/main/tx/raw 503";
        let sanitized = sanitize_broadcast_error(msg);
        assert!(!sanitized.contains("gorillapool"));
        assert!(!sanitized.contains("whatsonchain"));
        assert!(sanitized.contains("[ARC]"));
        assert!(sanitized.contains("[WoC]"));
    }

    #[test]
    fn test_sanitize_no_urls() {
        let msg = "some generic error";
        assert_eq!(sanitize_broadcast_error(msg), "some generic error");
    }

    #[test]
    fn test_broadcast_result_serialization() {
        let result = BroadcastResult {
            txid: "abc123".into(),
            status: "success".into(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"txid\":\"abc123\""));
        assert!(json.contains("\"status\":\"success\""));
    }

    #[test]
    fn test_broadcast_result_deserialization() {
        let json = r#"{"txid":"def456","status":"already-known"}"#;
        let result: BroadcastResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.txid, "def456");
        assert_eq!(result.status, "already-known");
    }

    #[tokio::test]
    async fn test_broadcast_invalid_hex() {
        let result = broadcast_transaction("not_valid_hex".into()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid transaction hex"));
    }
}
