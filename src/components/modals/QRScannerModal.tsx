import { useState, useEffect, useRef, useCallback } from 'react'
import { Camera, Upload, AlertTriangle } from 'lucide-react'
import { Html5Qrcode } from 'html5-qrcode'
import jsQR from 'jsqr'
import { isValidBSVAddress } from '../../domain/wallet/validation'
import { Modal } from '../shared/Modal'

interface QRScannerModalProps {
  onScan: (address: string) => void
  onClose: () => void
}

type TabId = 'camera' | 'upload'

const SCANNER_CONTAINER_ID = 'qr-scanner-container'

export function QRScannerModal({ onScan, onClose }: QRScannerModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('camera')
  const [error, setError] = useState('')
  const [cameraPermissionDenied, setCameraPermissionDenied] = useState(false)
  const [scanning, setScanning] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const mountedRef = useRef(true)

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current
    if (scanner) {
      try {
        const state = scanner.getState()
        // State 2 = SCANNING, 3 = PAUSED
        if (state === 2 || state === 3) {
          await scanner.stop()
        }
      } catch (_err) {
        // Scanner may already be stopped
      }
      try {
        scanner.clear()
      } catch (_err) {
        // Container may already be cleared
      }
      scannerRef.current = null
    }
  }, [])

  const handleScanSuccess = useCallback((decodedText: string) => {
    // Strip bitcoin: or bsv: URI prefix if present
    let address = decodedText.trim()
    if (address.toLowerCase().startsWith('bitcoin:')) {
      address = address.slice(8).split('?')[0]!
    } else if (address.toLowerCase().startsWith('bsv:')) {
      address = address.slice(4).split('?')[0]!
    }

    if (isValidBSVAddress(address)) {
      void stopScanner()
      onScan(address)
      onClose()
    } else {
      setError('QR code does not contain a valid BSV address')
    }
  }, [onScan, onClose, stopScanner])

  const startScanner = useCallback(async () => {
    setError('')
    setCameraPermissionDenied(false)
    setScanning(true)

    try {
      const scanner = new Html5Qrcode(SCANNER_CONTAINER_ID)
      scannerRef.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          if (mountedRef.current) {
            handleScanSuccess(decodedText)
          }
        },
        () => {
          // QR code not detected in this frame — expected, no action needed
        }
      )
    } catch (err) {
      if (!mountedRef.current) return
      const message = err instanceof Error ? err.message : String(err)
      if (
        message.includes('NotAllowedError') ||
        message.includes('Permission') ||
        message.includes('denied')
      ) {
        setCameraPermissionDenied(true)
      } else {
        setError(`Camera error: ${message}`)
      }
    } finally {
      if (mountedRef.current) {
        setScanning(false)
      }
    }
  }, [handleScanSuccess])

  // Start camera when on camera tab
  useEffect(() => {
    mountedRef.current = true

    if (activeTab === 'camera') {
      // Small delay to ensure the container div is rendered
      const timeout = setTimeout(() => {
        void startScanner()
      }, 100)
      return () => {
        clearTimeout(timeout)
        mountedRef.current = false
        void stopScanner()
      }
    }

    return () => {
      mountedRef.current = false
    }
  }, [activeTab, startScanner, stopScanner])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false
      void stopScanner()
    }
  }, [stopScanner])

  const handleTabSwitch = useCallback((tab: TabId) => {
    if (tab === activeTab) return
    setError('')
    void stopScanner()
    setActiveTab(tab)
  }, [activeTab, stopScanner])

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setError('')
    const file = event.target.files?.[0]
    if (!file) return

    const img = new Image()
    const reader = new FileReader()

    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      img.onload = () => {
        const canvas = canvasRef.current
        if (!canvas) return

        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          setError('Failed to create canvas context')
          return
        }

        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height)

        if (code) {
          handleScanSuccess(code.data)
        } else {
          setError('No QR code found in image')
        }
      }
      img.onerror = () => {
        setError('Failed to load image')
      }
      img.src = dataUrl
    }

    reader.onerror = () => {
      setError('Failed to read file')
    }

    reader.readAsDataURL(file)

    // Reset file input so the same file can be re-selected
    event.target.value = ''
  }, [handleScanSuccess])

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  return (
    <Modal onClose={onClose} title="Scan QR Code" size="sm">
      <div className="modal-content compact">
        {/* Tab switcher */}
        <div
          style={{
            display: 'flex',
            gap: '2px',
            marginBottom: '12px',
            background: 'var(--bg-tertiary)',
            borderRadius: '8px',
            padding: '2px',
          }}
        >
          <button
            type="button"
            onClick={() => handleTabSwitch('camera')}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '8px 12px',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              background: activeTab === 'camera' ? 'var(--bg-secondary)' : 'transparent',
              color: activeTab === 'camera' ? 'var(--text-primary)' : 'var(--text-tertiary)',
              boxShadow: activeTab === 'camera' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            <Camera size={14} strokeWidth={1.75} />
            Camera
          </button>
          <button
            type="button"
            onClick={() => handleTabSwitch('upload')}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '8px 12px',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              background: activeTab === 'upload' ? 'var(--bg-secondary)' : 'transparent',
              color: activeTab === 'upload' ? 'var(--text-primary)' : 'var(--text-tertiary)',
              boxShadow: activeTab === 'upload' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            <Upload size={14} strokeWidth={1.75} />
            Upload Image
          </button>
        </div>

        {/* Camera tab */}
        {activeTab === 'camera' && (
          <div>
            {cameraPermissionDenied ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '24px 16px',
                  textAlign: 'center',
                }}
              >
                <AlertTriangle size={32} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
                <div style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500 }}>
                  Camera Access Denied
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '12px', lineHeight: 1.5 }}>
                  Camera permission was denied. Please allow camera access in your system settings, or use the Upload Image tab to scan a QR code from a saved image.
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: '12px' }}
                  onClick={() => handleTabSwitch('upload')}
                >
                  <Upload size={14} strokeWidth={1.75} />
                  Upload Image Instead
                </button>
              </div>
            ) : (
              <>
                <div
                  id={SCANNER_CONTAINER_ID}
                  style={{
                    width: '100%',
                    minHeight: '260px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-primary)',
                  }}
                />
                {scanning && (
                  <div
                    style={{
                      textAlign: 'center',
                      color: 'var(--text-tertiary)',
                      fontSize: '12px',
                      marginTop: '8px',
                    }}
                  >
                    Starting camera...
                  </div>
                )}
                <div
                  style={{
                    textAlign: 'center',
                    color: 'var(--text-tertiary)',
                    fontSize: '11px',
                    marginTop: '8px',
                  }}
                >
                  Position a QR code within the frame to scan
                </div>
              </>
            )}
          </div>
        )}

        {/* Upload tab */}
        {activeTab === 'upload' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              padding: '20px 16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                padding: '24px',
                border: '2px dashed var(--border-primary)',
                borderRadius: '12px',
                width: '100%',
                cursor: 'pointer',
              }}
              onClick={handleUploadClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleUploadClick()
                }
              }}
            >
              <Upload size={28} strokeWidth={1.5} style={{ color: 'var(--text-tertiary)' }} />
              <div style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500 }}>
                Click to select an image
              </div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>
                PNG or JPG containing a QR code
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
              aria-label="Upload QR code image"
            />
            {/* Hidden canvas for image processing */}
            <canvas ref={canvasRef} style={{ display: 'none' }} />
          </div>
        )}

        {/* Error message */}
        {error && (
          <div
            className="warning error compact"
            role="alert"
            style={{ marginTop: '8px' }}
          >
            <span className="warning-icon">
              <AlertTriangle size={16} strokeWidth={1.75} />
            </span>
            <span className="warning-text">{error}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}
