import { describe, it, expect } from 'vitest'
import { simConsistency, type SimWiredPart } from '../src/shared/simConsistency'
import type { PinUsage } from '../src/shared/ipc'

function pin(over: Partial<PinUsage>): PinUsage {
  return { file: 'main.ino', line: 1, pin: '5', role: 'digitalWrite', ...over }
}

function part(type: string, pins: Record<string, number | null>): SimWiredPart {
  return { type, pins }
}

describe('simConsistency: not-simulated', () => {
  it('flags a numeric firmware pin with nothing wired to it', () => {
    const r = simConsistency([pin({ pin: '5', role: 'digitalWrite', line: 7 })], [])
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({ kind: 'not-simulated', pin: 5, severity: 'warning', file: 'main.ino', line: 7 })
  })

  it('does not flag a pin that a part is wired to', () => {
    const r = simConsistency([pin({ pin: '5' })], [part('led', { sig: 5 })])
    expect(r.findings.filter((f) => f.kind === 'not-simulated')).toEqual([])
  })

  it('collapses several sites on the same pin into one finding', () => {
    const r = simConsistency(
      [pin({ pin: '5', role: 'pinMode', mode: 'OUTPUT', line: 3 }), pin({ pin: '5', role: 'digitalWrite', line: 9 })],
      []
    )
    const notSim = r.findings.filter((f) => f.kind === 'not-simulated')
    expect(notSim).toHaveLength(1)
    expect(notSim[0].line).toBe(3) // first site
    expect(notSim[0].detail).toContain('pinMode, digitalWrite') // aggregated roles
  })

  it('sorts not-simulated findings by pin number', () => {
    const r = simConsistency([pin({ pin: '9' }), pin({ pin: '2' }), pin({ pin: '13' })], [])
    expect(r.findings.filter((f) => f.kind === 'not-simulated').map((f) => f.pin)).toEqual([2, 9, 13])
  })
})

describe('simConsistency: named pins are unresolved, never guessed', () => {
  it('reports A0 / LED_BUILTIN as unresolved and makes no claim about them', () => {
    const r = simConsistency([pin({ pin: 'A0', role: 'analogRead' }), pin({ pin: 'LED_BUILTIN' })], [])
    expect(r.findings).toEqual([])
    expect(r.unresolvedPins).toEqual(['A0', 'LED_BUILTIN'])
    expect(r.inertCheckRan).toBe(false)
  })

  it('parses GPIO/IO-prefixed numeric tokens', () => {
    const r = simConsistency([pin({ pin: 'GPIO4' }), pin({ pin: 'IO18' })], [])
    expect(r.findings.map((f) => f.pin).sort((a, b) => a - b)).toEqual([4, 18])
    expect(r.unresolvedPins).toEqual([])
  })
})

describe('simConsistency: inert-part', () => {
  it('flags a part on a pin the firmware never uses (when every token resolved)', () => {
    const r = simConsistency([pin({ pin: '5' })], [part('led', { sig: 5 }), part('buzzer', { sig: 8 })])
    expect(r.inertCheckRan).toBe(true)
    const inert = r.findings.filter((f) => f.kind === 'inert-part')
    expect(inert).toHaveLength(1)
    expect(inert[0]).toMatchObject({ pin: 8, kind: 'inert-part', severity: 'info' })
    expect(inert[0].title).toContain('buzzer')
  })

  it('is skipped when an unresolved named token could be that pin', () => {
    // LED_BUILTIN is unresolved; the buzzer on GPIO8 might be exactly it, so we
    // must not claim the part is inert.
    const r = simConsistency([pin({ pin: 'LED_BUILTIN' })], [part('buzzer', { sig: 8 })])
    expect(r.inertCheckRan).toBe(false)
    expect(r.findings.filter((f) => f.kind === 'inert-part')).toEqual([])
  })

  it('ignores unconnected part pins (null)', () => {
    const r = simConsistency([pin({ pin: '5' })], [part('led', { sig: 5 }), part('rgb', { r: null, g: null, b: null })])
    expect(r.findings).toEqual([])
    expect(r.inertCheckRan).toBe(true)
  })

  it('reports one inert finding per unused pad even across parts', () => {
    const r = simConsistency(
      [pin({ pin: '5' })],
      [part('led', { sig: 5 }), part('button', { sig: 7 }), part('resistor', { sig: 7 })]
    )
    const inert = r.findings.filter((f) => f.kind === 'inert-part')
    expect(inert).toHaveLength(1)
    expect(inert[0].pin).toBe(7)
  })
})
