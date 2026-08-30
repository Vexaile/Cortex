import { describe, it, expect } from 'vitest'
import { parseDiagnostics, summarize } from '../src/shared/diagnostics'

describe('parseDiagnostics', () => {
  it('parses a gcc error with line and column', () => {
    const out = parseDiagnostics(`main.cpp:3:18: error: 'x' was not declared in this scope`)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ file: 'main.cpp', line: 3, column: 18, severity: 'error' })
  })

  it('keeps the drive letter on absolute Windows paths', () => {
    const out = parseDiagnostics(`C:\\Users\\x\\main.cpp:10:52: error: bad thing`)
    expect(out[0].file).toBe('C:\\Users\\x\\main.cpp')
    expect(out[0].line).toBe(10)
    expect(out[0].column).toBe(52)
  })

  it('extracts a [-Wflag] code and strips it from the message', () => {
    const out = parseDiagnostics(`f.cpp:4:13: warning: unused variable 'y' [-Wunused-variable]`)
    expect(out[0].severity).toBe('warning')
    expect(out[0].code).toBe('-Wunused-variable')
    expect(out[0].message).toBe("unused variable 'y'")
  })

  it('handles a missing column and maps fatal error to error', () => {
    const out = parseDiagnostics(`f.cpp:2: fatal error: foo.h: No such file or directory`)
    expect(out[0]).toMatchObject({ line: 2, column: 1, severity: 'error' })
  })

  it('skips "In function" and caret/snippet lines', () => {
    const stderr = [
      `a.cpp: In function 'int main()':`,
      `a.cpp:3:5: error: oops`,
      `    3 |   code`,
      `      |   ^`
    ].join('\n')
    expect(parseDiagnostics(stderr)).toHaveLength(1)
  })

  it('summarize counts errors and warnings', () => {
    const d = parseDiagnostics(`a.cpp:1:1: error: e\nb.cpp:2:1: warning: w [-Wx]`)
    expect(summarize(d)).toEqual({ errors: 1, warnings: 1 })
  })

  it('returns empty for empty input', () => {
    expect(parseDiagnostics('')).toEqual([])
  })
})
