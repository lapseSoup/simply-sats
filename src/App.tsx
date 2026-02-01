import { useState, useEffect, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import './App.css'
import type { WalletKeys, Ordinal } from './services/wallet'
import {
  createWallet,
  restoreWallet,
  importFromJSON,
  getBalance,
  getUTXOs,
  getTransactionHistory,
  getOrdinals,
  sendBSV,
  saveWallet,
  loadWallet,
  hasWallet,
  clearWallet
} from './services/wallet'
import {
  type BRC100Request,
  setRequestHandler,
  approveRequest,
  rejectRequest,
  getPendingRequests
} from './services/brc100'
import { setupDeepLinkListener } from './services/deeplink'

type Tab = 'activity' | 'ordinals'
type Modal = 'send' | 'receive' | 'settings' | 'mnemonic' | 'restore' | 'ordinal' | 'brc100' | null
type RestoreMode = 'mnemonic' | 'json'

interface TxHistoryItem {
  tx_hash: string
  height: number
}

function App() {
  const [wallet, setWallet] = useState<WalletKeys | null>(null)
  const [balance, setBalance] = useState<number>(0)
  const [ordBalance, setOrdBalance] = useState<number>(0)
  const [usdPrice, setUsdPrice] = useState<number>(0)
  const [activeTab, setActiveTab] = useState<Tab>('activity')
  const [modal, setModal] = useState<Modal>(null)
  const [loading, setLoading] = useState(true)
  const [txHistory, setTxHistory] = useState<TxHistoryItem[]>([])
  const [ordinals, setOrdinals] = useState<Ordinal[]>([])
  const [selectedOrdinal, setSelectedOrdinal] = useState<Ordinal | null>(null)

  // Send form state
  const [sendAddress, setSendAddress] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  // Restore form state
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('mnemonic')
  const [restoreMnemonic, setRestoreMnemonic] = useState('')
  const [restoreJSON, setRestoreJSON] = useState('')

  // Receive address type
  const [receiveType, setReceiveType] = useState<'wallet' | 'ordinals'>('wallet')

  // New wallet mnemonic display
  const [newMnemonic, setNewMnemonic] = useState<string | null>(null)

  // BRC-100 request state
  const [brc100Request, setBrc100Request] = useState<BRC100Request | null>(null)
  const [connectedApps, setConnectedApps] = useState<string[]>([])

  // Load wallet on mount
  useEffect(() => {
    const init = async () => {
      if (hasWallet()) {
        const keys = loadWallet('')
        if (keys) {
          setWallet(keys)
        }
      }
      setLoading(false)

      // Load connected apps from storage
      const savedApps = localStorage.getItem('simply_sats_connected_apps')
      if (savedApps) {
        setConnectedApps(JSON.parse(savedApps))
      }
    }
    init()
  }, [])

  // Set up BRC-100 request handler and deep link listener
  useEffect(() => {
    const handleIncomingRequest = (request: BRC100Request) => {
      setBrc100Request(request)
      setModal('brc100')
    }

    setRequestHandler(handleIncomingRequest)

    // Set up deep link listener
    let unlistenDeepLink: (() => void) | null = null
    setupDeepLinkListener(handleIncomingRequest).then(unlisten => {
      unlistenDeepLink = unlisten
    })

    // Check for any pending requests on load
    const pending = getPendingRequests()
    if (pending.length > 0) {
      setBrc100Request(pending[0])
      setModal('brc100')
    }

    return () => {
      if (unlistenDeepLink) {
        unlistenDeepLink()
      }
    }
  }, [])

  // Fetch balances and data when wallet is loaded
  const fetchData = useCallback(async () => {
    if (!wallet) return

    try {
      const bal = await getBalance(wallet.walletAddress)
      setBalance(bal)

      const ordBal = await getBalance(wallet.ordAddress)
      setOrdBalance(ordBal)

      const history = await getTransactionHistory(wallet.walletAddress)
      setTxHistory(history.slice(0, 20))

      const ords = await getOrdinals(wallet.ordAddress)
      setOrdinals(ords)
    } catch (error) {
      console.error('Error fetching data:', error)
    }
  }, [wallet])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Fetch BSV price
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate')
        const data = await response.json()
        setUsdPrice(data.rate)
      } catch (error) {
        console.error('Error fetching price:', error)
      }
    }
    fetchPrice()
    const interval = setInterval(fetchPrice, 60000)
    return () => clearInterval(interval)
  }, [])

  // Create new wallet
  const handleCreateWallet = () => {
    const keys = createWallet()
    setNewMnemonic(keys.mnemonic)
    setModal('mnemonic')
    saveWallet(keys, '')
    setWallet(keys)
  }

  // Confirm mnemonic saved
  const handleMnemonicConfirm = () => {
    setNewMnemonic(null)
    setModal(null)
  }

  // Restore wallet from mnemonic
  const handleRestoreFromMnemonic = () => {
    try {
      console.log('Restoring from mnemonic...')
      const keys = restoreWallet(restoreMnemonic.trim())
      console.log('Wallet restored, address:', keys.walletAddress)
      saveWallet(keys, '')
      setWallet(keys)
      setRestoreMnemonic('')
      setModal(null)
    } catch (error) {
      console.error('Restore error:', error)
      alert(error instanceof Error ? error.message : 'Invalid mnemonic phrase')
    }
  }

  // Restore wallet from JSON backup
  const handleRestoreFromJSON = () => {
    try {
      const keys = importFromJSON(restoreJSON.trim())
      saveWallet(keys, '')
      setWallet(keys)
      setRestoreJSON('')
      setModal(null)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Invalid backup file')
    }
  }

  // Send BSV
  const handleSend = async () => {
    if (!wallet || !sendAddress || !sendAmount) return

    setSending(true)
    setSendError('')

    try {
      const satoshis = Math.floor(parseFloat(sendAmount) * 100000000)
      const utxos = await getUTXOs(wallet.walletAddress)
      const txid = await sendBSV(wallet.walletWif, sendAddress, satoshis, utxos)
      alert(`Transaction sent! TXID: ${txid}`)
      setSendAddress('')
      setSendAmount('')
      setModal(null)
      fetchData()
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    alert('Copied to clipboard!')
  }

  // Open on WhatsOnChain
  const openOnWoC = (txid: string) => {
    window.open(`https://whatsonchain.com/tx/${txid}`, '_blank')
  }

  // Delete wallet
  const handleDeleteWallet = () => {
    if (confirm('Are you sure you want to delete your wallet? Make sure you have backed up your recovery phrase!')) {
      clearWallet()
      setWallet(null)
      setModal(null)
    }
  }

  // Handle BRC-100 request approval
  const handleApproveBRC100 = () => {
    if (!brc100Request || !wallet) return

    // Add app to connected apps if it has an origin
    if (brc100Request.origin && !connectedApps.includes(brc100Request.origin)) {
      const newConnectedApps = [...connectedApps, brc100Request.origin]
      setConnectedApps(newConnectedApps)
      localStorage.setItem('simply_sats_connected_apps', JSON.stringify(newConnectedApps))
    }

    approveRequest(brc100Request.id, wallet)
    setBrc100Request(null)
    setModal(null)
  }

  // Handle BRC-100 request rejection
  const handleRejectBRC100 = () => {
    if (!brc100Request) return
    rejectRequest(brc100Request.id)
    setBrc100Request(null)
    setModal(null)
  }

  // Disconnect an app
  const disconnectApp = (origin: string) => {
    const newConnectedApps = connectedApps.filter(app => app !== origin)
    setConnectedApps(newConnectedApps)
    localStorage.setItem('simply_sats_connected_apps', JSON.stringify(newConnectedApps))
  }

  // Format BRC-100 request for display
  const formatBRC100Request = (request: BRC100Request): { title: string; description: string } => {
    switch (request.type) {
      case 'getPublicKey':
        return {
          title: 'Share Public Key',
          description: 'This app wants to know your public key for identification.'
        }
      case 'createSignature':
        return {
          title: 'Sign Message',
          description: 'This app wants you to sign a message to verify your identity.'
        }
      case 'createAction':
        return {
          title: 'Create Transaction',
          description: 'This app wants to create a transaction. Review carefully before approving.'
        }
      case 'isAuthenticated':
        return {
          title: 'Check Connection',
          description: 'This app wants to check if your wallet is connected.'
        }
      default:
        return {
          title: 'Unknown Request',
          description: `Request type: ${request.type}`
        }
    }
  }

  // Format satoshis as BSV
  const formatBSV = (sats: number) => {
    return (sats / 100000000).toFixed(8)
  }

  // Format USD
  const formatUSD = (sats: number) => {
    const bsv = sats / 100000000
    return (bsv * usdPrice).toFixed(2)
  }

  // Loading screen
  if (loading) {
    return (
      <div className="setup-screen">
        <div className="spinner" />
      </div>
    )
  }

  // Setup screen (no wallet)
  if (!wallet) {
    return (
      <div className="setup-screen">
        <div className="setup-logo">₿</div>
        <h1 className="setup-title">Simply Sats</h1>
        <p className="setup-subtitle">BRC-100 wallet for BSV</p>
        <div className="setup-actions">
          <button className="btn btn-primary" onClick={handleCreateWallet}>
            Create New Wallet
          </button>
          <button className="btn btn-secondary" onClick={() => setModal('restore')}>
            Restore Wallet
          </button>
        </div>

        {/* Restore Modal */}
        {modal === 'restore' && (
          <div className="modal-overlay" onClick={() => setModal(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Restore Wallet</h2>
                <button className="modal-close" onClick={() => setModal(null)}>×</button>
              </div>
              <div className="modal-content">
                {/* Restore mode tabs */}
                <div className="address-tabs" style={{ marginBottom: 16 }}>
                  <button
                    className={`address-tab ${restoreMode === 'mnemonic' ? 'active' : ''}`}
                    onClick={() => setRestoreMode('mnemonic')}
                  >
                    Seed Phrase
                  </button>
                  <button
                    className={`address-tab ${restoreMode === 'json' ? 'active' : ''}`}
                    onClick={() => setRestoreMode('json')}
                  >
                    JSON Backup
                  </button>
                </div>

                {restoreMode === 'mnemonic' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">12-Word Recovery Phrase</label>
                      <textarea
                        className="form-input"
                        placeholder="Enter your 12-word recovery phrase"
                        value={restoreMnemonic}
                        onChange={e => setRestoreMnemonic(e.target.value)}
                      />
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={handleRestoreFromMnemonic}
                      disabled={!restoreMnemonic.trim()}
                    >
                      Restore Wallet
                    </button>
                  </>
                )}

                {restoreMode === 'json' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">JSON Backup (Shaullet or 1Sat Ordinals)</label>
                      <textarea
                        className="form-input"
                        placeholder='Paste your wallet backup JSON here...'
                        value={restoreJSON}
                        onChange={e => setRestoreJSON(e.target.value)}
                        style={{ height: 120 }}
                      />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                      Supports Shaullet and 1Sat Ordinals wallet backups
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={handleRestoreFromJSON}
                      disabled={!restoreJSON.trim()}
                    >
                      Import Wallet
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Main wallet UI
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo">Simply Sats</div>
        <button className="settings-btn" onClick={() => setModal('settings')}>
          ⚙️
        </button>
      </header>

      {/* Balance Card */}
      <div className="balance-card">
        <div className="balance-label">Total Balance</div>
        <div className="balance-amount">{formatBSV(balance + ordBalance)} BSV</div>
        <div className="balance-usd">${formatUSD(balance + ordBalance)} USD</div>
      </div>

      {/* Action Buttons */}
      <div className="actions">
        <button className="action-btn primary" onClick={() => setModal('send')}>
          ↑ Send
        </button>
        <button className="action-btn secondary" onClick={() => setModal('receive')}>
          ↓ Receive
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="nav-tabs">
        <button
          className={`nav-tab ${activeTab === 'activity' ? 'active' : ''}`}
          onClick={() => setActiveTab('activity')}
        >
          Activity
        </button>
        <button
          className={`nav-tab ${activeTab === 'ordinals' ? 'active' : ''}`}
          onClick={() => setActiveTab('ordinals')}
        >
          Ordinals ({ordinals.length})
        </button>
      </div>

      {/* Content */}
      <div className="content">
        {activeTab === 'activity' && (
          <div className="tx-list">
            {txHistory.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📭</div>
                <p>No transactions yet</p>
              </div>
            ) : (
              txHistory.map((tx) => (
                <div
                  key={tx.tx_hash}
                  className="tx-item"
                  onClick={() => openOnWoC(tx.tx_hash)}
                >
                  <div className="tx-info">
                    <div className="tx-type">Transaction</div>
                    <div className="tx-txid">
                      {tx.tx_hash.slice(0, 8)}...{tx.tx_hash.slice(-8)}
                    </div>
                    {tx.height > 0 && (
                      <div className="tx-date">Block {tx.height}</div>
                    )}
                  </div>
                  <div className="tx-amount">→</div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'ordinals' && (
          <div className="ordinals-grid">
            {ordinals.length === 0 ? (
              <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
                <div className="empty-icon">🖼️</div>
                <p>No ordinals yet</p>
              </div>
            ) : (
              ordinals.map((ord) => (
                <div
                  key={ord.origin}
                  className="ordinal-item"
                  onClick={() => {
                    setSelectedOrdinal(ord)
                    setModal('ordinal')
                  }}
                >
                  <div className="ordinal-icon">🔮</div>
                  <div className="ordinal-id">
                    {ord.origin.slice(0, 8)}...
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Send Modal */}
      {modal === 'send' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Send BSV</h2>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="modal-content">
              <div className="form-group">
                <label className="form-label">To Address</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="1..."
                  value={sendAddress}
                  onChange={e => setSendAddress(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Amount (BSV)</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="0.00000000"
                  step="0.00000001"
                  value={sendAmount}
                  onChange={e => setSendAmount(e.target.value)}
                />
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Available: {formatBSV(balance)} BSV
                </div>
              </div>
              {sendError && (
                <div className="warning">{sendError}</div>
              )}
              <button
                className="btn btn-primary"
                onClick={handleSend}
                disabled={sending || !sendAddress || !sendAmount}
              >
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive Modal */}
      {modal === 'receive' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Receive</h2>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="modal-content">
              <div className="address-tabs">
                <button
                  className={`address-tab ${receiveType === 'wallet' ? 'active' : ''}`}
                  onClick={() => setReceiveType('wallet')}
                >
                  BSV
                </button>
                <button
                  className={`address-tab ${receiveType === 'ordinals' ? 'active' : ''}`}
                  onClick={() => setReceiveType('ordinals')}
                >
                  Ordinals
                </button>
              </div>
              <div className="qr-container">
                <div className="qr-code">
                  <QRCodeSVG
                    value={receiveType === 'wallet' ? wallet.walletAddress : wallet.ordAddress}
                    size={150}
                    level="M"
                    bgColor="#ffffff"
                    fgColor="#000000"
                  />
                </div>
                <div className="address-display">
                  {receiveType === 'wallet' ? wallet.walletAddress : wallet.ordAddress}
                </div>
                <button
                  className="copy-btn"
                  onClick={() => copyToClipboard(
                    receiveType === 'wallet' ? wallet.walletAddress : wallet.ordAddress
                  )}
                >
                  Copy Address
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {modal === 'settings' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Settings</h2>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="modal-content">
              {/* Identity Key - BRC-100 */}
              <div className="form-group">
                <label className="form-label">Identity Key (BRC-100)</label>
                <div className="address-display" style={{ marginBottom: 8, fontSize: 11 }}>
                  {wallet.identityPubKey}
                </div>
                <button
                  className="copy-btn"
                  style={{ width: '100%' }}
                  onClick={() => copyToClipboard(wallet.identityPubKey)}
                >
                  Copy Identity Key
                </button>
              </div>

              <div className="form-group">
                <label className="form-label">Payment Address</label>
                <div className="address-display" style={{ marginBottom: 8 }}>
                  {wallet.walletAddress}
                </div>
                <button
                  className="copy-btn"
                  style={{ width: '100%' }}
                  onClick={() => copyToClipboard(wallet.walletAddress)}
                >
                  Copy
                </button>
              </div>

              <div className="form-group">
                <label className="form-label">Ordinals Address</label>
                <div className="address-display" style={{ marginBottom: 8 }}>
                  {wallet.ordAddress}
                </div>
                <button
                  className="copy-btn"
                  style={{ width: '100%' }}
                  onClick={() => copyToClipboard(wallet.ordAddress)}
                >
                  Copy
                </button>
              </div>

              <div className="form-group">
                <label className="form-label">Recovery Phrase</label>
                {wallet.mnemonic ? (
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      if (confirm('Make sure no one is watching your screen!')) {
                        alert(wallet.mnemonic)
                      }
                    }}
                  >
                    Show Recovery Phrase
                  </button>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    No mnemonic (imported from JSON)
                  </div>
                )}
              </div>

              {/* Connected Apps */}
              {connectedApps.length > 0 && (
                <div className="form-group">
                  <label className="form-label">Connected Apps</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {connectedApps.map(app => (
                      <div key={app} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        background: 'var(--bg-secondary)',
                        borderRadius: 8
                      }}>
                        <span style={{ fontSize: 13 }}>{app}</span>
                        <button
                          className="link-btn"
                          onClick={() => disconnectApp(app)}
                          style={{ color: 'var(--danger)' }}
                        >
                          Disconnect
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 20 }}>
                <button className="btn btn-danger" onClick={handleDeleteWallet}>
                  Delete Wallet
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mnemonic Display Modal (for new wallet) */}
      {modal === 'mnemonic' && newMnemonic && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2 className="modal-title">Recovery Phrase</h2>
            </div>
            <div className="modal-content">
              <div className="warning">
                Write down these 12 words and keep them safe. This is the ONLY way to recover your wallet!
              </div>
              <div className="mnemonic-display">
                <div className="mnemonic-words">
                  {newMnemonic.split(' ').map((word, i) => (
                    <div key={i} className="mnemonic-word">
                      <span>{i + 1}.</span>
                      {word}
                    </div>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary" onClick={handleMnemonicConfirm}>
                I've saved my recovery phrase
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ordinal Detail Modal */}
      {modal === 'ordinal' && selectedOrdinal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Ordinal</h2>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="modal-content">
              <div className="ordinal-detail">
                <div className="ordinal-preview">🔮</div>
                <div className="ordinal-info">
                  <div className="ordinal-info-row">
                    <span className="ordinal-info-label">Origin</span>
                    <span className="ordinal-info-value">
                      {selectedOrdinal.origin.slice(0, 12)}...
                    </span>
                  </div>
                  <div className="ordinal-info-row">
                    <span className="ordinal-info-label">TXID</span>
                    <button
                      className="link-btn"
                      onClick={() => openOnWoC(selectedOrdinal.txid)}
                    >
                      View on WhatsOnChain
                    </button>
                  </div>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => copyToClipboard(selectedOrdinal.origin)}
                >
                  Copy Origin
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BRC-100 Request Approval Modal */}
      {modal === 'brc100' && brc100Request && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">App Request</h2>
            </div>
            <div className="modal-content">
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 48, marginBottom: 8 }}>🔐</div>
                {brc100Request.origin && (
                  <div style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--accent)',
                    marginBottom: 8
                  }}>
                    {brc100Request.origin}
                  </div>
                )}
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                  {formatBRC100Request(brc100Request).title}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {formatBRC100Request(brc100Request).description}
                </div>
              </div>

              {/* Show request details for signatures */}
              {brc100Request.type === 'createSignature' && brc100Request.params && (
                <div style={{
                  background: 'var(--bg-secondary)',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 16,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  wordBreak: 'break-all'
                }}>
                  <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>Protocol:</div>
                  <div>{brc100Request.params.protocolID?.[1] || 'Unknown'}</div>
                  {brc100Request.params.keyID && (
                    <>
                      <div style={{ color: 'var(--text-secondary)', marginBottom: 4, marginTop: 8 }}>Key ID:</div>
                      <div>{brc100Request.params.keyID}</div>
                    </>
                  )}
                </div>
              )}

              {/* Show transaction details */}
              {brc100Request.type === 'createAction' && brc100Request.params && (
                <div style={{
                  background: 'var(--bg-secondary)',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 16,
                  fontSize: 12
                }}>
                  <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>Description:</div>
                  <div>{brc100Request.params.description || 'No description'}</div>
                  {brc100Request.params.outputs && (
                    <>
                      <div style={{ color: 'var(--text-secondary)', marginBottom: 4, marginTop: 8 }}>Outputs:</div>
                      <div>{brc100Request.params.outputs.length} output(s)</div>
                      <div>
                        Total: {brc100Request.params.outputs.reduce((sum: number, o: any) => sum + (o.satoshis || 0), 0)} sats
                      </div>
                    </>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={handleRejectBRC100}
                >
                  Reject
                </button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={handleApproveBRC100}
                >
                  Approve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
