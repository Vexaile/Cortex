/**
 * A small, dependency-free line diff for the agent's edit-review UI. Produces
 * unified-style hunks (changed lines plus a few lines of surrounding context) so
 * a whole-file replacement can be reviewed as a focused diff rather than the two
 * full files. Pure and unit-tested; no Monaco, no DOM.
 */

export type DiffLineType = 'context' | 'add' | 'del'

export interface DiffLine {
  type: DiffLineType
  text: string
  /** 1-based line number in the old file (context + del). */
  oldLine?: number
  /** 1-based line number in the new file (context + add). */
  newLine?: number
}

export interface DiffHunk {
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

export interface DiffStat {
  added: number
  removed: number
}

/** Guard against a pathological O(n*m) LCS on a huge file. Beyond this the UI
 *  shows a summary instead of a line diff. */
export const MAX_DIFF_LINES = 4000

export function diffStat(oldText: string, newText: string): DiffStat {
  let added = 0
  let removed = 0
  for (const l of diffLines(oldText, newText)) {
    if (l.type === 'add') added++
    else if (l.type === 'del') removed++
  }
  return { added, removed }
}

/** True when the inputs are too large for a line-by-line diff. */
export function isDiffTooLarge(oldText: string, newText: string): boolean {
  return splitLines(oldText).length > MAX_DIFF_LINES || splitLines(newText).length > MAX_DIFF_LINES
}

/**
 * Full typed line list (every line tagged context/add/del). The hunk builder
 * groups these; exported for testing and for callers that want the raw form.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText)
  const b = splitLines(newText)
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    // Degrade rather than allocate an enormous DP table: treat it as a wholesale
    // replacement. Callers gate on isDiffTooLarge before rendering anyway.
    const out: DiffLine[] = []
    a.forEach((t, i) => out.push({ type: 'del', text: t, oldLine: i + 1 }))
    b.forEach((t, i) => out.push({ type: 'add', text: t, newLine: i + 1 }))
    return out
  }

  // Longest common subsequence over lines (classic DP), then walk back.
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'context', text: a[i], oldLine: i + 1, newLine: j + 1 })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i], oldLine: i + 1 })
      i++
    } else {
      out.push({ type: 'add', text: b[j], newLine: j + 1 })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i], oldLine: ++i })
  while (j < m) out.push({ type: 'add', text: b[j], newLine: ++j })
  return out
}

/**
 * Group the typed lines into hunks with `context` unchanged lines around each
 * run of changes. Unchanged regions larger than 2*context collapse away.
 */
export function diffHunks(oldText: string, newText: string, context = 3): DiffHunk[] {
  return hunksFromLines(diffLines(oldText, newText), context)
}

/** Group already-computed typed lines into hunks. Lets a caller run the (costly)
 *  line diff once and derive both the hunks and the stat from it. */
export function hunksFromLines(lines: DiffLine[], context = 3): DiffHunk[] {
  const changed = lines.map((l) => l.type !== 'context')
  // Which lines to keep: any change, plus `context` lines on each side.
  const keep = new Array<boolean>(lines.length).fill(false)
  for (let k = 0; k < lines.length; k++) {
    if (!changed[k]) continue
    for (let d = -context; d <= context; d++) {
      const idx = k + d
      if (idx >= 0 && idx < lines.length) keep[idx] = true
    }
  }
  const hunks: DiffHunk[] = []
  let cur: DiffLine[] | null = null
  let oldStart = 0
  let newStart = 0
  for (let k = 0; k < lines.length; k++) {
    if (keep[k]) {
      if (!cur) {
        cur = []
        oldStart = lines[k].oldLine ?? lines[k].newLine ?? 1
        newStart = lines[k].newLine ?? lines[k].oldLine ?? 1
      }
      cur.push(lines[k])
    } else if (cur) {
      hunks.push({ oldStart, newStart, lines: cur })
      cur = null
    }
  }
  if (cur) hunks.push({ oldStart, newStart, lines: cur })
  return hunks
}

/**
 * Split into lines for comparison, tolerant of line endings: a trailing '\r'
 * (CRLF file) is stripped so a CRLF source and the model's LF output compare
 * line-for-line instead of every line reading as changed. No trailing empty
 * line is invented for a final newline.
 */
function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** The dominant line ending of a text (CRLF if any CRLF is present). */
export function detectEol(text: string): '\r\n' | '\n' {
  return /\r\n/.test(text) ? '\r\n' : '\n'
}

/** Collapse all line endings to '\n', for EOL-insensitive equality checks. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

/** Rewrite `text` (assumed LF) to use `eol`, so an edit preserves a file's
 *  existing line endings rather than silently converting the whole file. */
export function withEol(text: string, eol: '\r\n' | '\n'): string {
  const lf = text.replace(/\r\n/g, '\n')
  return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf
}
