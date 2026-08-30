import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseRustJsonDiagnostics, renderRustJsonLine, parseDiagnostics } from '../src/shared/diagnostics'
import { findCargoRoot } from '../src/main/services/runnerService'

/**
 * rustc's `--error-format=json` gives exact spans, which the textual two-line
 * form cannot. These fixtures are real rustc JSON records (trimmed to the
 * fields we read).
 */
const ERR = JSON.stringify({
  message: 'cannot find value `x` in this scope',
  code: { code: 'E0425' },
  level: 'error',
  spans: [{ file_name: 'src/main.rs', line_start: 4, column_start: 13, is_primary: true }],
  rendered: 'error[E0425]: cannot find value `x` in this scope\n --> src/main.rs:4:13\n'
})
const WARN = JSON.stringify({
  message: 'unused variable: `y`',
  code: { code: 'unused_variables' },
  level: 'warning',
  spans: [{ file_name: 'src/main.rs', line_start: 2, column_start: 9, is_primary: true }],
  rendered: 'warning: unused variable: `y`\n'
})
// rustc also emits non-diagnostic records and a final summary with no span.
const ARTIFACT = JSON.stringify({ artifact: 'target/debug/app.d', emit: 'dep-info' })
const SUMMARY = JSON.stringify({
  message: 'aborting due to 1 previous error',
  level: 'error',
  spans: [],
  rendered: 'error: aborting due to 1 previous error\n'
})

describe('parseRustJsonDiagnostics', () => {
  it('reads exact spans from rustc JSON', () => {
    const d = parseRustJsonDiagnostics([WARN, ERR].join('\n'))
    expect(d).toHaveLength(2)
    expect(d[0]).toMatchObject({
      file: 'src/main.rs',
      line: 2,
      column: 9,
      severity: 'warning',
      code: 'unused_variables'
    })
    expect(d[1]).toMatchObject({ line: 4, column: 13, severity: 'error', code: 'E0425' })
  })

  it('skips artifact records and span-less summaries', () => {
    const d = parseRustJsonDiagnostics([ARTIFACT, ERR, SUMMARY].join('\n'))
    expect(d).toHaveLength(1)
    expect(d[0].message).toContain('cannot find value')
  })

  it('ignores malformed lines rather than throwing', () => {
    expect(() => parseRustJsonDiagnostics('{not json\n' + ERR)).not.toThrow()
    expect(parseRustJsonDiagnostics('{not json\n' + ERR)).toHaveLength(1)
  })

  it('prefers the primary span when several are present', () => {
    const multi = JSON.stringify({
      message: 'mismatched types',
      level: 'error',
      spans: [
        { file_name: 'src/lib.rs', line_start: 10, column_start: 1, is_primary: false },
        { file_name: 'src/main.rs', line_start: 20, column_start: 5, is_primary: true }
      ]
    })
    expect(parseRustJsonDiagnostics(multi)[0]).toMatchObject({ file: 'src/main.rs', line: 20, column: 5 })
  })

  it('returns nothing for gcc output, so the textual parser still owns that', () => {
    expect(parseRustJsonDiagnostics("main.cpp:10:52: error: 'x' is not a member of 'std'")).toEqual([])
  })
})

describe('renderRustJsonLine', () => {
  it('shows rustc rendered text instead of raw JSON', () => {
    expect(renderRustJsonLine(ERR)).toContain('error[E0425]: cannot find value')
    expect(renderRustJsonLine(ERR)).not.toContain('"level"')
  })

  it('drops artifact records, which are not for the user', () => {
    expect(renderRustJsonLine(ARTIFACT)).toBe('')
  })

  it('passes non-JSON lines through unchanged so nothing is swallowed', () => {
    expect(renderRustJsonLine('warning: some plain text')).toBe('warning: some plain text\n')
  })

  it('does not crash on a truncated JSON line', () => {
    expect(() => renderRustJsonLine('{"message":"trunc')).not.toThrow()
  })
})

describe('findCargoRoot', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cortex-cargo-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('finds Cargo.toml from a nested source file', async () => {
    mkdirSync(join(dir, 'src', 'bin'), { recursive: true })
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="x"\n')
    expect(await findCargoRoot(join(dir, 'src', 'bin'))).toBe(join(dir))
  })

  it('returns null for a loose .rs file with no manifest', async () => {
    mkdirSync(join(dir, 'scratch'), { recursive: true })
    expect(await findCargoRoot(join(dir, 'scratch'), dir)).toBeNull()
  })

  it('stops at the workspace root rather than escaping it', async () => {
    // A Cargo.toml ABOVE the workspace must not be adopted.
    const ws = join(dir, 'ws')
    mkdirSync(join(ws, 'src'), { recursive: true })
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="outer"\n')
    expect(await findCargoRoot(join(ws, 'src'), ws)).toBeNull()
  })
})

describe('rust diagnostics fall back to the textual parser', () => {
  it('still parses the two-line human form when JSON is absent', () => {
    const text = 'error[E0425]: cannot find value `x` in this scope\n --> src/main.rs:2:5\n'
    const d = parseDiagnostics(text)
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ file: 'src/main.rs', line: 2, column: 5, code: 'E0425' })
  })
})
