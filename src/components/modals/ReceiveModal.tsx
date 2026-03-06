import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Copy } from 'lucide-react'
import { useWalletState, useWalletActions } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { Modal } from '../shared/Modal'
import { useReceiveAddressing } from '../../hooks/useReceiveAddressing'

interface ReceiveModalProps {
  onClose: () => void
}

type ReceiveType = 'wallet' | 'ordinals' | 'brc100'

export function ReceiveModal({ onClose }: ReceiveModalProps) {
  const { wallet, contacts, activeAccountId } = useWalletState()
  const { refreshContacts } = useWalletActions()
  const { copyToClipboard, showToast } = useUI()
  const {
    deriveReceiveAddress: deriveReceiveAddressFromStore,
    saveDerivedAddress,
    fetchNextInvoiceNumber,
    saveContact
  } = useReceiveAddressing(activeAccountId, refreshContacts, showToast)

  const [receiveType, setReceiveType] = useState<ReceiveType>('wallet')
  const [showDeriveMode, setShowDeriveMode] = useState(false)
  const [senderPubKeyInput, setSenderPubKeyInput] = useState('')
  const [derivedReceiveAddress, setDerivedReceiveAddress] = useState('')
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null)
  const [showAddContact, setShowAddContact] = useState(false)
  const [newContactLabel, setNewContactLabel] = useState('')
  const [currentInvoiceIndex, setCurrentInvoiceIndex] = useState<number>(1)
  const [localContacts, setLocalContacts] = useState(contacts)
  const [derivationError, setDerivationError] = useState<string | null>(null)

  const deriveReceiveAddress = async (senderPubKey: string, invoiceIndex: number): Promise<string> => {
    if (!wallet) return ''
    setDerivationError(null)
    try {
      return await deriveReceiveAddressFromStore(senderPubKey, invoiceIndex)
    } catch {
      setDerivationError('Failed to derive address. Check the sender public key.')
      return ''
    }
  }

  const handleContactSelect = async (id: number | null) => {
    setSelectedContactId(id)
    if (id) {
      const contact = localContacts.find(c => c.id === id)
      if (contact) {
        setSenderPubKeyInput(contact.pubkey)
        const nextIndex = await fetchNextInvoiceNumber(contact.pubkey)
        setCurrentInvoiceIndex(nextIndex)
        setDerivedReceiveAddress(await deriveReceiveAddress(contact.pubkey, nextIndex))
      }
    } else {
      setSenderPubKeyInput('')
      setDerivedReceiveAddress('')
      setDerivationError(null)
      setCurrentInvoiceIndex(1)
    }
  }

  const handlePubKeyChange = async (val: string) => {
    setSenderPubKeyInput(val)
    setSelectedContactId(null)
    if (val.length >= 66) {
      const nextIndex = await fetchNextInvoiceNumber(val)
      setCurrentInvoiceIndex(nextIndex)
      setDerivedReceiveAddress(await deriveReceiveAddress(val, nextIndex))
    } else {
      setDerivedReceiveAddress('')
      setDerivationError(null)
      setCurrentInvoiceIndex(1)
    }
  }

  const handleSaveContact = async () => {
    if (newContactLabel.trim()) {
      const updatedContacts = await saveContact(senderPubKeyInput, newContactLabel.trim())
      if (updatedContacts) {
        setLocalContacts(updatedContacts)
        setShowAddContact(false)
        setNewContactLabel('')
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
                  <div className="receive-brc100-hint">
                    Each sender gets a unique address derived from your identity key
                  </div>
                  <div className="brc100-qr-label receive-brc100-label">Your Identity Public Key</div>
                  <div className="qr-wrapper compact receive-qr-compact">
                    <QRCodeSVG value={wallet.identityPubKey} size={64} level="L" bgColor="#fff" fgColor="#000" aria-label={`QR code for identity key ${wallet.identityPubKey.slice(0, 8)}...`} />
                  </div>
                  <div className="address-display compact">
                    {wallet.identityPubKey}
                  </div>
                  <button
                    className="copy-btn compact"
                    onClick={() => copyToClipboard(wallet.identityPubKey, 'Public key copied!')}
                  >
                    Copy Identity Key
                  </button>
                  <button
                    className="btn btn-primary receive-generate-btn"
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
                    <div className="contact-quick-select">
                      <div className="contact-quick-select-label">
                        Quick select a contact:
                      </div>
                      <div className="contact-chips">
                        {localContacts.slice(0, 4).map(c => (
                          <button
                            key={c.id}
                            className={`contact-chip ${selectedContactId === c.id ? 'active' : ''}`}
                            onClick={() => handleContactSelect(c.id!)}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="form-group receive-form-group">
                    <label className="form-label receive-form-label" htmlFor="sender-pubkey">
                      {localContacts.length > 0 ? 'Or enter public key manually:' : "Sender's Identity Public Key"}
                    </label>
                    <input
                      id="sender-pubkey"
                      type="text"
                      className="form-input mono receive-pubkey-input"
                      placeholder="Enter sender's identity public key (66 characters)..."
                      value={senderPubKeyInput}
                      onChange={(e) => handlePubKeyChange(e.target.value.trim())}
                    />
                    {/* Add contact button */}
                    {senderPubKeyInput.length >= 66 && !localContacts.find(c => c.pubkey === senderPubKeyInput) && (
                      <div className="receive-add-contact-row">
                        {!showAddContact ? (
                          <button
                            className="btn btn-small receive-save-btn"
                            onClick={() => setShowAddContact(true)}
                          >
                            + Save as Contact
                          </button>
                        ) : (
                          <div className="receive-contact-form">
                            <label htmlFor="new-contact-name" className="sr-only">Contact name</label>
                            <input
                              id="new-contact-name"
                              type="text"
                              className="form-input receive-contact-input"
                              placeholder="Contact name (e.g., Alice, Bob's Shop)..."
                              value={newContactLabel}
                              onChange={(e) => setNewContactLabel(e.target.value)}
                              autoFocus
                            />
                            <div className="receive-contact-actions">
                              <button
                                className="btn btn-secondary"
                                onClick={() => {
                                  setShowAddContact(false)
                                  setNewContactLabel('')
                                }}
                              >
                                Cancel
                              </button>
                              <button
                                className="btn btn-primary"
                                onClick={handleSaveContact}
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
                      <div className="derived-result">
                        <div className="derived-result-label">
                          Private Address #{currentInvoiceIndex}
                        </div>
                        <div className="qr-wrapper compact">
                          <QRCodeSVG value={derivedReceiveAddress} size={100} level="M" bgColor="#fff" fgColor="#000" aria-label={`QR code for address ${derivedReceiveAddress.slice(0, 8)}...`} />
                        </div>
                        <div className="address-display compact">
                          {derivedReceiveAddress}
                        </div>
                        <button
                          className="btn btn-primary"
                          onClick={handleCopyAndSave}
                        >
                          Copy & Save Address
                        </button>
                      </div>
                      <div className="address-type-hint receive-hint-bottom">
                        This address is unique to this sender. A new one will be generated after payment.
                      </div>
                    </>
                  ) : derivationError ? (
                    <div className="form-error" role="alert">
                      {derivationError}
                    </div>
                  ) : (
                    <div className="address-type-hint receive-hint-centered">
                      {localContacts.length > 0
                        ? 'Select a contact above or enter a public key'
                        : 'Enter the sender\'s public key to generate a unique address'}
                    </div>
                  )}

                  <button
                    className="btn btn-secondary receive-back-btn"
                    onClick={() => {
                      setShowDeriveMode(false)
                      setSenderPubKeyInput('')
                      setDerivedReceiveAddress('')
                      setDerivationError(null)
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
            <div id={`receive-panel-${receiveType}`} role="tabpanel" aria-labelledby={`receive-tab-${receiveType}`} className="qr-container compact receive-qr-panel">
              <div className="qr-wrapper compact">
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
              >
                <Copy size={14} strokeWidth={1.75} />
                Copy Address
              </button>
              <div className="address-type-hint compact">
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
