import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { PrivateKey, PublicKey } from '@bsv/sdk'
import { useWallet } from '../../contexts/WalletContext'
import { useUI } from '../../contexts/UIContext'
import {
  addDerivedAddress,
  addContact,
  getContacts,
  getNextInvoiceNumber
} from '../../services/database'
import { deriveSenderAddress, deriveChildPrivateKey } from '../../services/keyDerivation'

interface ReceiveModalProps {
  onClose: () => void
}

type ReceiveType = 'wallet' | 'ordinals' | 'brc100'

export function ReceiveModal({ onClose }: ReceiveModalProps) {
  const { wallet, contacts } = useWallet()
  const { copyToClipboard, showToast } = useUI()

  const [receiveType, setReceiveType] = useState<ReceiveType>('wallet')
  const [showDeriveMode, setShowDeriveMode] = useState(false)
  const [senderPubKeyInput, setSenderPubKeyInput] = useState('')
  const [derivedReceiveAddress, setDerivedReceiveAddress] = useState('')
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null)
  const [showAddContact, setShowAddContact] = useState(false)
  const [newContactLabel, setNewContactLabel] = useState('')
  const [currentInvoiceIndex, setCurrentInvoiceIndex] = useState<number>(1)
  const [localContacts, setLocalContacts] = useState(contacts)

  if (!wallet) return null

  const deriveReceiveAddress = (senderPubKey: string, invoiceIndex: number): string => {
    if (!wallet.identityWif) return ''
    try {
      const receiverPriv = PrivateKey.fromWif(wallet.identityWif)
      const senderPub = PublicKey.fromString(senderPubKey)
      const invoiceNumber = `2-3241645161d8-simply-sats ${invoiceIndex}`
      return deriveSenderAddress(receiverPriv, senderPub, invoiceNumber)
    } catch (e) {
      console.error('Failed to derive address:', e)
      return ''
    }
  }

  const saveDerivedAddress = async (
    senderPubKey: string,
    address: string,
    invoiceIndex: number,
    label?: string
  ): Promise<boolean> => {
    if (!wallet.identityWif) return false
    try {
      const receiverPriv = PrivateKey.fromWif(wallet.identityWif)
      const senderPub = PublicKey.fromString(senderPubKey)
      const invoiceNumber = `2-3241645161d8-simply-sats ${invoiceIndex}`
      const childPrivKey = deriveChildPrivateKey(receiverPriv, senderPub, invoiceNumber)

      await addDerivedAddress({
        address,
        senderPubkey: senderPubKey,
        invoiceNumber,
        privateKeyWif: childPrivKey.toWif(),
        label: label || `From ${senderPubKey.substring(0, 8)}...`,
        createdAt: Date.now()
      })
      return true
    } catch (e) {
      console.error('Failed to save derived address:', e)
      return false
    }
  }

  const handleContactSelect = async (id: number | null) => {
    setSelectedContactId(id)
    if (id) {
      const contact = localContacts.find(c => c.id === id)
      if (contact) {
        setSenderPubKeyInput(contact.pubkey)
        const nextIndex = await getNextInvoiceNumber(contact.pubkey)
        setCurrentInvoiceIndex(nextIndex)
        setDerivedReceiveAddress(deriveReceiveAddress(contact.pubkey, nextIndex))
      }
    } else {
      setSenderPubKeyInput('')
      setDerivedReceiveAddress('')
      setCurrentInvoiceIndex(1)
    }
  }

  const handlePubKeyChange = async (val: string) => {
    setSenderPubKeyInput(val)
    setSelectedContactId(null)
    if (val.length >= 66) {
      const nextIndex = await getNextInvoiceNumber(val)
      setCurrentInvoiceIndex(nextIndex)
      setDerivedReceiveAddress(deriveReceiveAddress(val, nextIndex))
    } else {
      setDerivedReceiveAddress('')
      setCurrentInvoiceIndex(1)
    }
  }

  const handleSaveContact = async () => {
    if (newContactLabel.trim()) {
      await addContact({
        pubkey: senderPubKeyInput,
        label: newContactLabel.trim(),
        createdAt: Date.now()
      })
      const updated = await getContacts()
      setLocalContacts(updated)
      setShowAddContact(false)
      setNewContactLabel('')
      showToast('Contact saved!')
    }
  }

  const handleCopyAndSave = async () => {
    await copyToClipboard(derivedReceiveAddress, 'Address copied!')
    const contact = localContacts.find(c => c.pubkey === senderPubKeyInput)
    const saved = await saveDerivedAddress(senderPubKeyInput, derivedReceiveAddress, currentInvoiceIndex, contact?.label)
    if (saved) {
      showToast('Address saved & copied!')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal send-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Receive</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content compact">
          <div className="pill-tabs compact" role="tablist">
            <button
              className={`pill-tab ${receiveType === 'wallet' ? 'active' : ''}`}
              onClick={() => setReceiveType('wallet')}
              role="tab"
              aria-selected={receiveType === 'wallet'}
            >
              Payment
            </button>
            <button
              className={`pill-tab ${receiveType === 'ordinals' ? 'active' : ''}`}
              onClick={() => setReceiveType('ordinals')}
              role="tab"
              aria-selected={receiveType === 'ordinals'}
            >
              Ordinals
            </button>
            <button
              className={`pill-tab ${receiveType === 'brc100' ? 'active' : ''}`}
              onClick={() => {
                setReceiveType('brc100')
                setShowDeriveMode(false)
                setSenderPubKeyInput('')
                setDerivedReceiveAddress('')
              }}
              role="tab"
              aria-selected={receiveType === 'brc100'}
            >
              Identity
            </button>
          </div>

          {receiveType === 'brc100' ? (
            <div className="qr-container compact">
              {!showDeriveMode ? (
                <>
                  <div className="brc100-qr-label" style={{ marginBottom: 8 }}>Your Identity Public Key</div>
                  <div className="qr-wrapper compact">
                    <QRCodeSVG value={wallet.identityPubKey} size={100} level="L" bgColor="#fff" fgColor="#000" />
                  </div>
                  <div className="address-display compact" style={{ marginTop: 12 }}>
                    {wallet.identityPubKey}
                  </div>
                  <button
                    className="copy-btn compact"
                    onClick={() => copyToClipboard(wallet.identityPubKey, 'Public key copied!')}
                  >
                    📋 Copy Public Key
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      setShowDeriveMode(true)
                      setSenderPubKeyInput('')
                      setDerivedReceiveAddress('')
                      setSelectedContactId(null)
                      setShowAddContact(false)
                      setNewContactLabel('')
                      setCurrentInvoiceIndex(1)
                    }}
                  >
                    🔐 Generate Receive Address
                  </button>
                  <div className="address-type-hint">
                    Share your public key with sender for BRC-100 payments
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group" style={{ width: '100%', marginBottom: 12 }}>
                    <label className="form-label">Sender (Contact)</label>
                    {localContacts.length > 0 && (
                      <select
                        className="form-input"
                        value={selectedContactId || ''}
                        onChange={(e) => handleContactSelect(e.target.value ? parseInt(e.target.value) : null)}
                        style={{ marginBottom: 8 }}
                      >
                        <option value="">-- Select a contact --</option>
                        {localContacts.map(c => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                    )}
                    <input
                      type="text"
                      className="form-input mono"
                      placeholder="Or enter sender's identity public key..."
                      value={senderPubKeyInput}
                      onChange={(e) => handlePubKeyChange(e.target.value.trim())}
                      style={{ fontSize: 11 }}
                    />
                    {/* Add contact button */}
                    {senderPubKeyInput.length >= 66 && !localContacts.find(c => c.pubkey === senderPubKeyInput) && (
                      <div style={{ marginTop: 8 }}>
                        {!showAddContact ? (
                          <button
                            className="btn btn-small"
                            onClick={() => setShowAddContact(true)}
                            style={{ fontSize: 11, padding: '4px 8px' }}
                          >
                            ➕ Save as Contact
                          </button>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                            <input
                              type="text"
                              className="form-input"
                              placeholder="Enter contact name..."
                              value={newContactLabel}
                              onChange={(e) => setNewContactLabel(e.target.value)}
                              style={{ fontSize: 14, padding: '10px 12px', width: '100%', boxSizing: 'border-box' }}
                              autoFocus
                            />
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                className="btn btn-secondary"
                                onClick={() => {
                                  setShowAddContact(false)
                                  setNewContactLabel('')
                                }}
                                style={{ flex: 1 }}
                              >
                                Cancel
                              </button>
                              <button
                                className="btn btn-primary"
                                onClick={handleSaveContact}
                                style={{ flex: 1 }}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {derivedReceiveAddress ? (
                    <>
                      <div className="brc100-qr-label" style={{ marginBottom: 8 }}>
                        Derived Payment Address #{currentInvoiceIndex}
                      </div>
                      <div className="qr-wrapper compact">
                        <QRCodeSVG value={derivedReceiveAddress} size={100} level="M" bgColor="#fff" fgColor="#000" />
                      </div>
                      <div className="address-display compact" style={{ marginTop: 12 }}>
                        {derivedReceiveAddress}
                      </div>
                      <button
                        className="copy-btn compact"
                        onClick={handleCopyAndSave}
                      >
                        📋 Copy & Save Address
                      </button>
                      <div className="address-type-hint" style={{ marginTop: 4, fontSize: 10 }}>
                        New address after funds received
                      </div>
                    </>
                  ) : (
                    <div className="address-type-hint" style={{ padding: '40px 0' }}>
                      {localContacts.length > 0 ? 'Select a contact or enter public key' : 'Enter sender\'s public key to generate a unique receive address'}
                    </div>
                  )}
                  <button
                    className="btn btn-secondary"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      setShowDeriveMode(false)
                      setSenderPubKeyInput('')
                      setDerivedReceiveAddress('')
                      setSelectedContactId(null)
                      setShowAddContact(false)
                    }}
                  >
                    ← Back
                  </button>
                  <div className="address-type-hint">
                    Each address is unique to this sender (BRC-100)
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="qr-container compact">
              <div className="qr-wrapper compact">
                <QRCodeSVG
                  value={receiveType === 'wallet' ? wallet.walletAddress : wallet.ordAddress}
                  size={120}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
              <div className="address-display compact">
                {receiveType === 'wallet' ? wallet.walletAddress : wallet.ordAddress}
              </div>
              <button
                className="copy-btn compact"
                onClick={() => copyToClipboard(
                  receiveType === 'wallet' ? wallet.walletAddress : wallet.ordAddress,
                  'Address copied!'
                )}
              >
                📋 Copy Address
              </button>
              <div className="address-type-hint">
                {receiveType === 'wallet'
                  ? 'Standard payment address — same address each time'
                  : 'Use for receiving 1Sat Ordinals & inscriptions'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
