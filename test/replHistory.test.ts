import { describe, it, expect } from 'vitest'
import { stepHistory } from '../src/shared/replHistory'

describe('stepHistory', () => {
  const H = ['a', 'b', 'c'] // oldest -> newest

  it('does nothing on ArrowUp with empty history', () => {
    expect(stepHistory([], -1, 'up')).toEqual({ index: -1, input: null })
  })

  it('recalls the most recent entry from a fresh line', () => {
    expect(stepHistory(H, -1, 'up')).toEqual({ index: 2, input: 'c' })
  })

  it('steps toward older entries on repeated ArrowUp', () => {
    expect(stepHistory(H, 2, 'up')).toEqual({ index: 1, input: 'b' })
    expect(stepHistory(H, 1, 'up')).toEqual({ index: 0, input: 'a' })
  })

  it('clamps at the oldest entry', () => {
    expect(stepHistory(H, 0, 'up')).toEqual({ index: 0, input: 'a' })
  })

  it('steps back toward newer entries on ArrowDown', () => {
    expect(stepHistory(H, 0, 'down')).toEqual({ index: 1, input: 'b' })
    expect(stepHistory(H, 1, 'down')).toEqual({ index: 2, input: 'c' })
  })

  it('returns to an empty fresh line past the newest entry', () => {
    expect(stepHistory(H, 2, 'down')).toEqual({ index: -1, input: '' })
  })

  it('does nothing on ArrowDown when already on the fresh line', () => {
    expect(stepHistory(H, -1, 'down')).toEqual({ index: -1, input: null })
  })
})
