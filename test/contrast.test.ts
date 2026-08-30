import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * WCAG contrast for the token pairs the app actually renders.
 *
 * This exists because ide-faint was already raised once for failing AA, and the
 * fix was measured against ide-bg only. On the selected row (ide-active) it
 * measured 3.21:1, essentially the ratio it had been raised from. A token is
 * not "accessible" on its own; only a token on a background is.
 *
 * Hexes are parsed out of tailwind.config.js so the test cannot drift from the
 * palette it is checking.
 */

const CONFIG = readFileSync(join(__dirname, '..', 'tailwind.config.js'), 'utf8')

function token(name: string): string {
  const m = CONFIG.match(new RegExp(`\\b${name}:\\s*'(#[0-9A-Fa-f]{6})'`))
  if (!m) throw new Error(`token ${name} not found in tailwind.config.js`)
  return m[1]
}

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = v.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const AA_TEXT = 4.5
/** WCAG 1.4.11: icons and other non-text carry a lower bar. */
const AA_GRAPHIC = 3

/**
 * Every (foreground, background) pair the app renders TEXT in. Add a row when
 * you use a token on a surface it has not been used on before, because that
 * pair is new even if both halves are old.
 */
const TEXT_PAIRS: [string, string, string][] = [
  ['text', 'bg', 'editor and body text'],
  ['text', 'panel', 'panel body text'],
  ['text', 'bar', 'title bar, status bar'],
  ['text', 'active', 'selected row label'],
  ['muted', 'bg', 'secondary text'],
  ['muted', 'panel', 'panel secondary text'],
  ['muted', 'bar', 'status bar secondary'],
  ['muted', 'active', 'selected row hint (palette, devices)'],
  ['muted', 'hover', 'hovered row'],
  ['faint', 'bg', 'tertiary text and placeholders'],
  ['faint', 'panel', 'panel tertiary text'],
  ['faint', 'bar', 'bar tertiary text'],
  ['amber', 'bar', 'unsaved indicator'],
  ['amber', 'panel', 'simulator warnings'],
  ['moss', 'bar', 'exit 0'],
  ['moss', 'panel', 'simulator serial output'],
  ['red', 'bar', 'nonzero exit'],
  ['red', 'panel', 'errors'],
  ['cyan', 'bar', 'compiling and running status'],
  ['green', 'panel', 'serial monitor output'],
  ['yellow', 'panel', 'buzzer and highlights'],
  ['purple', 'panel', 'plot series']
]

/** Tokens used only to color icons and glyphs, which need 3:1, not 4.5:1. */
const GRAPHIC_PAIRS: [string, string, string][] = [
  ['accent', 'bar', 'board and device icons'],
  ['accent', 'panel', 'AI and plot icons'],
  ['accent', 'bg', 'running caret'],
  ['navy', 'panel', 'simulator header icon']
]

describe('WCAG contrast', () => {
  it.each(TEXT_PAIRS)('%s on %s clears AA for text (%s)', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it.each(GRAPHIC_PAIRS)('%s on %s clears AA for graphics (%s)', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(AA_GRAPHIC)
  })

  // The accent is the identity navy and is deliberately below 4.5:1. Pinning it
  // here means using it as text is a decision someone has to make on purpose.
  it('records that accent is a graphic-only token', () => {
    expect(contrast(token('accent'), token('bar'))).toBeLessThan(AA_TEXT)
    expect(contrast(token('accent'), token('bar'))).toBeGreaterThanOrEqual(AA_GRAPHIC)
  })

  it('computes known ratios correctly', () => {
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 5)
    expect(contrast('#000000', '#000000')).toBeCloseTo(1, 5)
  })
})
