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
import { uiLogger } from '../../services/logger'

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
      uiLogger.error('Failed to derive address:', e)
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
      uiLogger.error('Failed to save derived address:', e)
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
              title="Standard payment address"
            >
              Payment
            </button>
            <button
              className={`pill-tab ${receiveType === 'ordinals' ? 'active' : ''}`}
              onClick={() => setReceiveType('ordinals')}
              role="tab"
              aria-selected={receiveType === 'ordinals'}
              title="Address for receiving NFTs and inscriptions"
            >
              Ordinals
            </button>
            <button
              className={`pill-tab ${receiveType === 'brc100' ? 'active' : ''}`}
              onClick={() => {
                setReceiveType('brc100')
                // If user has contacts, go directly to derive mode
                if (localContacts.length > 0) {
                  setShowDeriveMode(true)
                } else {
                  setShowDeriveMode(false)
                }
                setSenderPubKeyInput('')
                setDerivedReceiveAddress('')
              }}
              role="tab"
              aria-selected={receiveType === 'brc100'}
              title="Generate unique address per sender for enhanced privacy"
            >
              Private
            </button>
          </div>

          {receiveType === 'brc100' ? (
            <div className="qr-container compact">
              {!showDeriveMode ? (
                <>
                  <div className="private-intro" style={{ textAlign: 'center', marginBottom: 16 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
                      Private addresses let you receive payments without reusing the same address.
                      Each sender gets a unique address derived from your identity key.
                    </div>
                  </div>
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
                    Copy Identity Key
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 12, width: '100%' }}
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
                    Generate Private Address
                  </button>
                  <div className="address-type-hint" style={{ marginTop: 8 }}>
                    Share your identity key with the sender, then generate a unique address for them
                  </div>
                </>
              ) : (
                <>
                  {/* Quick Contact Selection */}
                  {localContacts.length > 0 && !derivedReceiveAddress && (
                    <div className="contact-quick-select" style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                        Quick select a contact:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {localContacts.slice(0, 4).map(c => (
                          <button
                            key={c.id}
                            className={`contact-chip ${selectedContactId === c.id ? 'active' : ''}`}
                            onClick={() => handleContactSelect(c.id!)}
                            style={{
                              padding: '6px 12px',
                              borderRadius: '16px',
                              border: selectedContactId === c.id ? '1px solid var(--primary)' : '1px solid var(--border)',
                              background: selectedContactId === c.id ? 'var(--primary-bg)' : 'transparent',
                              color: 'var(--text-primary)',
                              fontSize: 12,
                              cursor: 'pointer'
                            }}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="form-group" style={{ width: '100%', marginBottom: 12 }}>
                    <label className="form-label" style={{ fontSize: 12, marginBottom: 6 }}>
                      {localContacts.length > 0 ? 'Or enter public key manually:' : "Sender's Identity Public Key"}
                    </label>
                    <input
                      type="text"
                      className="form-input mono"
                      placeholder="Enter sender's identity public key (66 characters)..."
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
                            style={{ fontSize: 12, padding: '6px 12px' }}
                          >
                            + Save as Contact
                          </button>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                            <input
                              type="text"
                              className="form-input"
                              placeholder="Contact name (e.g., Alice, Bob's Shop)..."
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
                                Save Contact
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {derivedReceiveAddress ? (
                    <>
                      <div className="derived-result" style={{
                        background: 'var(--bg-success, rgba(34, 197, 94, 0.1))',
                        border: '1px solid var(--border-success, rgba(34, 197, 94, 0.3))',
                        borderRadius: 12,
                        padding: 16,
                        marginTop: 8
                      }}>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, textAlign: 'center' }}>
                          Private Address #{currentInvoiceIndex}
                        </div>
                        <div className="qr-wrapper compact" style={{ display: 'flex', justifyContent: 'center' }}>
                          <QRCodeSVG value={derivedReceiveAddress} size={100} level="M" bgColor="#fff" fgColor="#000" />
                        </div>
                        <div className="address-display compact" style={{ marginTop: 12, textAlign: 'center' }}>
                          {derivedReceiveAddress}
                        </div>
                        <button
                          className="btn btn-primary"
                          style={{ width: '100%', marginTop: 12 }}
                          onClick={handleCopyAndSave}
                        >
                          Copy & Save Address
                        </button>
                      </div>
                      <div className="address-type-hint" style={{ marginTop: 8, fontSize: 11, textAlign: 'center' }}>
                        This address is unique to this sender. A new one will be generated after payment.
                      </div>
                    </>
                  ) : (
                    <div className="address-type-hint" style={{ padding: '24px 0', textAlign: 'center' }}>
                      {localContacts.length > 0
                        ? 'Select a contact above or enter a public key'
                        : 'Enter the sender\'s public key to generate a unique address'}
                    </div>
                  )}

                  <button
                    className="btn btn-secondary"
                    style={{ marginTop: 16, width: '100%' }}
                    onClick={() => {
                      setShowDeriveMode(false)
                      setSenderPubKeyInput('')
                      setDerivedReceiveAddress('')
                      setSelectedContactId(null)
                      setShowAddContact(false)
                    }}
                  >
                    Back to Identity Key
                  </button>
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
