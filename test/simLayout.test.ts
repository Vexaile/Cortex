import { describe, it, expect } from 'vitest'
import { spawnPoint, freeSpawnPoint, rotateOffset, clampToSpace, W, H, BOARD } from '../src/shared/simLayout'

/**
 * The spawn grid was written for an older, larger design space and never
 * updated. Rows marched down into the board (the 12th part covered D2's pad and
 * swallowed its wiring click, so that pin could never be wired again) and then
 * off the viewBox entirely, where a part is invisible AND unclickable and can
 * never be dragged back.
 */

/** A part is roughly this big around its origin, connector stubs included. */
const R = 34

describe('spawnPoint', () => {
  const many = Array.from({ length: 60 }, (_, n) => ({ n, ...spawnPoint(n) }))

  it.each(many)('part $n stays inside the design space', ({ x, y }) => {
    expect(x).toBeGreaterThanOrEqual(0)
    expect(x).toBeLessThanOrEqual(W)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThanOrEqual(H)
  })

  it.each(many)('part $n does not land on the board', ({ y }) => {
    // Clearing the top edge is what matters: everything below it is board.
    expect(y + R).toBeLessThanOrEqual(BOARD.y)
  })

  it('is deterministic', () => {
    expect(spawnPoint(7)).toEqual(spawnPoint(7))
  })

  it('does not stack parts exactly on top of each other once the strip fills', () => {
    // Identical coordinates would make the parts individually ungrabbable.
    const seen = new Set(many.map((p) => `${p.x},${p.y}`))
    expect(seen.size).toBeGreaterThan(10)
  })

  it('tolerates a negative or zero count', () => {
    expect(spawnPoint(0).y).toBeLessThan(BOARD.y)
    expect(spawnPoint(-1).y).toBeLessThan(BOARD.y)
  })
})

/**
 * Indexing spawn slots by array length breaks after a delete: the length points
 * back at a slot a later part still occupies, so the new part lands exactly on
 * top of it and the two can only be separated by dragging blind.
 */
describe('freeSpawnPoint', () => {
  it('is the first slot when nothing is placed', () => {
    expect(freeSpawnPoint([])).toEqual(spawnPoint(0))
  })

  it('skips slots that are taken', () => {
    const placed = [spawnPoint(0), spawnPoint(1)]
    expect(freeSpawnPoint(placed)).toEqual(spawnPoint(2))
  })

  // The defect: three parts added, the first deleted. Length is 2, but slot 2
  // still holds the third part.
  it('does not reuse a slot after an earlier part is deleted', () => {
    const all = [spawnPoint(0), spawnPoint(1), spawnPoint(2)]
    const afterDeletingFirst = [all[1], all[2]]
    const next = freeSpawnPoint(afterDeletingFirst)
    expect(next).toEqual(all[0]) // the freed slot, not the occupied one
    for (const p of afterDeletingFirst) expect(next).not.toEqual(p)
  })

  it('never returns a slot occupied by an existing part', () => {
    const placed: { x: number; y: number }[] = []
    for (let i = 0; i < 25; i++) {
      const p = freeSpawnPoint(placed)
      expect(placed).not.toContainEqual(p)
      placed.push(p)
    }
  })

  it('ignores parts the user has dragged elsewhere', () => {
    expect(freeSpawnPoint([{ x: 401, y: 137 }])).toEqual(spawnPoint(0))
  })
})

/**
 * Every producer of a part position must clamp. spawnPoint did and movePart did
 * not, so a drag that left the SVG (pointer capture keeps pointermove firing
 * out there) stranded the part where it is invisible AND unclickable, and
 * saveDiagram wrote those coordinates to .cortex/diagram.json.
 */
describe('clampToSpace', () => {
  const outside = [
    { x: -500, y: -500 },
    { x: W + 900, y: H + 900 },
    { x: -1, y: H / 2 },
    { x: W / 2, y: -1 },
    { x: 0, y: 0 },
    { x: W, y: H }
  ]

  it.each(outside)('pulls ($x, $y) back inside the design space', (p) => {
    const c = clampToSpace(p)
    expect(c.x).toBeGreaterThanOrEqual(0)
    expect(c.x).toBeLessThanOrEqual(W)
    expect(c.y).toBeGreaterThanOrEqual(0)
    expect(c.y).toBeLessThanOrEqual(H)
  })

  it('leaves a point that is already inside alone', () => {
    expect(clampToSpace({ x: 300, y: 200 })).toEqual({ x: 300, y: 200 })
  })

  it('keeps a clamped part far enough in to stay grabbable', () => {
    // Clamping to the exact edge would leave half the glyph off-canvas.
    const c = clampToSpace({ x: -9999, y: -9999 })
    expect(c.x).toBeGreaterThan(0)
    expect(c.y).toBeGreaterThan(0)
  })

  it('is idempotent', () => {
    const once = clampToSpace({ x: -400, y: 9999 })
    expect(clampToSpace(once)).toEqual(once)
  })
})

/**
 * A part's legs have three consumers that must agree: the body glyph, the
 * connector dots, and the wire endpoints. Only the body was inside the SVG
 * rotate group, so rotating a 7-segment swung its legs while all eight dots and
 * wires stayed put.
 */
describe('rotateOffset', () => {
  const near = (a: { x: number; y: number }, x: number, y: number): void => {
    expect(a.x).toBeCloseTo(x, 6)
    expect(a.y).toBeCloseTo(y, 6)
  }

  // A leg below the part (SVG y grows downward, rotation is clockwise).
  const leg = { x: 0, y: 34 }

  it('is identity at 0', () => expect(rotateOffset(leg, 0)).toEqual(leg))

  it('sends a leg below the part to its left at 90 degrees', () => near(rotateOffset(leg, 90), -34, 0))
  it('sends a leg below the part above it at 180 degrees', () => near(rotateOffset(leg, 180), 0, -34))
  it('sends a leg below the part to its right at 270 degrees', () => near(rotateOffset(leg, 270), 34, 0))

  it('preserves distance from the part origin', () => {
    const off = { x: -21, y: 40 } // a 7-segment's leftmost leg
    const r = Math.hypot(off.x, off.y)
    for (const deg of [0, 37, 90, 180, 270, 359]) {
      const p = rotateOffset(off, deg)
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(r, 6)
    }
  })

  it('matches four 90-degree steps to a full turn', () => {
    let p = leg
    for (let i = 0; i < 4; i++) p = rotateOffset(p, 90)
    near(p, leg.x, leg.y)
  })
})
