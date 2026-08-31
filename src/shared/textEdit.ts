/**
 * Apply LSP-style TextEdits to a string. Kept dependency-free and shared so
 * both the renderer (rename refactor across files, in lspClient) and any
 * future main-process file-editing tool apply edits identically.
 */

export interface EditPosition {
  line: number
  character: number
}
export interface EditRange {
  start: EditPosition
  end: EditPosition
}
export interface TextEdit {
  range: EditRange
  newText: string
}

/**
 * Apply a set of non-overlapping edits (as LSP guarantees within one response)
 * to `text`. Edits are applied from the end of the document backwards, so each
 * splice uses offsets computed against the original text without earlier edits
 * shifting them. A trailing '\r' stays inside its line, so UTF-16 column
 * offsets still line up on CRLF files.
 */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  if (edits.length === 0) return text
  const lineStart: number[] = []
  let off = 0
  for (const ln of text.split('\n')) {
    lineStart.push(off)
    off += ln.length + 1 // + the '\n'
  }
  const toOffset = (p: EditPosition): number => (lineStart[p.line] ?? text.length) + p.character
  const sorted = [...edits].sort((a, b) => toOffset(b.range.start) - toOffset(a.range.start))
  let out = text
  for (const e of sorted) out = out.slice(0, toOffset(e.range.start)) + e.newText + out.slice(toOffset(e.range.end))
  return out
}
