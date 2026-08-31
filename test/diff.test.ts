import { describe, it, expect } from 'vitest'
import {
  diffLines,
  diffHunks,
  diffStat,
  isDiffTooLarge,
  MAX_DIFF_LINES,
  detectEol,
  normalizeEol,
  withEol
} from '../src/shared/diff'

describe('diffLines', () => {
  it('is all context when unchanged', () => {
    const d = diffLines('a\nb\nc\n', 'a\nb\nc\n')
    expect(d.every((l) => l.type === 'context')).toBe(true)
    expect(d).toHaveLength(3)
  })

  it('reports a pure insertion', () => {
    const d = diffLines('', 'x\ny\n')
    expect(d.map((l) => l.type)).toEqual(['add', 'add'])
    expect(d[0].newLine).toBe(1)
  })

  it('reports a pure deletion', () => {
    const d = diffLines('x\ny\n', '')
    expect(d.map((l) => l.type)).toEqual(['del', 'del'])
  })

  it('isolates a single changed line, keeping the rest as context', () => {
    const d = diffLines('a\nb\nc\n', 'a\nB\nc\n')
    expect(d.filter((l) => l.type === 'del').map((l) => l.text)).toEqual(['b'])
    expect(d.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['B'])
    expect(d.filter((l) => l.type === 'context').map((l) => l.text)).toEqual(['a', 'c'])
  })
})

describe('diffStat', () => {
  it('counts adds and removes', () => {
    const s = diffStat('a\nb\nc\n', 'a\nX\nY\nc\n')
    expect(s.removed).toBe(1)
    expect(s.added).toBe(2)
  })
})

describe('diffHunks', () => {
  it('collapses large unchanged regions to focused hunks', () => {
    const old = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const next = old.replace('line 50', 'line 50 changed')
    const hunks = diffHunks(old, next, 3)
    // One change in the middle -> a single small hunk, not the whole file.
    expect(hunks).toHaveLength(1)
    expect(hunks[0].lines.length).toBeLessThan(12)
    const changed = hunks[0].lines.filter((l) => l.type !== 'context')
    expect(changed.some((l) => l.type === 'add' && l.text.includes('changed'))).toBe(true)
  })

  it('treats a brand new file as all additions', () => {
    const hunks = diffHunks('', 'a\nb\n')
    expect(hunks).toHaveLength(1)
    expect(hunks[0].lines.every((l) => l.type === 'add')).toBe(true)
  })
})

describe('line-ending tolerance', () => {
  it('does not report a CRLF file as fully changed against LF output', () => {
    // A one-line change in a CRLF file vs the model's LF rewrite: only that line
    // should diff, not every line (which is what an EOL-naive split would do).
    const d = diffLines('a\r\nb\r\nc\r\n', 'a\nB\nc\n')
    expect(d.filter((l) => l.type === 'del').map((l) => l.text)).toEqual(['b'])
    expect(d.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['B'])
    expect(d.filter((l) => l.type === 'context').map((l) => l.text)).toEqual(['a', 'c'])
  })

  it('detectEol picks CRLF when present, else LF', () => {
    expect(detectEol('a\r\nb')).toBe('\r\n')
    expect(detectEol('a\nb')).toBe('\n')
    expect(detectEol('nolines')).toBe('\n')
  })

  it('normalizeEol collapses CRLF to LF for equality checks', () => {
    expect(normalizeEol('a\r\nb\r\n')).toBe('a\nb\n')
    expect(normalizeEol('a\nb\n')).toBe('a\nb\n')
  })

  it('withEol rewrites LF content to the target ending, preserving a file EOL', () => {
    expect(withEol('a\nb\n', '\r\n')).toBe('a\r\nb\r\n')
    expect(withEol('a\r\nb', '\n')).toBe('a\nb')
    expect(withEol('a\nb', '\n')).toBe('a\nb')
  })
})

describe('isDiffTooLarge', () => {
  it('is false for small inputs and true past the cap', () => {
    expect(isDiffTooLarge('a\nb', 'a\nc')).toBe(false)
    const huge = Array.from({ length: MAX_DIFF_LINES + 10 }, () => 'x').join('\n')
    expect(isDiffTooLarge(huge, 'x')).toBe(true)
  })
})
