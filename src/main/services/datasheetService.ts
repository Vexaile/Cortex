import { promises as fs } from 'fs'
import { join, basename } from 'path'
import * as fsService from './fsService'
import { buildProjectModel } from './projectModelService'
import { buildHardwareGraph, KNOWN_DEVICES, type HardwareGraph } from '../../shared/hardwareGraph'
import {
  sectionize,
  buildIndex,
  queryIndex,
  enrichQueryFromGraph,
  matchDeviceForDoc,
  type DatasheetDoc,
  type DatasheetHit,
  type DatasheetDocMeta,
  type DatasheetImportResult,
  type DocIndex
} from '../../shared/datasheet'

/**
 * The datasheet / document intelligence gatherer: imports engineering documents
 * into the project, extracts them into sections with line provenance, and serves
 * BM25 retrieval with citations (the scoring/formatting lives in the pure
 * ../../shared/datasheet module; this file does only the file IO and caching).
 *
 * Security: the corpus is confined to <workspace>/.cortex/datasheets/ on the
 * PHYSICAL filesystem, not by a string prefix. The manifest travels with a
 * cloned repo, so it is UNTRUSTED: a corpus read ignores the manifest's path
 * beyond its basename (forcing it into the corpus dir), rejects a symlink via
 * lstat, and requires the corpus dir's realpath to stay inside the workspace -
 * so a crafted manifest cannot read `../etc/passwd`, a workspace file like
 * `src/secrets.h` / `.env`, or a symlink to a secret into the AI context. The
 * ONLY read outside the corpus is the one user-chosen file at import time, whose
 * path comes from a native open dialog invoked in the main process (the
 * DATASHEET_IMPORT handler), never from the renderer or the AI. Imports refuse
 * to write THROUGH a symlink and confine the corpus dir's realpath. Reads are
 * bounded (readFile refuses binaries and oversized files), so a PDF or a huge
 * blob is rejected with an honest message rather than parsed into garbage.
 */

type StoredDoc = DatasheetDocMeta
interface Manifest {
  docs: StoredDoc[]
}

function dir(root: string): string {
  return join(root, '.cortex', 'datasheets')
}
function manifestPath(root: string): string {
  return join(dir(root), 'manifest.json')
}
function relPath(name: string): string {
  return `.cortex/datasheets/${name}`
}

/** A filesystem-safe stored name: strip any directory, keep only a conservative
 *  charset so a crafted source name can never traverse out of the corpus dir. */
function safeName(srcPath: string): string {
  const base = basename(srcPath).replace(/[^A-Za-z0-9._-]/g, '_')
  return base.replace(/^\.+/, '') || 'document.txt'
}

function kindOf(name: string): 'markdown' | 'text' {
  return /\.(md|markdown|mdx)$/i.test(name) ? 'markdown' : 'text'
}

async function readManifest(root: string): Promise<Manifest> {
  try {
    const raw = await fs.readFile(manifestPath(root), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.docs)) {
      const docs: StoredDoc[] = parsed.docs.filter(
        (d: unknown): d is StoredDoc =>
          !!d && typeof d === 'object' &&
          typeof (d as StoredDoc).id === 'string' &&
          typeof (d as StoredDoc).name === 'string' &&
          typeof (d as StoredDoc).path === 'string'
      )
      return { docs }
    }
  } catch {
    /* no manifest yet */
  }
  return { docs: [] }
}

async function writeManifest(root: string, m: Manifest): Promise<void> {
  await ensureCorpusDir(root)
  await fs.writeFile(manifestPath(root), JSON.stringify(m, null, 2) + '\n', 'utf8')
}

/**
 * Create the corpus dir and return its REAL path, confined to the workspace. If
 * the dir (or a link on its path) resolves outside the workspace, refuse - so an
 * import can never write through a planted directory symlink. Returns null when
 * confinement fails.
 */
async function ensureCorpusDir(root: string): Promise<string | null> {
  const d = dir(root)
  await fs.mkdir(d, { recursive: true })
  try {
    const real = await fs.realpath(d)
    return fsService.withinWorkspace(real) ? real : null
  } catch {
    return null
  }
}

/**
 * Resolve a stored document to a path that is safe to read: a direct, regular
 * (non-symlink) file inside the corpus dir. The manifest is untrusted, so only
 * the basename is honored (any dir components / `..` / absolute part is dropped),
 * the final component must not be a symlink (lstat), and the corpus dir itself
 * must resolve inside the workspace. Returns null to skip anything that does not
 * meet all three.
 */
async function safeCorpusPath(root: string, storedName: string): Promise<string | null> {
  const base = basename(storedName)
  if (!base || base === '..' || base === '.') return null
  const abs = join(dir(root), base)
  try {
    const st = await fs.lstat(abs)
    if (!st.isFile() || st.isSymbolicLink()) return null // no symlink, no dir/special
    const realDir = await fs.realpath(dir(root))
    if (!fsService.withinWorkspace(realDir)) return null // corpus dir escaped the workspace
    return abs
  } catch {
    return null // missing (e.g. a manifest path that pointed outside the corpus)
  }
}

// In-memory cache, one workspace at a time (the panel and the agent both query
// the open project). Holds the BM25 index, the parsed docs, and the hardware
// graph used for query enrichment - so retrieval never re-walks the project on
// every chat message / doc search. Invalidated on import.
let cache: { root: string; index: DocIndex; docs: DatasheetDoc[]; graph: HardwareGraph | null } | null = null

/** Drop the cached index (call after any corpus change). */
export function invalidate(root?: string): void {
  if (!root || cache?.root === root) cache = null
}

/** The imported documents' metadata (no section bodies), for the panel list. */
export async function list(root: string): Promise<StoredDoc[]> {
  if (!root) return []
  return (await readManifest(root)).docs
}

/**
 * Import a user-chosen document. `srcPath` is an absolute path from the native
 * open dialog (main-process, user-authorized); it is read once, then copied into
 * the workspace corpus. Binary (e.g. PDF) and oversized files are refused with a
 * clear message - PDF extraction is a future adapter.
 */
export async function importFile(root: string, srcPath: string): Promise<DatasheetImportResult> {
  if (!root) return { ok: false, error: 'No workspace is open.' }
  if (!srcPath) return { ok: false, error: 'No file selected.' }
  let content: string
  try {
    const r = await fsService.readFile(srcPath)
    if (r.kind === 'binary') {
      return { ok: false, error: `${basename(srcPath)} is not a text document. Import markdown or plain-text datasheets (PDF support is coming).` }
    }
    if (r.kind === 'too-large') {
      return { ok: false, error: `${basename(srcPath)} is too large to import (${r.size} bytes).` }
    }
    content = r.content
  } catch (e) {
    return { ok: false, error: `Could not read the file: ${e instanceof Error ? e.message : String(e)}` }
  }

  const name = safeName(srcPath)
  const rel = relPath(name)
  const realDir = await ensureCorpusDir(root)
  if (!realDir) return { ok: false, error: 'Refused: the corpus directory resolves outside the workspace.' }
  const dest = join(realDir, name)
  try {
    // Refuse to write THROUGH a symlink planted at the destination name, which
    // would push the content to an attacker-chosen path outside the workspace.
    const existing = await fs.lstat(dest).catch(() => null)
    if (existing && existing.isSymbolicLink()) {
      return { ok: false, error: 'Refused: a symlink already occupies the destination name.' }
    }
    await fs.writeFile(dest, content, 'utf8')
  } catch (e) {
    return { ok: false, error: `Could not store the document: ${e instanceof Error ? e.message : String(e)}` }
  }

  const deviceKey = matchDeviceForDoc(name, KNOWN_DEVICES)
  const m = await readManifest(root)
  // Replace an existing entry with the same stored path (re-import overwrites).
  // The id is the (unique) stored name, so two source names that would slug to
  // the same value keep distinct ids (no duplicate React key / colliding docId).
  const docs = m.docs.filter((d) => d.path !== rel)
  docs.push({ id: name, name: basename(srcPath), path: rel, kind: kindOf(name), deviceKey })
  docs.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  await writeManifest(root, { docs })
  invalidate(root)
  return { ok: true, name: basename(srcPath), deviceKey }
}

/** Read the stored corpus, sectionize it, and build the BM25 index + the
 *  enrichment graph (all cached together, rebuilt only on invalidate). */
async function loadCorpus(root: string): Promise<{ index: DocIndex; docs: DatasheetDoc[]; graph: HardwareGraph | null }> {
  if (cache && cache.root === root) return cache
  const stored = (await readManifest(root)).docs
  const docs: DatasheetDoc[] = []
  for (const s of stored) {
    // Resolve to a real, non-symlink file inside the corpus dir; the manifest's
    // path is untrusted, so only its basename is honored (see safeCorpusPath).
    const abs = await safeCorpusPath(root, s.path)
    if (!abs) continue
    try {
      const r = await fsService.readFile(abs)
      if (r.kind !== 'text') continue
      // The citation path is recomputed from the trusted basename, never the raw
      // manifest path, so a citation always resolves inside the corpus dir.
      const base = basename(abs)
      docs.push({ id: s.id, name: s.name, path: relPath(base), deviceKey: s.deviceKey, sections: sectionize(r.content, s.kind) })
    } catch {
      /* skip a doc that vanished from disk */
    }
  }
  const index = buildIndex(docs)
  // Build the enrichment graph once, only when there is a corpus to search. This
  // keeps buildProjectModel (a full project scan) off the per-query hot path.
  let graph: HardwareGraph | null = null
  if (docs.length) {
    try {
      graph = buildHardwareGraph(await buildProjectModel(root))
    } catch {
      /* enrichment optional */
    }
  }
  cache = { root, index, docs, graph }
  return cache
}

/**
 * Retrieve the passages most relevant to `query`, enriched by the project's
 * hardware graph so a question about "the I2C sensor" biases toward the datasheet
 * of the part actually on the bus. Returns cited, verbatim passages ranked by
 * BM25. The enrichment graph is cached with the index, so retrieval never
 * re-walks the project per query.
 */
export async function search(root: string, query: string, k = 5): Promise<DatasheetHit[]> {
  if (!root || !query.trim()) return []
  const { index, graph } = await loadCorpus(root)
  if (index.n === 0) return []
  const extraTerms = graph ? enrichQueryFromGraph(graph, query).terms : []
  return queryIndex(index, query, k, extraTerms)
}
