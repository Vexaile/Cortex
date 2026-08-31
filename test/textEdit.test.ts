import { describe, it, expect } from 'vitest'
import { applyTextEdits, type TextEdit } from '../src/shared/textEdit'

const edit = (sl: number, sc: number, el: number, ec: number, newText: string): TextEdit => ({
  range: { start: { line: sl, character: sc }, end: { line: el, character: ec } },
  newText
})

describe('applyTextEdits', () => {
  it('returns the text unchanged for no edits', () => {
    expect(applyTextEdits('abc', [])).toBe('abc')
  })

  it('applies a single in-line replacement', () => {
    // rename `foo` -> `bar` on line 0, cols 4..7
    expect(applyTextEdits('int foo = 1;', [edit(0, 4, 0, 7, 'bar')])).toBe('int bar = 1;')
  })

  it('applies multiple edits on the same line at the correct offsets (order-independent)', () => {
    // "a x b x c" -> rename both `x` to `yy`; edits given in document order
    const text = 'a x b x c'
    const edits = [edit(0, 2, 0, 3, 'yy'), edit(0, 6, 0, 7, 'yy')]
    expect(applyTextEdits(text, edits)).toBe('a yy b yy c')
    // Same result if the edits arrive out of order (server ordering is not guaranteed)
    expect(applyTextEdits(text, [edits[1], edits[0]])).toBe('a yy b yy c')
  })

  it('applies edits across multiple lines', () => {
    const text = 'let foo = 1\nreturn foo + foo\n'
    // rename foo -> total: line0 4..7, line1 7..10, line1 13..16
    const edits = [edit(0, 4, 0, 7, 'total'), edit(1, 7, 1, 10, 'total'), edit(1, 13, 1, 16, 'total')]
    expect(applyTextEdits(text, edits)).toBe('let total = 1\nreturn total + total\n')
  })

  it('handles CRLF line endings (a trailing \\r stays in the line, columns still line up)', () => {
    const text = 'int foo = 1;\r\nfoo++;\r\n'
    const edits = [edit(0, 4, 0, 7, 'bar'), edit(1, 0, 1, 3, 'bar')]
    expect(applyTextEdits(text, edits)).toBe('int bar = 1;\r\nbar++;\r\n')
  })

  it('supports pure insertions (zero-length range)', () => {
    expect(applyTextEdits('ab', [edit(0, 1, 0, 1, 'X')])).toBe('aXb')
  })

  it('supports deletions (empty newText)', () => {
    expect(applyTextEdits('abcd', [edit(0, 1, 0, 3, '')])).toBe('ad')
  })
})
