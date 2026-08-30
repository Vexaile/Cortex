import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isCargoJsonLine,
  cargoRenderedMessage,
  parseCargoDiagnostics
} from '../src/shared/diagnostics'

/**
 * Fixtures captured from real `cargo build --message-format=json` runs
 * (cargo 1.97.1) against examples/rustproj: one clean build, one with an
 * undefined identifier inside a module.
 */
const ok = readFileSync(join(__dirname, 'tmp', 'cargo-ok.json'), 'utf8')
const err = readFileSync(join(__dirname, 'tmp', 'cargo-err.json'), 'utf8')

describe('isCargoJsonLine', () => {
  it('recognises cargo machine records', () => {
    const records = err.split(/\r?\n/).filter((l) => l.trim().startsWith('{'))
    expect(records.length).toBeGreaterThan(0)
    for (const r of records) expect(isCargoJsonLine(r), r.slice(0, 60)).toBe(true)
  })

  it('leaves the program’s own output alone', () => {
    // These must reach the Output panel untouched.
    for (const line of ['smoothed = 825', '', 'Hello {world}', '{ not json']) {
      expect(isCargoJsonLine(line), line).toBe(false)
    }
  })

  it('does not claim a JSON object that has no cargo reason', () => {
    expect(isCargoJsonLine('{"level":"error","message":"x"}')).toBe(false)
  })
})

describe('cargoRenderedMessage', () => {
  it('returns the human text of a compiler-message record', () => {
    const rendered = err
      .split(/\r?\n/)
      .map(cargoRenderedMessage)
      .filter((x): x is string => x !== null)
      .join('')
    expect(rendered).toContain('cannot find value')
    // The user must never see the machine record itself.
    expect(rendered).not.toContain('"reason"')
    expect(rendered).not.toContain('compiler-artifact')
  })

  it('returns null for artifact and build-finished records', () => {
    const artifacts = ok.split(/\r?\n/).filter((l) => l.includes('compiler-artifact') || l.includes('build-finished'))
    expect(artifacts.length).toBeGreaterThan(0)
    for (const a of artifacts) expect(cargoRenderedMessage(a)).toBeNull()
  })
})

describe('parseCargoDiagnostics', () => {
  it('extracts the real span from a module file, not the open file', () => {
    const d = parseCargoDiagnostics(err)
    expect(d.length).toBeGreaterThan(0)
    const e = d.find((x) => x.code === 'E0425')
    expect(e).toBeDefined()
    expect(e!.file).toContain('filter.rs')
    expect(e!.severity).toBe('error')
    expect(e!.line).toBeGreaterThan(0)
    expect(e!.column).toBeGreaterThan(0)
  })

  it('finds nothing in a clean build', () => {
    expect(parseCargoDiagnostics(ok)).toEqual([])
  })
})

describe('isCargoJsonLine only claims cargo’s own records', () => {
  it('does not swallow program output that is JSON with a "reason" field', () => {
    // A program printing its own JSON telemetry must reach the Output panel.
    expect(isCargoJsonLine('{"reason":"sensor overheated","mv":3300}')).toBe(false)
    expect(isCargoJsonLine('{"reason":"ok"}')).toBe(false)
  })

  it('still claims every real cargo reason', () => {
    for (const r of ['compiler-artifact', 'compiler-message', 'build-script-executed', 'build-finished']) {
      expect(isCargoJsonLine(`{"reason":"${r}"}`), r).toBe(true)
    }
  })
})
