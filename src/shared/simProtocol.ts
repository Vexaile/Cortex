/**
 * Parser for the line-based protocol the Arduino simulation shim emits on
 * stdout. Pure and dependency-free so it can be unit tested and shared between
 * the main-process simService and any future engine.
 *
 * Emitted lines:
 *   @mode <pin> <mode>
 *   @pin  <pin> <0|1>
 *   @pwm  <pin> <0-255>
 *   @tone <pin> <freq>
 *   @serial <text...>      (text may be empty)
 * Any other line is treated as raw serial output (best effort).
 */

/**
 * Every pin value crossing `@in` is on the ADC scale, including digital ones.
 * The shim latches a digitalWrite HIGH as ADC_MAX and thresholds digitalRead at
 * LOGIC_THRESHOLD, so one slot can serve digitalRead and analogRead at once.
 *
 * These are shared because the scale has two ends: the renderer sends `@in` and
 * the shim reads it. When they were separate, a button sent 1 ("HIGH") and a
 * potentiometer sent 1 ("nearly 0V") into the same slot, which no threshold can
 * tell apart. Import them; do not restate the numbers.
 */
export const ADC_MAX = 1023
/** Mid-scale. Real silicon has an indeterminate band, so this is a model choice. */
export const LOGIC_THRESHOLD = 512
/** Duty cycle is an 8-bit register on the board, so `@pwm` is 0..255. */
export const PWM_MAX = 255

export type ParsedSimEvent =
  | { kind: 'mode'; pin: number; value: number }
  | { kind: 'pin'; pin: number; value: number }
  | { kind: 'pwm'; pin: number; value: number }
  | { kind: 'tone'; pin: number; value: number }
  | { kind: 'serial'; text: string }

const PIN_KINDS = { '@mode ': 'mode', '@pin ': 'pin', '@pwm ': 'pwm', '@tone ': 'tone' } as const

function twoInts(s: string): [number, number] | null {
  const parts = s.trim().split(/\s+/)
  if (parts.length < 2) return null
  const a = Number(parts[0])
  const b = Number(parts[1])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return [a, b]
}

export function parseSimLine(line: string): ParsedSimEvent | null {
  if (line.startsWith('@serial ')) return { kind: 'serial', text: line.slice(8) }
  for (const [prefix, kind] of Object.entries(PIN_KINDS) as [string, ParsedSimEvent['kind']][]) {
    if (line.startsWith(prefix)) {
      const n = twoInts(line.slice(prefix.length))
      return n ? ({ kind, pin: n[0], value: n[1] } as ParsedSimEvent) : null
    }
  }
  // Unknown @-directive: drop rather than mis-render as serial.
  if (line.startsWith('@')) return null
  return line.length ? { kind: 'serial', text: line } : null
}
