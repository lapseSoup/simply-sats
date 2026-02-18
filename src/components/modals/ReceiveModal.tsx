import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { PrivateKey, PublicKey } from '@bsv/sdk'
import { Copy } from 'lucide-react'
import { useWalletState, useWalletActions } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { Modal } from '../shared/Modal'
import {
  addDerivedAddress,
  addContact,
  getContacts,
  getNextInvoiceNumber
} from '../../infrastructure/database'
import { deriveSenderAddress, deriveChildPrivateKey } from '../../services/keyDerivation'
import { uiLogger } from '../../services/logger'
import { BRC100 } from '../../config'

interface ReceiveModalProps {
  onClose: () => void
}

type ReceiveType = 'wallet' | 'ordinals' | 'brc100'

export function ReceiveModal({ onClose }: ReceiveModalProps) {
  const { wallet, contacts, activeAccountId } = useWalletState()
  const { refreshContacts } = useWalletActions()
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

  const deriveReceiveAddress = async (senderPubKey: string, invoiceIndex: number): Promise<string> => {
    if (!wallet) return ''
    try {
      const { getWifForOperation } = await import('../../services/wallet')
      const identityWif = await getWifForOperation('identity', 'deriveReceiveAddress', wallet)
      const receiverPriv = PrivateKey.fromWif(identityWif)
      const senderPub = PublicKey.fromString(senderPubKey)
      const invoiceNumber = `${BRC100.INVOICE_PREFIX} ${invoiceIndex}`
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
    if (!wallet) return false
    try {
      const { getWifForOperation } = await import('../../services/wallet')
      const identityWif = await getWifForOperation('identity', 'saveDerivedAddress', wallet)
      const receiverPriv = PrivateKey.fromWif(identityWif)
      const senderPub = PublicKey.fromString(senderPubKey)
      const invoiceNumber = `${BRC100.INVOICE_PREFIX} ${invoiceIndex}`
      const childPrivKey = deriveChildPrivateKey(receiverPriv, senderPub, invoiceNumber)

      await addDerivedAddress({
        address,
        senderPubkey: senderPubKey,
        invoiceNumber,
        privateKeyWif: childPrivKey.toWif(),
        label: label || `From ${senderPubKey.substring(0, 8)}...`,
        createdAt: Date.now()
      }, activeAccountId ?? undefined)
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
        setDerivedReceiveAddress(await deriveReceiveAddress(contact.pubkey, nextIndex))
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
      setDerivedReceiveAddress(await deriveReceiveAddress(val, nextIndex))
    } else {
      setDerivedReceiveAddress('')
      setCurrentInvoiceIndex(1)
    }
  }

  const handleSaveContact = async () => {
    if (newContactLabel.trim()) {
      try {
        await addContact({
          pubkey: senderPubKeyInput,
          label: newContactLabel.trim(),
          createdAt: Date.now()
        })
        const updatedResult = await getContacts()
        if (!updatedResult.ok) {
          uiLogger.error('Failed to reload contacts', updatedResult.error)
        } else {
          setLocalContacts(updatedResult.value)
        }
        await refreshContacts()
        setShowAddContact(false)
        setNewContactLabel('')
        showToast('Contact saved!')
      } catch (e) {
        uiLogger.error('Failed to save contact', e)
        showToast('Failed to save contact', 'error')
      }
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

  if (!wallet) return null

  return (
    <Modal onClose={onClose} title="Receive" className="send-modal">
      <div className="modal-content compact">
          <div className="pill-tabs compact" role="tablist" aria-label="Receive type">
            <button
              id="receive-tab-wallet"
              className={`pill-tab ${receiveType === 'wallet' ? 'active' : ''}`}
              onClick={() => setReceiveType('wallet')}
              role="tab"
              aria-selected={receiveType === 'wallet'}
              aria-controls="receive-panel-wallet"
              title="Standard payment address"
            >
              Payment
            </button>
            <button
              id="receive-tab-ordinals"
              className={`pill-tab ${receiveType === 'ordinals' ? 'active' : ''}`}
              onClick={() => setReceiveType('ordinals')}
              role="tab"
              aria-selected={receiveType === 'ordinals'}
              aria-controls="receive-panel-ordinals"
              title="Address for receiving NFTs and inscriptions"
            >
              Ordinals
            </button>
            <button
              id="receive-tab-brc100"
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
              aria-controls="receive-panel-brc100"
              title="Generate unique address per sender for enhanced privacy"
            >
              Private
            </button>
          </div>

          {receiveType === 'brc100' ? (
            <div id="receive-panel-brc100" role="tabpanel" aria-labelledby="receive-tab-brc100" className="qr-container compact">
              {!showDeriveMode ? (
                <>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.4, textAlign: 'center' }}>
                    Each sender gets a unique address derived from your identity key
                  </div>
                  <div className="brc100-qr-label" style={{ fontSize: 12 }}>Your Identity Public Key</div>
                  <div className="qr-wrapper compact" style={{ padding: 8 }}>
                    <QRCodeSVG value={wallet.identityPubKey} size={64} level="L" bgColor="#fff" fgColor="#000" aria-label={`QR code for identity key ${wallet.identityPubKey.slice(0, 8)}...`} />
                  </div>
                  <div className="address-display compact">
                    {wallet.identityPubKey}
                  </div>
                  <button
                    className="copy-btn compact"
                    onClick={() => copyToClipboard(wallet.identityPubKey, 'Public key copied!')}
                    style={{ padding: '8px 12px' }}
                  >
                    Copy Identity Key
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '10px 16px' }}
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
                    <label className="form-label" htmlFor="sender-pubkey" style={{ fontSize: 12, marginBottom: 6 }}>
                      {localContacts.length > 0 ? 'Or enter public key manually:' : "Sender's Identity Public Key"}
                    </label>
                    <input
                      id="sender-pubkey"
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
                            <label htmlFor="new-contact-name" className="sr-only">Contact name</label>
                            <input
                              id="new-contact-name"
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
                          <QRCodeSVG value={derivedReceiveAddress} size={100} level="M" bgColor="#fff" fgColor="#000" aria-label={`QR code for address ${derivedReceiveAddress.slice(0, 8)}...`} />
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
            <div id={`receive-panel-${receiveType}`} role="tabpanel" aria-labelledby={`receive-tab-${receiveType}`} className="qr-container compact">
              <div className="qr-wrapper compact" style={{ padding: 10 }}>
                <QRCodeSVG
                  value={receiveType === 'wallet' ? wallet.walletAddress : wallet.ordAddress}
                  size={100}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                  aria-label={`QR code for ${receiveType} address ${(receiveType === 'wallet' ? wallet.walletAddress : wallet.ordAddress).slice(0, 8)}...`}
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
                style={{ padding: '8px 12px' }}
              >
<Copy size={14} strokeWidth={1.75} style={{ marginRight: 6 }} />
                Copy Address
              </button>
              <div className="address-type-hint" style={{ fontSize: 11, minHeight: 'auto' }}>
                {receiveType === 'wallet'
                  ? 'Standard payment address — same address each time'
                  : 'Use for receiving 1Sat Ordinals & inscriptions'}
              </div>
            </div>
          )}
        </div>
      </Modal>
  )
}
