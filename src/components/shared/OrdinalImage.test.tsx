import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OrdinalImage } from './OrdinalImage'

describe('OrdinalImage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:ordinal-test'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('recovers from an image load error when cached content arrives later', () => {
    const onContentNeeded = vi.fn()
    const { rerender } = render(
      <OrdinalImage
        origin="origin-1"
        contentType="image/png"
        onContentNeeded={onContentNeeded}
        lazy={false}
      />
    )

    fireEvent.error(screen.getByRole('img', { name: 'Ordinal' }))
    expect(onContentNeeded).toHaveBeenCalledWith('origin-1', 'image/png')

    rerender(
      <OrdinalImage
        origin="origin-1"
        contentType="image/png"
        cachedContent={{ contentData: new Uint8Array([1, 2, 3]), contentType: 'image/png' }}
        onContentNeeded={onContentNeeded}
        lazy={false}
      />
    )

    const img = screen.getByRole('img', { name: 'Ordinal' }) as HTMLImageElement
    expect(img.src).toContain('blob:ordinal-test')
  })
})
