/**
 * The simulator's design space. Pure and dependency free.
 *
 * This exists because the numbers had two copies: SimCanvas owned the viewBox
 * and the board rect, and the store separately hardcoded a spawn grid and the
 * v1 migration scale. They drifted, and the drift was invisible until the 12th
 * part spawned on top of the board and swallowed a pin's click target.
 *
 * SimCanvas imports the store, so these cannot live in the canvas without a
 * cycle. Both sides import here instead.
 */

/** Design space. The SVG viewBox scales this to whatever the pane is. */
export const W = 660
export const H = 520

/** The Uno, centred. Parts must not spawn on top of it. */
export const BOARD = { x: 130, y: 250, w: 400, h: 195 }

/** v1 diagrams were authored in this space and are rescaled on load. */
export const V1_SPACE = { w: 920, h: 640 }

/** Roughly a part's own radius, including its connector stubs. */
const MARGIN = 36

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/**
 * Keeps a part inside the design space.
 *
 * Every producer of a part position must use this. spawnPoint clamped and
 * movePart did not, so a drag that left the SVG (pointer capture keeps
 * pointermove firing out there) stranded the part where it is invisible AND
 * unclickable, and saveDiagram then wrote those coordinates to disk. The only
 * way back was editing .cortex/diagram.json by hand.
 */
export function clampToSpace(p: { x: number; y: number }): { x: number; y: number } {
  return { x: clamp(p.x, MARGIN, W - MARGIN), y: clamp(p.y, MARGIN, H - MARGIN) }
}

// The clear strip above the board is the only place a new part can land without
// covering the header pads, so the row count is derived from the board rather
// than assumed.
const ORIGIN = { x: 90, y: 70 }
const CELL = { w: 115, h: 90 }
const COLS = 5
const ROWS = Math.max(1, Math.floor((BOARD.y - ORIGIN.y - MARGIN) / CELL.h) + 1)

/**
 * The first spawn slot no existing part occupies.
 *
 * Indexing by array length is wrong after a delete: remove the first of three
 * parts and the length points back at slot 2, which the third part is still
 * sitting on, so the new part lands exactly on top of it and the two can only
 * be separated by dragging blind.
 */
export function freeSpawnPoint(occupied: { x: number; y: number }[]): { x: number; y: number } {
  const isTaken = (p: { x: number; y: number }): boolean =>
    occupied.some((q) => Math.abs(q.x - p.x) < 1 && Math.abs(q.y - p.y) < 1)
  // Bounded: the grid cascades forever, but a user with hundreds of parts is
  // better served by a slot that overlaps than by a hang.
  for (let n = 0; n < 200; n++) {
    const p = spawnPoint(n)
    if (!isTaken(p)) return p
  }
  return spawnPoint(occupied.length)
}

/**
 * Turns a part-local connector offset into the offset after the part is
 * rotated, matching SVG's own rotate() (clockwise, y down).
 *
 * Shared because a part's legs have three consumers that must agree: the body
 * glyph, the connector dots, and the wire endpoints. Only the body was inside
 * the rotate group, so rotating a 7-segment swung its legs 90 degrees while all
 * eight dots and wires stayed in a row below it, soldered to empty space.
 */
export function rotateOffset(off: { x: number; y: number }, degrees: number): { x: number; y: number } {
  if (!degrees) return off
  const r = (degrees * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return { x: off.x * cos - off.y * sin, y: off.x * sin + off.y * cos }
}

/**
 * Where the nth part lands. Confined to the strip above the board and clamped
 * inside the design space: an unclamped grid ran parts onto the board (where
 * they covered pins and blocked wiring) and then past the viewBox entirely,
 * where they were invisible AND unclickable, so they could never be dragged
 * back. Once the strip is full it cascades with a small offset so parts stay
 * individually grabbable.
 */
export function spawnPoint(n: number): { x: number; y: number } {
  const perPage = COLS * ROWS
  const page = Math.floor(Math.max(0, n) / perPage)
  const i = Math.max(0, n) % perPage
  const offset = page * 16
  const p = clampToSpace({ x: ORIGIN.x + (i % COLS) * CELL.w + offset, y: ORIGIN.y + Math.floor(i / COLS) * CELL.h + offset })
  // Tighter than clampToSpace on y: a new part must also clear the board, or it
  // covers a header pad and swallows that pin's wiring click.
  return { x: p.x, y: clamp(p.y, MARGIN, BOARD.y - MARGIN) }
}
