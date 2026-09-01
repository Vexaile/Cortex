import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * WCAG contrast for the token pairs the app actually renders, for BOTH themes.
 *
 * This exists because ide-faint was already raised once for failing AA, and the
 * fix was measured against ide-bg only. On the selected row (ide-active) it
 * measured 3.21:1, essentially the ratio it had been raised from. A token is
 * not "accessible" on its own; only a token on a background is.
 *
 * The ide-* tokens live in styles/index.css as space-separated RGB channels
 * (a bare :root block for Cortex Dark, a :root[data-theme='light'] block for
 * Cortex Light) so tailwind can theme by variable swap. The values are parsed
 * back out here so the test cannot drift from the palette it is checking, and
 * both themes are held to the same bar.
 */

const CSS = readFileSync(join(__dirname, '..', 'src', 'renderer', 'src', 'styles', 'index.css'), 'utf8')

/** The body of the first CSS rule whose selector text starts with `selector`. */
function ruleBody(selector: string): string {
  const start = CSS.indexOf(selector)
  if (start < 0) throw new Error(`selector ${selector} not found in index.css`)
  const open = CSS.indexOf('{', start)
  const close = CSS.indexOf('}', open)
  if (open < 0 || close < 0) throw new Error(`malformed rule for ${selector}`)
  return CSS.slice(open + 1, close)
}

/** Parse `--ide-name: R G B;` declarations from a rule body into name -> hex. */
function parsePalette(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /--ide-([a-z-]+):\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*;/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const [, name, r, g, b] = m
    out[name] = '#' + [r, g, b].map((x) => Number(x).toString(16).padStart(2, '0')).join('')
  }
  return out
}

// ':root {' matches the dark block only; the light block's selector is
// ":root[data-theme='light']", which does not contain ':root {'.
const DARK = parsePalette(ruleBody(':root {'))
const LIGHT = parsePalette(ruleBody(":root[data-theme='light']"))
const THEMES: [string, Record<string, string>][] = [
  ['dark', DARK],
  ['light', LIGHT]
]

function tok(pal: Record<string, string>, name: string): string {
  const hex = pal[name]
  if (!hex) throw new Error(`token ${name} not defined in this palette`)
  return hex
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
 * Solid token-on-token (foreground, background) pairs the app renders TEXT in.
 * Add a row when you use a token on a surface it has not been used on before,
 * because that pair is new even if both halves are old.
 *
 * NOT covered yet: alpha-composited tints, where the text sits on bg-ide-X/15
 * (a 15%-alpha tint of the same hue over the panel/bg) rather than a solid
 * surface - the status/severity badges in EnvironmentPanel and AgentView. Those
 * measure lower than the solid pair and some dip under AA; decoupling the label
 * hue from the tint and adding composite coverage here is a tracked a11y slice.
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

describe.each(THEMES)('WCAG contrast (%s)', (_theme, pal) => {
  it.each(TEXT_PAIRS)('%s on %s clears AA for text (%s)', (fg, bg) => {
    expect(contrast(tok(pal, fg), tok(pal, bg))).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it.each(GRAPHIC_PAIRS)('%s on %s clears AA for graphics (%s)', (fg, bg) => {
    expect(contrast(tok(pal, fg), tok(pal, bg))).toBeGreaterThanOrEqual(AA_GRAPHIC)
  })

  // .btn-accent renders white text on the accent. It is a real pair in both
  // themes, so pin it: the light accent is deliberately darker than the dark
  // one so this stays above 4.5:1.
  it('white button text clears AA on the accent', () => {
    expect(contrast('#FFFFFF', tok(pal, 'accent'))).toBeGreaterThanOrEqual(AA_TEXT)
  })
})

describe('WCAG contrast (identity)', () => {
  // The dark accent is the identity navy and is deliberately below 4.5:1 as
  // text. Pinning it here means using it as text is a decision someone has to
  // make on purpose. (The light accent is darker and clears the text bar, which
  // is why this assertion is dark-only.)
  it('accent is a graphic-only token in dark', () => {
    expect(contrast(DARK.accent, DARK.bar)).toBeLessThan(AA_TEXT)
    expect(contrast(DARK.accent, DARK.bar)).toBeGreaterThanOrEqual(AA_GRAPHIC)
  })

  it('parses both palettes', () => {
    expect(Object.keys(DARK).length).toBeGreaterThanOrEqual(18)
    expect(Object.keys(LIGHT).length).toBe(Object.keys(DARK).length)
  })

  it('computes known ratios correctly', () => {
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 5)
    expect(contrast('#000000', '#000000')).toBeCloseTo(1, 5)
  })
})
