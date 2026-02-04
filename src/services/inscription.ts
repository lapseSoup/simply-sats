/**
 * 1Sat Ordinals Inscription Parser
 *
 * Parses the inscription envelope format to extract content-type and content.
 * The 1Sat Ordinals protocol uses an envelope format that wraps content in
 * OP_FALSE OP_IF ... OP_ENDIF, followed by a P2PKH script.
 *
 * Envelope format:
 * OP_FALSE OP_IF
 *   "ord" (3 bytes)
 *   OP_1 (content-type follows)
 *   <content-type> (e.g., "text/plain")
 *   OP_0 (content follows)
 *   <content> (the actual inscription data)
 * OP_ENDIF
 * <P2PKH script> (standard lock to the ordinals address)
 */

// Common content types for inscriptions
export type InscriptionContentType =
  | 'text/plain'
  | 'text/html'
  | 'text/markdown'
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/svg+xml'
  | 'application/json'
  | 'application/octet-stream'
  | string

export interface ParsedInscription {
  // Content type from the envelope
  contentType: InscriptionContentType
  // Raw content bytes
  content: Uint8Array
  // Content as string (if text-based)
  contentString?: string
  // Whether this is a valid inscription envelope
  isValid: boolean
  // Error message if parsing failed
  error?: string
}

/**
 * Opcodes used in inscription parsing
 */
const OP_FALSE = 0x00
const OP_IF = 0x63
const OP_ENDIF = 0x68
const OP_0 = 0x00
const OP_1 = 0x51
const OP_PUSHDATA1 = 0x4c
const OP_PUSHDATA2 = 0x4d
const OP_PUSHDATA4 = 0x4e

/**
 * Read a push data element from script bytes
 * Returns [data, bytesConsumed]
 */
function readPushData(script: Uint8Array, offset: number): [Uint8Array, number] | null {
  if (offset >= script.length) return null

  const opcode = script[offset]

  // OP_0 (empty data)
  if (opcode === 0x00) {
    return [new Uint8Array(0), 1]
  }

  // Direct push (1-75 bytes)
  if (opcode >= 0x01 && opcode <= 0x4b) {
    const len = opcode
    if (offset + 1 + len > script.length) return null
    return [script.slice(offset + 1, offset + 1 + len), 1 + len]
  }

  // OP_PUSHDATA1 (next byte is length)
  if (opcode === OP_PUSHDATA1) {
    if (offset + 2 > script.length) return null
    const len = script[offset + 1]
    if (offset + 2 + len > script.length) return null
    return [script.slice(offset + 2, offset + 2 + len), 2 + len]
  }

  // OP_PUSHDATA2 (next 2 bytes are length, little-endian)
  if (opcode === OP_PUSHDATA2) {
    if (offset + 3 > script.length) return null
    const len = script[offset + 1] | (script[offset + 2] << 8)
    if (offset + 3 + len > script.length) return null
    return [script.slice(offset + 3, offset + 3 + len), 3 + len]
  }

  // OP_PUSHDATA4 (next 4 bytes are length, little-endian)
  if (opcode === OP_PUSHDATA4) {
    if (offset + 5 > script.length) return null
    const len = script[offset + 1] | (script[offset + 2] << 8) |
                (script[offset + 3] << 16) | (script[offset + 4] << 24)
    if (offset + 5 + len > script.length) return null
    return [script.slice(offset + 5, offset + 5 + len), 5 + len]
  }

  return null
}

/**
 * Parse an inscription envelope from a locking script
 *
 * @param scriptHex - Hex string of the locking script
 * @returns ParsedInscription with content-type and content
 */
export function parseInscription(scriptHex: string): ParsedInscription {
  try {
    // Convert hex to bytes
    const script = new Uint8Array(
      scriptHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
    )

    // Check for envelope start: OP_FALSE (0x00) OP_IF (0x63)
    if (script.length < 4 || script[0] !== OP_FALSE || script[1] !== OP_IF) {
      return {
        contentType: 'application/octet-stream',
        content: new Uint8Array(0),
        isValid: false,
        error: 'Not an inscription envelope (missing OP_FALSE OP_IF)'
      }
    }

    let offset = 2

    // Read "ord" marker
    const ordResult = readPushData(script, offset)
    if (!ordResult) {
      return {
        contentType: 'application/octet-stream',
        content: new Uint8Array(0),
        isValid: false,
        error: 'Failed to read ord marker'
      }
    }

    const [ordMarker, ordLen] = ordResult
    offset += ordLen

    // Verify it's "ord"
    const ordString = new TextDecoder().decode(ordMarker)
    if (ordString !== 'ord') {
      return {
        contentType: 'application/octet-stream',
        content: new Uint8Array(0),
        isValid: false,
        error: `Invalid marker: ${ordString}, expected "ord"`
      }
    }

    // Read fields until OP_0 (content marker) or OP_ENDIF
    let contentType: string = 'application/octet-stream'
    let content: Uint8Array = new Uint8Array(0)

    while (offset < script.length) {
      const opcode = script[offset]

      // OP_ENDIF - end of envelope
      if (opcode === OP_ENDIF) {
        break
      }

      // OP_1 (0x51) - content-type field follows
      if (opcode === OP_1) {
        offset++
        const ctResult = readPushData(script, offset)
        if (ctResult) {
          const [ctData, ctLen] = ctResult
          contentType = new TextDecoder().decode(ctData)
          offset += ctLen
        }
        continue
      }

      // OP_0 (0x00) - content field follows
      if (opcode === OP_0) {
        offset++
        const contentResult = readPushData(script, offset)
        if (contentResult) {
          const [contentData, contentLen] = contentResult
          content = contentData
          offset += contentLen
        }
        continue
      }

      // Other field markers (OP_2, OP_3, etc.) - skip for now
      if (opcode >= 0x52 && opcode <= 0x60) {
        offset++
        const skipResult = readPushData(script, offset)
        if (skipResult) {
          offset += skipResult[1]
        }
        continue
      }

      // Unknown opcode - try to read as push data and skip
      const pushResult = readPushData(script, offset)
      if (pushResult) {
        offset += pushResult[1]
      } else {
        // Can't parse, skip this byte
        offset++
      }
    }

    // Try to decode content as string for text types
    let contentString: string | undefined
    if (contentType.startsWith('text/') || contentType === 'application/json') {
      try {
        contentString = new TextDecoder().decode(content)
      } catch {
        // Not valid UTF-8
      }
    }

    return {
      contentType,
      content,
      contentString,
      isValid: true
    }
  } catch (error) {
    return {
      contentType: 'application/octet-stream',
      content: new Uint8Array(0),
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown parsing error'
    }
  }
}

/**
 * Check if a locking script looks like an inscription envelope
 */
export function isInscriptionScript(scriptHex: string): boolean {
  // Quick check: starts with 0063 (OP_FALSE OP_IF) and contains "ord" marker
  return scriptHex.startsWith('0063') && scriptHex.includes('036f7264')
}

/**
 * Get a human-readable description of the content type
 */
export function getContentTypeLabel(contentType: string): string {
  const labels: Record<string, string> = {
    'text/plain': 'Text',
    'text/html': 'HTML',
    'text/markdown': 'Markdown',
    'image/png': 'PNG Image',
    'image/jpeg': 'JPEG Image',
    'image/gif': 'GIF Image',
    'image/webp': 'WebP Image',
    'image/svg+xml': 'SVG Image',
    'application/json': 'JSON',
    'application/octet-stream': 'Binary Data'
  }

  return labels[contentType] || contentType
}

/**
 * Determine if content is displayable as text
 */
export function isTextContent(contentType: string): boolean {
  return (
    contentType.startsWith('text/') ||
    contentType === 'application/json' ||
    contentType === 'image/svg+xml'
  )
}

/**
 * Determine if content is an image
 */
export function isImageContent(contentType: string): boolean {
  return contentType.startsWith('image/')
}
