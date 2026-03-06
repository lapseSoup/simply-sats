//! SPV verification module — Merkle path and BEEF validation via WhatsOnChain.
//!
//! Provides a `ChainTracker` implementation backed by the WoC block header API,
//! plus three Tauri commands for frontend consumption:
//!   - `verify_merkle_path`  — BRC-74 Merkle proof verification
//!   - `parse_beef`          — BEEF (BRC-64/95/96) envelope parsing
//!   - `verify_beef`         — BEEF verification against chain headers

use bsv_sdk::primitives::chainhash::Hash;
use bsv_sdk::spv::chain_tracker::ChainTracker;
use bsv_sdk::spv::error::SpvError;
use bsv_sdk::spv::{Beef, MerklePath};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// WhatsOnChain ChainTracker
// ---------------------------------------------------------------------------

/// ChainTracker that validates Merkle roots against WhatsOnChain block headers.
struct WocChainTracker {
    client: reqwest::blocking::Client,
}

impl WocChainTracker {
    fn new() -> Self {
        Self {
            client: reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .unwrap_or_default(),
        }
    }
}

impl ChainTracker for WocChainTracker {
    fn is_valid_root_for_height(&self, root: &Hash, height: u32) -> Result<bool, SpvError> {
        let url = format!(
            "https://api.whatsonchain.com/v1/bsv/main/block/height/{}/header",
            height
        );

        let resp = self
            .client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .map_err(|e| SpvError::General(format!("WoC request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(SpvError::General(format!(
                "WoC returned status {} for height {}",
                resp.status(),
                height
            )));
        }

        let body: serde_json::Value = resp
            .json()
            .map_err(|e| SpvError::General(format!("WoC JSON parse error: {}", e)))?;

        let merkle_root_hex = body["merkleroot"]
            .as_str()
            .ok_or_else(|| SpvError::General("missing merkleroot in WoC response".into()))?;

        // Hash::to_string() produces byte-reversed hex (Bitcoin display format),
        // which matches the WoC API's merkleroot format.
        Ok(root.to_string() == merkle_root_hex)
    }

    fn current_height(&self) -> Result<u32, SpvError> {
        let url = "https://api.whatsonchain.com/v1/bsv/main/chain/info";

        let resp = self
            .client
            .get(url)
            .header("Accept", "application/json")
            .send()
            .map_err(|e| SpvError::General(format!("WoC chain info request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(SpvError::General(format!(
                "WoC chain info returned status {}",
                resp.status()
            )));
        }

        let body: serde_json::Value = resp
            .json()
            .map_err(|e| SpvError::General(format!("WoC JSON parse error: {}", e)))?;

        body["blocks"]
            .as_u64()
            .map(|h| h as u32)
            .ok_or_else(|| SpvError::General("missing blocks field in WoC chain info".into()))
    }
}

// ---------------------------------------------------------------------------
// Tauri command return types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MerkleVerifyResult {
    pub root: String,
    pub valid: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeefParseResult {
    pub version: u32,
    pub txids: Vec<String>,
    pub valid: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeefVerifyResult {
    pub valid: bool,
    pub txids: Vec<String>,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Verify a BRC-74 Merkle path for a given txid against the chain.
#[tauri::command]
pub fn verify_merkle_path(hex: String, txid: String) -> Result<MerkleVerifyResult, String> {
    let merkle_path =
        MerklePath::from_hex(&hex).map_err(|e| format!("Invalid merkle path: {}", e))?;

    let txid_hash = Hash::from_hex(&txid).map_err(|e| format!("Invalid txid: {}", e))?;

    // Compute the Merkle root from the path + txid
    let computed_root = merkle_path
        .compute_root(Some(&txid_hash))
        .map_err(|e| format!("Failed to compute root: {}", e))?;

    // Verify computed root against the block header on-chain
    let tracker = WocChainTracker::new();
    let valid = tracker
        .is_valid_root_for_height(&computed_root, merkle_path.block_height)
        .unwrap_or(false);

    Ok(MerkleVerifyResult {
        root: computed_root.to_string(),
        valid,
    })
}

/// Parse a BEEF (BRC-64/95/96) envelope without chain verification.
#[tauri::command]
pub fn parse_beef(hex: String) -> Result<BeefParseResult, String> {
    let beef = Beef::from_hex(&hex).map_err(|e| format!("Invalid BEEF: {}", e))?;

    let txids: Vec<String> = beef.transactions.keys().map(|h| h.to_string()).collect();

    let valid = beef.is_valid(true);

    Ok(BeefParseResult {
        version: beef.version,
        txids,
        valid,
    })
}

/// Verify a BEEF envelope against the chain via WhatsOnChain.
#[tauri::command]
pub fn verify_beef(hex: String) -> Result<BeefVerifyResult, String> {
    let beef = Beef::from_hex(&hex).map_err(|e| format!("Invalid BEEF: {}", e))?;

    let tracker = WocChainTracker::new();
    let valid = beef.verify(&tracker, true).unwrap_or(false);

    let txids: Vec<String> = beef.transactions.keys().map(|h| h.to_string()).collect();

    Ok(BeefVerifyResult { valid, txids })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // From the SDK's own test vectors (bsv-spv/src/merkle_path.rs)
    const BRC74_HEX: &str = "fe8a6a0c000c04fde80b0011774f01d26412f0d16ea3f0447be0b5ebec67b0782e321a7a01cbdf7f734e30fde90b02004e53753e3fe4667073063a17987292cfdea278824e9888e52180581d7188d8fdea0b025e441996fc53f0191d649e68a200e752fb5f39e0d5617083408fa179ddc5c998fdeb0b0102fdf405000671394f72237d08a4277f4435e5b6edf7adc272f25effef27cdfe805ce71a81fdf50500262bccabec6c4af3ed00cc7a7414edea9c5efa92fb8623dd6160a001450a528201fdfb020101fd7c010093b3efca9b77ddec914f8effac691ecb54e2c81d0ab81cbc4c4b93befe418e8501bf01015e005881826eb6973c54003a02118fe270f03d46d02681c8bc71cd44c613e86302f8012e00e07a2bb8bb75e5accff266022e1e5e6e7b4d6d943a04faadcf2ab4a22f796ff30116008120cafa17309c0bb0e0ffce835286b3a2dcae48e4497ae2d2b7ced4f051507d010a00502e59ac92f46543c23006bff855d96f5e648043f0fb87a7a5949e6a9bebae430104001ccd9f8f64f4d0489b30cc815351cf425e0e78ad79a589350e4341ac165dbe45010301010000af8764ce7e1cc132ab5ed2229a005c87201c9a5ee15c0f91dd53eff31ab30cd4";
    const BRC74_TXID1: &str = "304e737fdfcb017a1a322e78b067ecebb5e07b44f0a36ed1f01264d2014f7711";
    const BRC74_ROOT: &str = "57aab6e6fb1b697174ffb64e062c4728f2ffd33ddcfa02a43b64d8cd29b483b4";

    #[test]
    fn test_merkle_path_local_verify() {
        // Verify that compute_root works correctly (no network call)
        let mp = MerklePath::from_hex(BRC74_HEX).unwrap();
        let txid = Hash::from_hex(BRC74_TXID1).unwrap();
        let root = mp.compute_root(Some(&txid)).unwrap();
        assert_eq!(root.to_string(), BRC74_ROOT);
    }

    #[test]
    fn test_parse_beef_command() {
        // BEEF V2 test vector from SDK
        let beef_hex = "0200beef0000";
        let result = parse_beef(beef_hex.to_string()).unwrap();
        assert_eq!(result.version, 4022206466); // BEEF_V2
        assert!(result.txids.is_empty());
        // Empty BEEF is trivially valid (no txs to verify)
        assert!(result.valid);
    }

    #[test]
    fn test_parse_beef_invalid() {
        let result = parse_beef("deadbeef".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_verify_merkle_path_bad_hex() {
        let result = verify_merkle_path("not_hex".into(), BRC74_TXID1.into());
        assert!(result.is_err());
    }

    #[test]
    fn test_verify_merkle_path_bad_txid() {
        let result = verify_merkle_path(BRC74_HEX.into(), "not_a_txid".into());
        assert!(result.is_err());
    }

    #[test]
    fn test_return_types_serialize() {
        let mr = MerkleVerifyResult {
            root: "abc".into(),
            valid: true,
        };
        let json = serde_json::to_string(&mr).unwrap();
        assert!(json.contains("\"root\":\"abc\""));
        assert!(json.contains("\"valid\":true"));

        let bp = BeefParseResult {
            version: 1,
            txids: vec!["tx1".into()],
            valid: false,
        };
        let json = serde_json::to_string(&bp).unwrap();
        assert!(json.contains("\"version\":1"));
        assert!(json.contains("\"valid\":false"));

        let bv = BeefVerifyResult {
            valid: true,
            txids: vec![],
        };
        let json = serde_json::to_string(&bv).unwrap();
        assert!(json.contains("\"valid\":true"));
    }
}
