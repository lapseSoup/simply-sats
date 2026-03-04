// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useLatestRef } from './useLatestRef'

describe('useLatestRef', () => {
  it('returns a ref holding the initial value', () => {
    const { result } = renderHook(() => useLatestRef(42))
    expect(result.current.current).toBe(42)
  })

  it('updates ref.current when value changes', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useLatestRef(value),
      { initialProps: { value: 'first' } }
    )

    expect(result.current.current).toBe('first')

    rerender({ value: 'second' })
    expect(result.current.current).toBe('second')

    rerender({ value: 'third' })
    expect(result.current.current).toBe('third')
  })

  it('ref identity is stable across renders', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useLatestRef(value),
      { initialProps: { value: 1 } }
    )

    const refAfterFirstRender = result.current

    rerender({ value: 2 })
    const refAfterSecondRender = result.current

    rerender({ value: 3 })
    const refAfterThirdRender = result.current

    // The ref object itself should be the same reference across all renders
    expect(refAfterFirstRender).toBe(refAfterSecondRender)
    expect(refAfterSecondRender).toBe(refAfterThirdRender)
  })

  it('works with function values (common use case for callbacks)', () => {
    const fn1 = () => 'fn1'
    const fn2 = () => 'fn2'

    const { result, rerender } = renderHook(
      ({ fn }) => useLatestRef(fn),
      { initialProps: { fn: fn1 } }
    )

    expect(result.current.current).toBe(fn1)
    expect(result.current.current()).toBe('fn1')

    rerender({ fn: fn2 })
    expect(result.current.current).toBe(fn2)
    expect(result.current.current()).toBe('fn2')
  })

  it('works with null and undefined values', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useLatestRef(value),
      { initialProps: { value: null as string | null } }
    )

    expect(result.current.current).toBeNull()

    rerender({ value: 'non-null' })
    expect(result.current.current).toBe('non-null')

    rerender({ value: null })
    expect(result.current.current).toBeNull()
  })

  it('works with complex object values', () => {
    const obj1 = { a: 1, b: 'hello' }
    const obj2 = { a: 2, b: 'world' }

    const { result, rerender } = renderHook(
      ({ value }) => useLatestRef(value),
      { initialProps: { value: obj1 } }
    )

    expect(result.current.current).toBe(obj1)

    rerender({ value: obj2 })
    expect(result.current.current).toBe(obj2)
  })
})
