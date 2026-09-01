import { promises as fs } from 'fs'
import type { DatasheetSection } from '../../shared/datasheet'

/**
 * PDF text extraction for the datasheet subsystem: turns a PDF into the same
 * DatasheetSection[] shape (text + line + PAGE provenance) the markdown/text
 * adapters produce, so the pure BM25 engine, the citations, the IPC types, and
 * the panel are all unchanged - PDF is just one more input adapter.
 *
 * Implementation choices, and why:
 *  - pdf2json (pure JavaScript, zero native deps, engines node>=20.18) is loaded
 *    LAZILY via dynamic import and declared an OPTIONAL dependency, so a missing
 *    or broken install degrades to isPdfAvailable()=false and never blocks app
 *    start - the serialport/node-pty pattern. It also avoids pdfjs-dist>=4.2's
 *    Promise.withResolvers, which Electron 33's Node 20 does not have.
 *  - pdf2json v4 returns plain UTF-8 text (it dropped the old URI-encoding), so
 *    run text is used verbatim - decoding it would corrupt any literal %XX (e.g.
 *    a `printf("0x%02X")` in a datasheet), fabricating text that isn't on the
 *    page. Runs on a visual line are joined gap-aware (their x/width) so a
 *    kerning-split token like `0x68` is rejoined rather than broken into `0x 68`.
 *
 * ROBUSTNESS - honest bounds. The parse currently runs on the main thread. It is
 * bounded by a pre-parse byte cap and by a wall-clock timeout that, on expiry,
 * calls parser.destroy() to abort pdf2json's async loading pipeline and frees its
 * buffers. That covers a slow or malformed PDF. It does NOT interrupt a purely
 * synchronous hang inside pdf.js (a crafted pathological stream), which a
 * same-thread timer cannot preempt; the byte cap is the real guard there. Full
 * immunity needs moving the parse to a terminable worker_thread/utilityProcess -
 * a deliberate follow-up (see docs). Imports are explicit user actions on chosen
 * files, so this bound is acceptable for now, and the byte cap is set
 * conservatively for the main thread.
 *
 * HONESTY: only text actually present in the PDF's text layer is returned. A
 * scanned / image-only PDF has no text layer; extraction then yields nothing and
 * reports it as such - OCR is out of scope, and empty is never dressed up as
 * success.
 */

const MAX_PDF_BYTES = 20 * 1024 * 1024
const MAX_PAGES = 400
const EXTRACT_TIMEOUT_MS = 25000
// Below this x-gap (pdf2json units) between two runs on a line, they are one
// token split by kerning/style and are joined with no space; above it, a real
// word/column break gets a single space.
const SPACE_GAP = 0.2

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfParserModule = { default: new (context: unknown, needRawText?: number | boolean) => any }

let availability: Promise<boolean> | null = null

/** Whether the PDF extractor can be loaded in this build. Cached only on
 *  SUCCESS; a failure is not memoized, so a transient import error can be
 *  retried on the next import rather than disabling PDF forever. */
export function isPdfAvailable(): Promise<boolean> {
  if (!availability) {
    availability = import('pdf2json')
      .then(() => true)
      .catch(() => {
        availability = null // do not cache the failure
        return false
      })
  }
  return availability
}

export type PdfExtractResult =
  | { ok: true; text: string; sections: DatasheetSection[] }
  | { ok: false; error: string }

interface RawText {
  x: number
  y: number
  w?: number
  R?: { T?: string }[]
}
interface RawPage {
  Texts?: RawText[]
}

/** A single Text object's string: concatenate its R sub-runs. pdf2json v4 text
 *  is already plain UTF-8, so it is used as-is (see the header - decoding it
 *  would corrupt literal %XX sequences). */
function runText(t: RawText): string {
  return (t.R ?? []).map((r) => r.T ?? '').join('')
}

/** Join the runs of one visual line, inserting a space only where the x-gap
 *  indicates a real break, so contiguous tokens (0x68, ADS1115) survive. Pure
 *  and exported for unit testing. */
export function joinLineRuns(runs: RawText[]): string {
  const sorted = [...runs].sort((a, b) => a.x - b.x)
  let out = ''
  let prevEnd: number | null = null
  for (const r of sorted) {
    const s = runText(r)
    if (out !== '') {
      const gap = prevEnd == null ? SPACE_GAP + 1 : r.x - prevEnd
      out += gap < SPACE_GAP ? '' : ' '
    }
    out += s
    prevEnd = typeof r.w === 'number' ? r.x + r.w : null
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

/** Reconstruct one page's visual lines from its positioned text runs: group runs
 *  with (near-)equal y into a line, order lines top-to-bottom. */
function pageLines(page: RawPage): { y: number; text: string }[] {
  const runs = (page.Texts ?? []).filter((t) => typeof t.y === 'number' && typeof t.x === 'number')
  const byLine = new Map<number, RawText[]>()
  for (const t of runs) {
    const key = Math.round(t.y * 2) / 2 // 0.5-unit y buckets tolerate minor jitter
    const arr = byLine.get(key) ?? []
    arr.push(t)
    byLine.set(key, arr)
  }
  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([y, ts]) => ({ y, text: joinLineRuns(ts) }))
    .filter((l) => l.text.length > 0)
}

/** Split a page's lines into blocks on a vertical gap noticeably larger than the
 *  page's typical line spacing, approximating paragraphs so retrieval is not one
 *  giant per-page blob. A uniformly spaced page stays a single block. */
function pageBlocks(lines: { y: number; text: string }[]): string[][] {
  if (lines.length <= 1) return lines.length ? [[lines[0].text]] : []
  const gaps = lines.slice(1).map((l, i) => l.y - lines[i].y).filter((g) => g > 0)
  const sorted = [...gaps].sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1
  const threshold = Math.max(median * 1.8, median + 0.5)
  const blocks: string[][] = []
  let cur: string[] = [lines[0].text]
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].y - lines[i - 1].y > threshold) {
      blocks.push(cur)
      cur = []
    }
    cur.push(lines[i].text)
  }
  if (cur.length) blocks.push(cur)
  return blocks
}

/**
 * Extract a PDF into an assembled plain-text rendering plus BM25 sections. The
 * assembled `text` is stored (revealable, line-addressable); each section's
 * `line` indexes into that text and its `page` is the 1-based PDF page.
 */
export async function extractPdf(absPath: string): Promise<PdfExtractResult> {
  let mod: PdfParserModule
  try {
    mod = (await import('pdf2json')) as unknown as PdfParserModule
  } catch {
    return { ok: false, error: 'PDF support is not available in this build.' }
  }
  try {
    const stat = await fs.stat(absPath)
    if (stat.size > MAX_PDF_BYTES) return { ok: false, error: `PDF is too large to import (${stat.size} bytes).` }
  } catch (e) {
    return { ok: false, error: `Could not read the PDF: ${e instanceof Error ? e.message : String(e)}` }
  }

  let data: { Pages?: RawPage[] }
  try {
    data = await new Promise((resolvePromise, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parser: any = new mod.default(null, false)
      let done = false
      const finalize = (): void => {
        clearTimeout(timer)
        try {
          parser.removeAllListeners?.()
          parser.destroy?.() // aborts pdf2json's in-progress loading task + frees buffers
        } catch {
          /* best-effort teardown */
        }
      }
      const timer = setTimeout(() => {
        if (done) return
        done = true
        finalize()
        reject(new Error('PDF parsing timed out.'))
      }, EXTRACT_TIMEOUT_MS)
      parser.on('pdfParser_dataError', (err: unknown) => {
        if (done) return
        done = true
        finalize()
        // pdf2json emits either {parserError} (parse) or a raw Error (IO); keep
        // the real cause so an IO/availability failure is not mislabeled corrupt.
        const e =
          err instanceof Error
            ? err
            : (err as { parserError?: Error })?.parserError ?? new Error('PDF could not be parsed.')
        reject(e)
      })
      parser.on('pdfParser_dataReady', (d: { Pages?: RawPage[] }) => {
        if (done) return
        done = true
        finalize()
        resolvePromise(d)
      })
      parser.loadPDF(absPath)
    })
  } catch (e) {
    return { ok: false, error: `Could not parse the PDF: ${e instanceof Error ? e.message : String(e)}` }
  }

  const pages = (data.Pages ?? []).slice(0, MAX_PAGES)
  const outLines: string[] = []
  const sections: DatasheetSection[] = []
  for (let p = 0; p < pages.length; p++) {
    const lines = pageLines(pages[p])
    if (!lines.length) {
      if (outLines.length) outLines.push('') // keep pagination honest for an empty page
      continue
    }
    const blocks = pageBlocks(lines)
    if (outLines.length) outLines.push('') // blank line between pages
    for (const block of blocks) {
      const startLine = outLines.length + 1 // 1-based line in the assembled text
      for (const ln of block) outLines.push(ln)
      sections.push({ line: startLine, page: p + 1, text: block.join('\n') })
    }
  }

  if (sections.length === 0) {
    return {
      ok: false,
      error: 'No extractable text in this PDF. It looks scanned or image-only (OCR is not supported).'
    }
  }
  return { ok: true, text: outLines.join('\n') + '\n', sections }
}
