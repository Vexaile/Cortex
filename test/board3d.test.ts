import { describe, it, expect } from 'vitest'
import {
  BOARDS,
  DESIGN_CENTER,
  toWorld,
  pinTopY,
  PART_TOP_Y,
  type BoardDef
} from '../src/renderer/src/components/sim3d/board3d'

/**
 * The 3D board registry is pure data + math (no three, no DOM), so it can be
 * tested directly. This guards the pinouts (ESP32/Pi came from datasheets and
 * are easy to fat-finger) and the drag coordinate math, which is the custom
 * part of 3D part dragging.
 */

const boards: [string, BoardDef][] = Object.entries(BOARDS)

describe('board registry', () => {
  it('has the three boards, each self-identifying', () => {
    expect(Object.keys(BOARDS).sort()).toEqual(['esp32', 'pi', 'uno'])
    for (const [id, def] of boards) expect(def.id).toBe(id)
  })

  it.each(boards)('%s: every pin sits within the board footprint', (_id, def) => {
    const hx = def.size.w / 2 + 20
    const hz = def.size.d / 2 + 20
    for (const p of def.pins) {
      expect(Math.abs(p.x), `${p.label} x`).toBeLessThanOrEqual(hx)
      expect(Math.abs(p.z), `${p.label} z`).toBeLessThanOrEqual(hz)
    }
  })

  it.each(boards)('%s: a wire lands above the board surface', (_id, def) => {
    expect(pinTopY(def)).toBeGreaterThan(def.size.h)
    expect(pinTopY(def)).toBeGreaterThan(PART_TOP_Y - 10)
  })

  it.each(boards)('%s: wire-driven pin numbers are unique', (_id, def) => {
    const driven = def.pins.filter((p) => p.pin >= 0).map((p) => p.pin)
    expect(new Set(driven).size, 'duplicate pin number would wire two sockets at once').toBe(driven.length)
  })
})

describe('pinouts match the datasheets', () => {
  it('Uno has D0-D13 and A0-A5, and the L LED is on 13', () => {
    const uno = BOARDS.uno
    for (let d = 0; d <= 13; d++) expect(uno.pins.find((p) => p.pin === d)?.label).toBe(`D${d}`)
    for (let a = 0; a < 6; a++) expect(uno.pins.find((p) => p.label === `A${a}`)?.pin).toBe(14 + a)
    expect(uno.ledPin).toBe(13)
    expect(uno.pins.some((p) => p.pin === 13)).toBe(true)
  })

  it('ESP32 maps IOn to GPIO n, and RX0/TX0 to 3/1', () => {
    const esp = BOARDS.esp32
    expect(esp.pins.find((p) => p.label === 'IO13')?.pin).toBe(13)
    expect(esp.pins.find((p) => p.label === 'IO2')?.pin).toBe(2)
    expect(esp.pins.find((p) => p.label === 'RX0')?.pin).toBe(3)
    expect(esp.pins.find((p) => p.label === 'TX0')?.pin).toBe(1)
    // Power/ground are not wire-driven.
    expect(esp.pins.find((p) => p.label === '3V3')?.pin).toBeLessThan(0)
    expect(esp.pins.filter((p) => p.label === 'GND').every((p) => p.pin < 0)).toBe(true)
    expect(esp.pins).toHaveLength(38)
  })

  it('Pi has 40 pins, GPIOn -> n, and 8 grounds', () => {
    const pi = BOARDS.pi
    expect(pi.pins).toHaveLength(40)
    expect(pi.pins.find((p) => p.label === 'GPIO18')?.pin).toBe(18)
    expect(pi.pins.find((p) => p.label === 'GPIO2')?.pin).toBe(2)
    expect(pi.pins.filter((p) => p.label === 'GND')).toHaveLength(8)
    expect(pi.pins.filter((p) => p.label === '5V')).toHaveLength(2)
  })
})

describe('drag coordinate math', () => {
  // 3D part dragging feeds movePart(worldX + DESIGN_CENTER.x, worldZ + .y); the
  // Uno reads parts back with toWorld. The two must be exact inverses or a
  // dragged part drifts.
  it.each([
    [0, 0],
    [140, -237.5],
    [-155, 60],
    [199, -199]
  ])('toWorld inverts the drag mapping at (%s, %s)', (wx, wz) => {
    const [rx, rz] = toWorld(wx + DESIGN_CENTER.x, wz + DESIGN_CENTER.y)
    expect(rx).toBeCloseTo(wx, 6)
    expect(rz).toBeCloseTo(wz, 6)
  })
})
