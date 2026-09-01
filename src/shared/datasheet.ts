/**
 * Datasheet / document intelligence: the PURE core of Cortex's engineering-
 * document knowledge system. No Electron, no fs - the main-process service does
 * the file IO and this module does the sectionizing, the local lexical retrieval
 * (BM25), the correlation with the hardware graph, and the citation formatting.
 * Kept dependency-free so the retrieval math is unit-tested in isolation, the
 * same discipline as environment.ts / hardwareGraph.ts / agentContext.ts.
 *
 * This is deliberately NOT "chat with a PDF". It is engineering-context
 * RETRIEVAL WITH CITATIONS: every result is a verbatim passage carrying real
 * provenance back to the source document (name, section heading, and the line -
 * plus a page once a PDF adapter supplies one). Nothing is summarized,
 * paraphrased, or synthesized here; the model and the UI receive only text that
 * actually appears in an imported document, with a citation that resolves to it.
 * No embeddings and no network: retrieval is a local BM25 over the imported
 * corpus, so it is offline, deterministic, and makes no claim it cannot back.
 */

import type { HardwareGraph, KnownDevice } from './hardwareGraph'

export interface DatasheetSection {
  /** 1-based line in the stored source document where this section starts, so a
   *  citation can open the doc at exactly this point. */
  line: number
  /** 1-based page, when the source carries pages (PDF). Absent for markdown/text. */
  page?: number
  /** The section's heading text, if it had one. */
  title?: string
  /** The section body, verbatim. */
  text: string
}

export interface DatasheetDoc {
  /** Stable id (a slug of the stored file name). */
  id: string
  /** Display name (the original file name). */
  name: string
  /** Stored path, workspace-relative (.cortex/datasheets/<file>), for reveal. */
  path: string
  /** Hardware-graph device this doc was auto-linked to at import (KnownDevice.key),
   *  when the name matched a known part. Absent when no confident match. */
  deviceKey?: string
  sections: DatasheetSection[]
}

export interface DocCitation {
  docId: string
  docName: string
  /** Stored path (workspace-relative) for click-to-open. */
  path: string
  line: number
  page?: number
  title?: string
}

export interface DatasheetHit {
  citation: DocCitation
  /** The verbatim passage (clipped for display; never rewritten). */
  text: string
  /** BM25 relevance score; higher is more relevant. */
  score: number
}

/** An imported document's metadata (no section bodies), for the panel list and
 *  the IPC layer. */
export interface DatasheetDocMeta {
  id: string
  name: string
  /** Workspace-relative path of the revealable text (the stored .md/.txt, or a
   *  PDF's extracted .txt), e.g. ".cortex/datasheets/MPU6050.md". */
  path: string
  /** How the stored text is sectionized on load. A `pdf` doc's sections are read
   *  from a pre-extracted sidecar (page provenance can't be recovered by
   *  re-sectionizing plain text), not produced by the text sectionizer. */
  kind: 'markdown' | 'text' | 'pdf'
  /** For a `pdf` doc: the workspace-relative path of the extracted-sections
   *  sidecar JSON (DatasheetSection[] with page + line). */
  sectionsPath?: string
  /** Auto-linked hardware-graph device key, when the name matched a known part. */
  deviceKey?: string
}

/** Outcome of an import attempt, surfaced to the renderer. */
export interface DatasheetImportResult {
  ok: boolean
  error?: string
  name?: string
  deviceKey?: string
}

// ---- tokenization ---------------------------------------------------------

/**
 * Lowercase and split on non-alphanumerics. Deliberately keeps technical tokens
 * whole: "0x68", "GPIO5", "TIM2", "PA5", bare pin numbers - all survive, because
 * an address or register name is exactly what a datasheet query is about.
 */
export function tokenize(s: string): string[] {
  const out: string[] = []
  for (const t of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (t) out.push(t)
  }
  return out
}

// ---- sectionizing ---------------------------------------------------------

/** Markdown: one section per heading (#..######), the heading plus the lines
 *  under it up to the next heading. Content before the first heading is its own
 *  untitled section. Line numbers are 1-based and point at the section start. */
export function sectionizeMarkdown(text: string): DatasheetSection[] {
  const lines = text.split(/\r?\n/)
  const sections: DatasheetSection[] = []
  let cur: { line: number; title?: string; body: string[] } | null = null
  const flush = (): void => {
    if (!cur) return
    const body = cur.body.join('\n').trim()
    // Keep a heading-only section (title carries meaning even with no body).
    if (body || cur.title) sections.push({ line: cur.line, title: cur.title, text: body })
    cur = null
  }
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i])
    if (m) {
      flush()
      cur = { line: i + 1, title: m[2].trim(), body: [] }
    } else {
      if (!cur) cur = { line: i + 1, body: [] }
      cur.body.push(lines[i])
    }
  }
  flush()
  return sections
}

/** Plain text: one section per paragraph (runs separated by a blank line), each
 *  tagged with the line it starts on. Groups of blank lines collapse. */
export function sectionizePlainText(text: string): DatasheetSection[] {
  const lines = text.split(/\r?\n/)
  const sections: DatasheetSection[] = []
  let start = -1
  let buf: string[] = []
  const flush = (): void => {
    if (start >= 0 && buf.join('').trim()) sections.push({ line: start + 1, text: buf.join('\n').trim() })
    start = -1
    buf = []
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      flush()
    } else {
      if (start < 0) start = i
      buf.push(lines[i])
    }
  }
  flush()
  return sections
}

/** Pick the sectionizer by document kind. */
export function sectionize(text: string, kind: 'markdown' | 'text'): DatasheetSection[] {
  return kind === 'markdown' ? sectionizeMarkdown(text) : sectionizePlainText(text)
}

// ---- BM25 index + query ---------------------------------------------------

interface IndexEntry {
  docId: string
  docName: string
  path: string
  section: DatasheetSection
  tf: Map<string, number>
  len: number
}

export interface DocIndex {
  entries: IndexEntry[]
  /** document frequency: sections containing a term. */
  df: Map<string, number>
  avgLen: number
  n: number
}

const K1 = 1.5
const B = 0.75

/** Build a BM25 index over every section of every imported document. Pure and
 *  deterministic: the same corpus always yields the same index and rankings. */
export function buildIndex(docs: DatasheetDoc[]): DocIndex {
  const entries: IndexEntry[] = []
  const df = new Map<string, number>()
  let totalLen = 0
  for (const doc of docs) {
    for (const section of doc.sections) {
      const tokens = tokenize(`${section.title ?? ''} ${section.text}`)
      const tf = new Map<string, number>()
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
      for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
      entries.push({ docId: doc.id, docName: doc.name, path: doc.path, section, tf, len: tokens.length })
      totalLen += tokens.length
    }
  }
  return { entries, df, avgLen: entries.length ? totalLen / entries.length : 0, n: entries.length }
}

function idf(df: number, n: number): number {
  // Always positive (the "+1" BM25 variant), so a common term never subtracts.
  return Math.log(1 + (n - df + 0.5) / (df + 0.5))
}

/** Query the index. `extraTerms` are appended to the query tokens (used for
 *  hardware-graph enrichment). Returns the top `k` sections as cited passages,
 *  ranked by BM25, ties broken deterministically by corpus order. Sections that
 *  match nothing are never returned (a zero score is not a citation). */
export function queryIndex(index: DocIndex, queryText: string, k = 5, extraTerms: string[] = []): DatasheetHit[] {
  const terms = [...new Set([...tokenize(queryText), ...extraTerms.flatMap((t) => tokenize(t))])]
  if (terms.length === 0 || index.n === 0) return []
  const scored: Array<{ i: number; score: number }> = []
  for (let i = 0; i < index.entries.length; i++) {
    const e = index.entries[i]
    let score = 0
    for (const t of terms) {
      const f = e.tf.get(t)
      if (!f) continue
      const dfT = index.df.get(t) ?? 0
      const denom = f + K1 * (1 - B + (B * e.len) / (index.avgLen || 1))
      score += idf(dfT, index.n) * ((f * (K1 + 1)) / denom)
    }
    if (score > 0) scored.push({ i, score })
  }
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  return scored.slice(0, k).map(({ i, score }) => {
    const e = index.entries[i]
    return {
      citation: {
        docId: e.docId,
        docName: e.docName,
        path: e.path,
        line: e.section.line,
        page: e.section.page,
        title: e.section.title
      },
      // A heading-only section has an empty body; fall back to its (verbatim)
      // heading so a hit's passage is never empty and always shows matchable text.
      text: e.section.text || e.section.title || '',
      score
    }
  })
}

// ---- citation formatting (the exact bytes the model/UI see) ---------------

const MAX_PASSAGE = 600

/** One citation line: `DocName > Section [p.N L:line]`. Page is included only
 *  when the source actually had one. */
export function formatCitation(c: DocCitation): string {
  const loc = [c.page != null ? `p.${c.page}` : '', `L:${c.line}`].filter(Boolean).join(' ')
  const head = c.title ? `${c.docName} > ${c.title}` : c.docName
  return `${head} [${loc}]`
}

/**
 * The passages, formatted for a model prompt: each is the citation line followed
 * by the verbatim passage (clipped, never rewritten). This is the single
 * formatter used by the agent tool, the structured fallback, and the chat
 * injection, so citations render identically everywhere. When there are no hits
 * it says so plainly, so the model treats "not in the docs" as a fact rather
 * than a licence to invent.
 */
export function formatDocHits(hits: DatasheetHit[]): string {
  if (hits.length === 0) return 'No matching passage in the imported documents.'
  return hits
    .map((h) => {
      const body = h.text.length > MAX_PASSAGE ? h.text.slice(0, MAX_PASSAGE) + ' ...' : h.text
      return `[${formatCitation(h.citation)}]\n${body}`
    })
    .join('\n\n')
}

// ---- correlation with the hardware graph ----------------------------------

/**
 * Enrich a natural-language query with terms drawn from the devices the project
 * actually uses. Pure: it consumes an already-built hardware graph and never
 * re-derives it.
 *
 * Scoping keeps enrichment on target:
 *  - a device the query NAMES (by label or key) is always included;
 *  - if the query names a specific bus (I2C/SPI/UART), only devices the graph
 *    puts on that bus (its `likely-on-bus` edges) are added - so "the I2C sensor"
 *    does not drag in the SPI card or the PWM servo;
 *  - only if the query is a generic hardware question with NO specific bus (just
 *    "the sensor") does it fall back to all of the project's devices.
 *
 * Honesty: enrichment only ADDS query terms taken verbatim from graph nodes
 * (device label + key + the meaningful words of the device's description). Bare
 * numbers and 1-2 char fragments are dropped so "6-axis" does not inject the term
 * "6". It never asserts a correlation as fact; a term that biases toward the
 * wrong part at most surfaces a passage that still carries its own citation.
 */
export function enrichQueryFromGraph(graph: HardwareGraph, queryText: string): { terms: string[]; deviceKeys: string[] } {
  const q = queryText.toLowerCase()
  const devices = graph.nodes.filter((n) => n.kind === 'device')
  const busKinds = new Set<string>()
  if (/\bi2c\b/.test(q)) busKinds.add('i2c')
  if (/\bspi\b/.test(q)) busKinds.add('spi')
  if (/\buart\b|\bserial\b/.test(q)) busKinds.add('uart')
  const mentionsGenericDevice = /\bsensor\b|\bdevice\b|\bchip\b|\bperipheral\b|\bmodule\b|\bimu\b|\bdisplay\b/.test(q)

  // Which bus kinds each device is likely on, from the graph's inferred edges
  // (id shape "bus:<kind>:<instance>").
  const deviceBusKinds = new Map<string, Set<string>>()
  for (const e of graph.edges) {
    if (e.relation !== 'likely-on-bus') continue
    const kind = e.to.split(':')[1]
    const set = deviceBusKinds.get(e.from) ?? new Set<string>()
    set.add(kind)
    deviceBusKinds.set(e.from, set)
  }

  const terms = new Set<string>()
  const deviceKeys: string[] = []
  for (const d of devices) {
    const key = d.id.startsWith('device:') ? d.id.slice('device:'.length) : d.id
    const named = q.includes(d.label.toLowerCase()) || q.includes(key.toLowerCase())
    let include = named
    if (!include) {
      if (busKinds.size) {
        // A specific bus was named: include only devices the graph puts on it.
        const kinds = deviceBusKinds.get(d.id)
        include = !!kinds && [...busKinds].some((k) => kinds.has(k))
      } else if (mentionsGenericDevice) {
        include = true // "the sensor", no bus specified: the project's devices
      }
    }
    if (!include) continue
    deviceKeys.push(key)
    terms.add(d.label)
    terms.add(key)
    // Meaningful description words only: drop pure numbers and 1-2 char fragments
    // so units/counts ("6" from "6-axis") never become query terms.
    if (d.detail) for (const w of d.detail.split(/[^A-Za-z0-9]+/)) if (w.length >= 3 && !/^\d+$/.test(w)) terms.add(w)
  }
  return { terms: [...terms], deviceKeys: [...new Set(deviceKeys)] }
}

/**
 * Auto-link an imported document to a known device by matching its file name
 * against each device's key and label (including slash/comma alternatives like
 * "ADS1015/ADS1115"). It compares each candidate part identifier - alphanumerics
 * only - against every CONTIGUOUS run of the file name's tokens, so a real
 * manufacturer name matches whether or not it carries separators: "MPU-6050.md",
 * "MPU6050.md", "mpu_6050.md" all link to mpu6050, and "ADS1115.md" links to
 * ads1x15 via its label alternative. Matching a whole contiguous run (not a
 * loose substring) avoids false positives - a 2-char key like "ir" cannot match
 * "wiring.md" - and candidates shorter than 3 chars are not auto-linked at all.
 * Returns the first confident match, or undefined. A link is a correlation
 * convenience, never a claim about wiring.
 */
export function matchDeviceForDoc(docName: string, known: KnownDevice[]): string | undefined {
  const toks = tokenize(docName)
  if (toks.length === 0) return undefined
  // Every contiguous concatenation of the file name's tokens.
  const joins = new Set<string>()
  for (let i = 0; i < toks.length; i++) {
    let acc = ''
    for (let j = i; j < toks.length; j++) {
      acc += toks[j]
      joins.add(acc)
    }
  }
  const norm = (s: string): string => s.replace(/[^a-z0-9]/gi, '').toLowerCase()
  for (const d of known) {
    const candidates = [d.key, ...d.label.split(/[/,]/)].map(norm).filter((c) => c.length >= 3)
    if (candidates.some((c) => joins.has(c))) return d.key
  }
  return undefined
}
