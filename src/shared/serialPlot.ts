/**
 * Extract numeric telemetry channels from ONE complete serial line, for the
 * live plotter. Pure and testable.
 *
 * Recognizes labelled pairs (`temp: 24.5`, `rpm=1200`) anywhere in the line;
 * if there are none, falls back to a CSV/whitespace row of bare numbers mapped
 * to channels ch0, ch1, ...
 *
 * IMPORTANT: callers must pass COMPLETE lines only. Parsing raw stream chunks
 * would split a value like `24` + `.5` across reads and corrupt the series.
 */

const PAIR_RE = /([A-Za-z_]\w*)\s*[:=]\s*(-?\d+(?:\.\d+)?)/g

export function extractSeries(line: string): Record<string, number> {
  const out: Record<string, number> = {}
  const pairs = [...line.matchAll(PAIR_RE)]
  if (pairs.length > 0) {
    for (const m of pairs) out[m[1]] = parseFloat(m[2])
    return out
  }
  const nums = line
    .trim()
    .split(/[,\s\t]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n))
  nums.forEach((n, i) => {
    out[`ch${i}`] = n
  })
  return out
}
