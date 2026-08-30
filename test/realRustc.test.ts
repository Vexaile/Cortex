import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseRustJsonDiagnostics, renderRustJsonLine } from '../src/shared/diagnostics'

/** Fixture captured from a real `rustc --error-format=json` run (1.97.1). */
const raw = readFileSync(join(__dirname, 'tmp', 'diag.json'), 'utf8')

describe('real rustc --error-format=json output', () => {
  it('extracts exactly the one located diagnostic, with its true span', () => {
    const d = parseRustJsonDiagnostics(raw)
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ file: 'bad.rs', line: 3, column: 20, severity: 'error', code: 'E0425' })
  })

  it('skips the span-less summary and the failure-note record', () => {
    expect(parseRustJsonDiagnostics(raw).some((d) => /aborting/.test(d.message))).toBe(false)
  })

  it('renders rustc human text into Output, never raw JSON', () => {
    const out = raw.split(/\r?\n/).map(renderRustJsonLine).join('')
    expect(out).toContain('cannot find value `x` in this scope')
    expect(out).not.toContain('"$message_type"')
    expect(out).not.toContain('"level"')
  })
})
