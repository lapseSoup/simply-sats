//! Authenticated Messaging (BRC-31) Module
//!
//! Provides peer-to-peer mutual authentication, session management, and
//! certificate verification using the bsv-auth crate (via bsv-sdk).
//!
//! This is a starting implementation with a simple in-memory transport.
//! Messages are queued locally; the full HTTP transport will be added later.

use std::collections::VecDeque;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use bsv_sdk::auth::certificates::Certificate;
use bsv_sdk::auth::error::AuthError;
use bsv_sdk::auth::peer::{Peer, PeerOptions};
use bsv_sdk::auth::transport::{OnDataCallback, Transport};
use bsv_sdk::auth::types::AuthMessage;
use bsv_sdk::primitives::ec::public_key::PublicKey;
use bsv_sdk::wallet::{ProtoWallet, WalletInterface};

use crate::bsv_sdk_adapter::sdk_privkey_from_wif;
use crate::key_store::SharedKeyStore;

// ---------------------------------------------------------------------------
// SimpleTransport — in-memory message queue
// ---------------------------------------------------------------------------

/// A simple in-memory transport for auth messages.
///
/// Outgoing messages are queued in a `VecDeque`. Incoming messages are
/// dispatched to a registered callback. This is a placeholder implementation;
/// the full HTTP/WebSocket transport will replace it in a later phase.
pub struct SimpleTransport {
    outbox: std::sync::Mutex<VecDeque<AuthMessage>>,
    callback: std::sync::Mutex<Option<OnDataCallback>>,
}

impl SimpleTransport {
    /// Create a new empty transport.
    pub fn new() -> Self {
        Self {
            outbox: std::sync::Mutex::new(VecDeque::new()),
            callback: std::sync::Mutex::new(None),
        }
    }

    /// Take the next outgoing message from the queue (if any).
    #[cfg(test)]
    pub fn take_outgoing(&self) -> Option<AuthMessage> {
        self.outbox
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .pop_front()
    }

    /// Simulate receiving an incoming message (dispatches to the registered callback).
    #[cfg(test)]
    pub fn inject_incoming(&self, message: &AuthMessage) -> Result<(), AuthError> {
        let cb_guard = self.callback.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(ref cb) = *cb_guard {
            cb(message)
        } else {
            Err(AuthError::NoHandlerRegistered)
        }
    }

    /// Number of queued outgoing messages.
    #[cfg(test)]
    pub fn outbox_len(&self) -> usize {
        self.outbox
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .len()
    }
}

impl Transport for SimpleTransport {
    fn send(&self, message: &AuthMessage) -> Result<(), AuthError> {
        self.outbox
            .lock()
            .map_err(|_| AuthError::LockError("outbox lock poisoned".into()))?
            .push_back(message.clone());
        Ok(())
    }

    fn on_data(&self, callback: OnDataCallback) -> Result<(), AuthError> {
        let mut cb_guard = self
            .callback
            .lock()
            .map_err(|_| AuthError::LockError("callback lock poisoned".into()))?;
        *cb_guard = Some(callback);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// AuthState — Tauri managed state
// ---------------------------------------------------------------------------

/// Managed state for the auth module.
///
/// Holds the Peer instance (once initialized) and the shared transport.
/// The Peer is lazily created on the first command that needs it, using
/// the identity key from the key store.
pub struct AuthState {
    peer: Mutex<Option<Arc<Peer>>>,
    transport: Arc<SimpleTransport>,
}

impl AuthState {
    /// Create a new uninitialized AuthState.
    pub fn new() -> Self {
        Self {
            peer: Mutex::new(None),
            transport: Arc::new(SimpleTransport::new()),
        }
    }

    /// Get or create the Peer, deriving it from the identity WIF in the key store.
    async fn get_or_create_peer(
        &self,
        key_store: &SharedKeyStore,
    ) -> Result<Arc<Peer>, String> {
        let mut peer_guard = self.peer.lock().await;
        if let Some(ref peer) = *peer_guard {
            return Ok(Arc::clone(peer));
        }

        // Get identity WIF from key store
        let store = key_store.lock().await;
        let identity_wif = store
            .get_wif("identity")
            .map_err(|e| format!("auth: cannot access identity key: {}", e))?;
        drop(store);

        // Create SDK private key from WIF
        let privkey = sdk_privkey_from_wif(&identity_wif)?;

        // Create ProtoWallet (implements WalletInterface)
        let wallet = ProtoWallet::from_private_key(privkey)
            .map_err(|e| format!("auth: failed to create ProtoWallet: {}", e))?;

        let wallet_arc: Arc<dyn WalletInterface + Send + Sync> = Arc::new(wallet);

        // Create Peer
        let peer = Peer::new(PeerOptions {
            wallet: wallet_arc,
            transport: Arc::clone(&self.transport) as Arc<dyn Transport>,
            certificates_to_request: None,
            session_manager: None,
            auto_persist_last_session: Some(true),
        });

        *peer_guard = Some(Arc::clone(&peer));
        Ok(peer)
    }

    /// Reset the peer (e.g., on account switch or lock).
    #[allow(dead_code)]
    pub async fn reset(&self) {
        let mut peer_guard = self.peer.lock().await;
        *peer_guard = None;
    }
}

// ---------------------------------------------------------------------------
// Result types — returned to the frontend
// ---------------------------------------------------------------------------

/// Result of `auth_create_session`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSessionResult {
    pub session_nonce: String,
    pub authenticated: bool,
}

/// Result of `auth_send_message`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSendResult {
    pub delivered: bool,
}

/// Result of `auth_verify_certificate`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthCertResult {
    pub valid: bool,
    pub certifier: String,
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

/// Create or retrieve an authenticated session with a peer.
///
/// Uses the wallet's identity key from the key store to set up a Peer
/// and initiate a session handshake with the given peer public key.
#[tauri::command]
pub async fn auth_create_session(
    auth_state: tauri::State<'_, Arc<AuthState>>,
    key_store: tauri::State<'_, SharedKeyStore>,
    peer_pub_key: String,
) -> Result<AuthSessionResult, String> {
    let peer = auth_state
        .get_or_create_peer(&key_store)
        .await?;

    let peer_identity = PublicKey::from_hex(&peer_pub_key)
        .map_err(|e| format!("auth: invalid peer public key: {}", e))?;

    let session = peer
        .get_authenticated_session(Some(&peer_identity))
        .map_err(|e| format!("auth: session creation failed: {}", e))?;

    Ok(AuthSessionResult {
        session_nonce: session.session_nonce,
        authenticated: session.is_authenticated,
    })
}

/// Send an authenticated message to a peer.
///
/// The peer must already have an active session (call `auth_create_session` first).
#[tauri::command]
pub async fn auth_send_message(
    auth_state: tauri::State<'_, Arc<AuthState>>,
    key_store: tauri::State<'_, SharedKeyStore>,
    peer_pub_key: String,
    payload: Vec<u8>,
) -> Result<AuthSendResult, String> {
    let peer = auth_state
        .get_or_create_peer(&key_store)
        .await?;

    let peer_identity = PublicKey::from_hex(&peer_pub_key)
        .map_err(|e| format!("auth: invalid peer public key: {}", e))?;

    peer.to_peer(&payload, Some(&peer_identity))
        .map_err(|e| format!("auth: send message failed: {}", e))?;

    Ok(AuthSendResult { delivered: true })
}

/// Verify a certificate's signature.
///
/// Parses the hex-encoded binary certificate data and verifies the
/// certifier's signature using the bsv-auth `Certificate::verify()` method.
#[tauri::command]
pub async fn auth_verify_certificate(
    cert_hex: String,
) -> Result<AuthCertResult, String> {
    let cert_bytes = hex::decode(&cert_hex)
        .map_err(|e| format!("auth: invalid certificate hex: {}", e))?;

    let certificate = Certificate::from_binary(&cert_bytes)
        .map_err(|e| format!("auth: failed to parse certificate: {}", e))?;

    let certifier_hex = certificate.certifier.to_hex();

    match certificate.verify() {
        Ok(()) => Ok(AuthCertResult {
            valid: true,
            certifier: certifier_hex,
        }),
        Err(AuthError::NotSigned) => Ok(AuthCertResult {
            valid: false,
            certifier: certifier_hex,
        }),
        Err(AuthError::InvalidSignature) => Ok(AuthCertResult {
            valid: false,
            certifier: certifier_hex,
        }),
        Err(e) => Err(format!("auth: certificate verification error: {}", e)),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use bsv_sdk::auth::types::MessageType;
    use bsv_sdk::primitives::ec::private_key::PrivateKey;

    /// Helper: create a PrivateKey with a known byte value.
    fn make_key(val: u8) -> PrivateKey {
        let mut bytes = [0u8; 32];
        bytes[31] = val;
        PrivateKey::from_bytes(&bytes).unwrap()
    }

    // -----------------------------------------------------------------------
    // SimpleTransport tests
    // -----------------------------------------------------------------------

    #[test]
    fn transport_send_queues_messages() {
        let transport = SimpleTransport::new();
        assert_eq!(transport.outbox_len(), 0);

        let pk = make_key(42);
        let msg = AuthMessage::new(MessageType::General, pk.pub_key());
        transport.send(&msg).unwrap();

        assert_eq!(transport.outbox_len(), 1);

        let taken = transport.take_outgoing().unwrap();
        assert_eq!(taken.message_type, MessageType::General);
        assert_eq!(transport.outbox_len(), 0);
    }

    #[test]
    fn transport_take_returns_none_when_empty() {
        let transport = SimpleTransport::new();
        assert!(transport.take_outgoing().is_none());
    }

    #[test]
    fn transport_send_preserves_order() {
        let transport = SimpleTransport::new();

        let pk1 = make_key(1);
        let pk2 = make_key(2);
        let msg1 = AuthMessage::new(MessageType::InitialRequest, pk1.pub_key());
        let msg2 = AuthMessage::new(MessageType::InitialResponse, pk2.pub_key());

        transport.send(&msg1).unwrap();
        transport.send(&msg2).unwrap();

        assert_eq!(transport.outbox_len(), 2);
        let first = transport.take_outgoing().unwrap();
        assert_eq!(first.message_type, MessageType::InitialRequest);
        let second = transport.take_outgoing().unwrap();
        assert_eq!(second.message_type, MessageType::InitialResponse);
    }

    #[test]
    fn transport_callback_registration() {
        let transport = SimpleTransport::new();

        // Register a callback
        let received = Arc::new(std::sync::Mutex::new(false));
        let received_clone = Arc::clone(&received);
        transport
            .on_data(Box::new(move |_msg| {
                *received_clone.lock().unwrap() = true;
                Ok(())
            }))
            .unwrap();

        // Inject an incoming message
        let pk = make_key(10);
        let msg = AuthMessage::new(MessageType::General, pk.pub_key());
        transport.inject_incoming(&msg).unwrap();

        assert!(*received.lock().unwrap());
    }

    #[test]
    fn transport_no_callback_returns_error() {
        let transport = SimpleTransport::new();

        let pk = make_key(10);
        let msg = AuthMessage::new(MessageType::General, pk.pub_key());
        let result = transport.inject_incoming(&msg);

        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // AuthState initialization test
    // -----------------------------------------------------------------------

    #[test]
    fn auth_state_starts_uninitialized() {
        let state = AuthState::new();
        // Peer should be None initially
        let peer_guard = state.peer.try_lock().unwrap();
        assert!(peer_guard.is_none());
    }

    // -----------------------------------------------------------------------
    // Certificate verification tests
    // -----------------------------------------------------------------------

    #[test]
    fn verify_unsigned_certificate_returns_invalid() {
        // Create a certificate without a signature
        let subject = make_key(10);
        let certifier = make_key(20);

        let cert = Certificate::new(
            base64::engine::general_purpose::STANDARD.encode([0u8; 32]),
            base64::engine::general_purpose::STANDARD.encode([1u8; 32]),
            subject.pub_key(),
            certifier.pub_key(),
            format!("{}.0", "00".repeat(32)),
            std::collections::HashMap::new(),
        );

        // Serialize to binary (includes no signature)
        let binary = cert.to_binary(true).unwrap();
        let cert_hex = hex::encode(&binary);

        // Verify should return valid=false for unsigned cert
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(auth_verify_certificate(cert_hex)).unwrap();
        assert!(!result.valid);
    }

    #[test]
    fn verify_signed_certificate_roundtrip() {
        // Create a certifier wallet and sign a certificate
        let subject_key = make_key(10);
        let certifier_key = make_key(20);

        let certifier_wallet = ProtoWallet::from_private_key(certifier_key.clone()).unwrap();

        let mut cert = Certificate::new(
            base64::engine::general_purpose::STANDARD.encode([42u8; 32]),
            base64::engine::general_purpose::STANDARD.encode([99u8; 32]),
            subject_key.pub_key(),
            certifier_key.pub_key(),
            format!("{}.0", "aa".repeat(32)),
            std::collections::HashMap::from([
                ("name".to_string(), "Alice".to_string()),
            ]),
        );

        // Sign the certificate
        cert.sign(&certifier_wallet).unwrap();
        assert!(!cert.signature.is_empty());

        // Serialize and hex-encode
        let binary = cert.to_binary(true).unwrap();
        let cert_hex = hex::encode(&binary);

        // Verify via Tauri command
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(auth_verify_certificate(cert_hex)).unwrap();
        assert!(result.valid);
        assert_eq!(result.certifier, certifier_wallet.identity_key().to_hex());
    }

    #[test]
    fn verify_certificate_with_invalid_hex_returns_error() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(auth_verify_certificate("not_valid_hex".to_string()));
        assert!(result.is_err());
    }

    #[test]
    fn verify_certificate_with_truncated_data_returns_error() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        // Too short to be a valid certificate (needs at least 32+32+33+33+36 = 166 bytes)
        let result = rt.block_on(auth_verify_certificate("aabb".to_string()));
        assert!(result.is_err());
    }
}
