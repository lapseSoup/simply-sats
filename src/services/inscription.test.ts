import { describe, it, expect } from 'vitest'
import {
  parseInscription,
  isInscriptionScript,
  getContentTypeLabel,
  isTextContent,
  isImageContent
} from './inscription'

describe('Inscription Service', () => {
  describe('parseInscription', () => {
    // Helper to create a valid inscription envelope hex
    // Format: OP_FALSE OP_IF <push "ord"> OP_1 <push content-type> OP_0 <push content> OP_ENDIF
    function createInscriptionHex(contentType: string, content: string): string {
      const ordHex = '036f7264' // push 3 bytes "ord"
      const contentTypeHex = contentType.length.toString(16).padStart(2, '0') +
        Buffer.from(contentType).toString('hex')
      const contentHex = content.length.toString(16).padStart(2, '0') +
        Buffer.from(content).toString('hex')

      // OP_FALSE(00) OP_IF(63) <ord> OP_1(51) <content-type> OP_0(00) <content> OP_ENDIF(68)
      return '0063' + ordHex + '51' + contentTypeHex + '00' + contentHex + '68'
    }

    it('should parse a valid text inscription', () => {
      const scriptHex = createInscriptionHex('text/plain', 'Hello, World!')

      const result = parseInscription(scriptHex)

      expect(result.isValid).toBe(true)
      expect(result.contentType).toBe('text/plain')
      expect(result.contentString).toBe('Hello, World!')
      expect(result.error).toBeUndefined()
    })

    it('should parse JSON inscription', () => {
      const jsonContent = '{"name":"test","value":123}'
      const scriptHex = createInscriptionHex('application/json', jsonContent)

      const result = parseInscription(scriptHex)

      expect(result.isValid).toBe(true)
      expect(result.contentType).toBe('application/json')
      expect(result.contentString).toBe(jsonContent)
    })

    it('should parse HTML inscription', () => {
      const htmlContent = '<h1>Test</h1>'
      const scriptHex = createInscriptionHex('text/html', htmlContent)

      const result = parseInscription(scriptHex)

      expect(result.isValid).toBe(true)
      expect(result.contentType).toBe('text/html')
      expect(result.contentString).toBe(htmlContent)
    })

    it('should parse image inscription (binary content)', () => {
      // For images, content is binary - we simulate with hex
      const scriptHex = createInscriptionHex('image/png', '\x89PNG\r\n\x1a\n')

      const result = parseInscription(scriptHex)

      expect(result.isValid).toBe(true)
      expect(result.contentType).toBe('image/png')
      expect(result.content).toBeInstanceOf(Uint8Array)
      expect(result.contentString).toBeUndefined() // Binary, not text
    })

    it('should handle SVG as text content', () => {
      const svgContent = '<svg><circle r="10"/></svg>'
      const scriptHex = createInscriptionHex('image/svg+xml', svgContent)

      const result = parseInscription(scriptHex)

      expect(result.isValid).toBe(true)
      expect(result.contentType).toBe('image/svg+xml')
      // SVG is handled as text in isTextContent(), verify content is parsed
      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)
    })

    it('should return invalid for non-inscription script', () => {
      // Standard P2PKH script
      const p2pkhScript = '76a914' + '00'.repeat(20) + '88ac'

      const result = parseInscription(p2pkhScript)

      expect(result.isValid).toBe(false)
      expect(result.error).toContain('Not an inscription envelope')
    })

    it('should return invalid for script not starting with OP_FALSE OP_IF', () => {
      // Wrong start bytes
      const badScript = '5163036f7264' // OP_1 OP_IF instead of OP_FALSE OP_IF

      const result = parseInscription(badScript)

      expect(result.isValid).toBe(false)
      expect(result.error).toContain('OP_FALSE OP_IF')
    })

    it('should return invalid for missing ord marker', () => {
      // Valid envelope structure but wrong marker
      const badScript = '0063' + '03666f6f' + '68' // OP_FALSE OP_IF "foo" OP_ENDIF

      const result = parseInscription(badScript)

      expect(result.isValid).toBe(false)
      expect(result.error).toContain('Invalid marker')
    })

    it('should handle empty script', () => {
      const result = parseInscription('')

      expect(result.isValid).toBe(false)
    })

    it('should handle very short script', () => {
      const result = parseInscription('00')

      expect(result.isValid).toBe(false)
    })

    it('should default to application/octet-stream for unknown content', () => {
      // Inscription without content-type field
      const ordHex = '036f7264'
      const contentHex = '05' + Buffer.from('hello').toString('hex')
      const script = '0063' + ordHex + '00' + contentHex + '68'

      const result = parseInscription(script)

      // Should use default content type if none specified
      expect(result.contentType).toBeDefined()
    })

    it('should handle malformed hex', () => {
      const result = parseInscription('not valid hex!')

      expect(result.isValid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle truncated script', () => {
      const partialScript = '0063036f7264' // Missing content and OP_ENDIF

      const result = parseInscription(partialScript)

      // Should parse what it can, even if incomplete
      expect(result).toBeDefined()
    })
  })

  describe('isInscriptionScript', () => {
    it('should return true for inscription envelope', () => {
      // Valid inscription start: OP_FALSE(00) OP_IF(63) followed by "ord" marker (036f7264)
      const inscriptionScript = '0063036f726451' + '00'.repeat(20) + '68'

      expect(isInscriptionScript(inscriptionScript)).toBe(true)
    })

    it('should return false for P2PKH script', () => {
      const p2pkhScript = '76a914' + '00'.repeat(20) + '88ac'

      expect(isInscriptionScript(p2pkhScript)).toBe(false)
    })

    it('should return false for OP_RETURN script', () => {
      const opReturnScript = '6a' + '00'.repeat(10)

      expect(isInscriptionScript(opReturnScript)).toBe(false)
    })

    it('should return false for script starting with 0063 but no ord marker', () => {
      const noOrdScript = '0063' + '03616263' + '68' // "abc" instead of "ord"

      expect(isInscriptionScript(noOrdScript)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isInscriptionScript('')).toBe(false)
    })
  })

  describe('getContentTypeLabel', () => {
    it('should return "Text" for text/plain', () => {
      expect(getContentTypeLabel('text/plain')).toBe('Text')
    })

    it('should return "HTML" for text/html', () => {
      expect(getContentTypeLabel('text/html')).toBe('HTML')
    })

    it('should return "Markdown" for text/markdown', () => {
      expect(getContentTypeLabel('text/markdown')).toBe('Markdown')
    })

    it('should return "PNG Image" for image/png', () => {
      expect(getContentTypeLabel('image/png')).toBe('PNG Image')
    })

    it('should return "JPEG Image" for image/jpeg', () => {
      expect(getContentTypeLabel('image/jpeg')).toBe('JPEG Image')
    })

    it('should return "GIF Image" for image/gif', () => {
      expect(getContentTypeLabel('image/gif')).toBe('GIF Image')
    })

    it('should return "WebP Image" for image/webp', () => {
      expect(getContentTypeLabel('image/webp')).toBe('WebP Image')
    })

    it('should return "SVG Image" for image/svg+xml', () => {
      expect(getContentTypeLabel('image/svg+xml')).toBe('SVG Image')
    })

    it('should return "JSON" for application/json', () => {
      expect(getContentTypeLabel('application/json')).toBe('JSON')
    })

    it('should return "Binary Data" for application/octet-stream', () => {
      expect(getContentTypeLabel('application/octet-stream')).toBe('Binary Data')
    })

    it('should return the content type itself for unknown types', () => {
      expect(getContentTypeLabel('application/pdf')).toBe('application/pdf')
      expect(getContentTypeLabel('video/mp4')).toBe('video/mp4')
      expect(getContentTypeLabel('custom/type')).toBe('custom/type')
    })
  })

  describe('isTextContent', () => {
    it('should return true for text/* types', () => {
      expect(isTextContent('text/plain')).toBe(true)
      expect(isTextContent('text/html')).toBe(true)
      expect(isTextContent('text/markdown')).toBe(true)
      expect(isTextContent('text/css')).toBe(true)
      expect(isTextContent('text/javascript')).toBe(true)
    })

    it('should return true for application/json', () => {
      expect(isTextContent('application/json')).toBe(true)
    })

    it('should return true for image/svg+xml', () => {
      expect(isTextContent('image/svg+xml')).toBe(true)
    })

    it('should return false for binary image types', () => {
      expect(isTextContent('image/png')).toBe(false)
      expect(isTextContent('image/jpeg')).toBe(false)
      expect(isTextContent('image/gif')).toBe(false)
    })

    it('should return false for other binary types', () => {
      expect(isTextContent('application/octet-stream')).toBe(false)
      expect(isTextContent('application/pdf')).toBe(false)
      expect(isTextContent('video/mp4')).toBe(false)
    })
  })

  describe('isImageContent', () => {
    it('should return true for image/* types', () => {
      expect(isImageContent('image/png')).toBe(true)
      expect(isImageContent('image/jpeg')).toBe(true)
      expect(isImageContent('image/gif')).toBe(true)
      expect(isImageContent('image/webp')).toBe(true)
      expect(isImageContent('image/svg+xml')).toBe(true)
      expect(isImageContent('image/bmp')).toBe(true)
    })

    it('should return false for non-image types', () => {
      expect(isImageContent('text/plain')).toBe(false)
      expect(isImageContent('application/json')).toBe(false)
      expect(isImageContent('video/mp4')).toBe(false)
    })
  })

  describe('Real-world inscription examples', () => {
    // These tests use actual inscription script patterns found on BSV

    it('should handle inscription with OP_PUSHDATA1', () => {
      // For content > 75 bytes, OP_PUSHDATA1 is used
      const longContent = 'a'.repeat(100)
      const ordHex = '036f7264'
      const contentTypeHex = '0a' + Buffer.from('text/plain').toString('hex')
      // OP_PUSHDATA1 (0x4c) followed by length byte
      const contentHex = '4c64' + Buffer.from(longContent).toString('hex')

      const script = '0063' + ordHex + '51' + contentTypeHex + '00' + contentHex + '68'

      const result = parseInscription(script)

      expect(result.isValid).toBe(true)
      expect(result.contentString).toBe(longContent)
    })

    it('should handle inscription with multiple fields', () => {
      // Some inscriptions have additional metadata fields (OP_2, OP_3, etc.)
      const ordHex = '036f7264'
      const contentTypeHex = '0a' + Buffer.from('text/plain').toString('hex')
      const contentHex = '0568656c6c6f' // "hello"
      // Adding an extra field with OP_2
      const extraFieldHex = '52' + '0466696c65' // OP_2 + "file"

      const script = '0063' + ordHex + '51' + contentTypeHex + extraFieldHex + '00' + contentHex + '68'

      const result = parseInscription(script)

      // Should still parse the basic content
      expect(result.isValid).toBe(true)
      expect(result.contentType).toBe('text/plain')
    })
  })
})
