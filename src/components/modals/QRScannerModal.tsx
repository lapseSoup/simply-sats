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
      address = address.slice(8).split('?')[0] ?? address
    } else if (address.toLowerCase().startsWith('bsv:')) {
      address = address.slice(4).split('?')[0] ?? address
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
        <div className="qr-tab-switcher">
          <button
            type="button"
            onClick={() => handleTabSwitch('camera')}
            className={`qr-tab-btn ${activeTab === 'camera' ? 'active' : ''}`}
          >
            <Camera size={14} strokeWidth={1.75} />
            Camera
          </button>
          <button
            type="button"
            onClick={() => handleTabSwitch('upload')}
            className={`qr-tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
          >
            <Upload size={14} strokeWidth={1.75} />
            Upload Image
          </button>
        </div>

        {/* Camera tab */}
        {activeTab === 'camera' && (
          <div>
            {cameraPermissionDenied ? (
              <div className="qr-permission-denied">
                <AlertTriangle size={32} strokeWidth={1.5} className="qr-warning-icon" />
                <div className="qr-permission-text">
                  Camera Access Denied
                </div>
                <div className="qr-permission-subtext">
                  Camera permission was denied. Please allow camera access in your system settings, or use the Upload Image tab to scan a QR code from a saved image.
                </div>
                <button
                  type="button"
                  className="btn btn-ghost qr-permission-subtext"
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
                  className="qr-scanner-container"
                />
                {scanning && (
                  <div className="qr-scanner-hint">
                    Starting camera...
                  </div>
                )}
                <div className="qr-scanner-hint">
                  Position a QR code within the frame to scan
                </div>
              </>
            )}
          </div>
        )}

        {/* Upload tab */}
        {activeTab === 'upload' && (
          <div className="qr-upload-container">
            <div
              className="qr-upload-area"
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
              <Upload size={28} strokeWidth={1.5} className="qr-upload-icon" />
              <div className="qr-upload-label">
                Click to select an image
              </div>
              <div className="qr-upload-sublabel">
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
