import { promises as fs } from 'fs'
import type { SearchQuery, SearchResults, SearchFileResult, SearchMatch } from '../../shared/ipc'
import { listAllFiles, withinWorkspace } from './fsService'

/**
 * Node-based content search across the open workspace (no external ripgrep
 * dependency, so it works in a packaged app). Bounded on every axis so a huge
 * or pathological tree cannot hang the main process.
 */

const MAX_FILES = 4000
const MAX_FILE_BYTES = 2 * 1024 * 1024 // skip anything bigger; likely generated/binary
const MAX_MATCHES = 2000
const MAX_PER_FILE = 200
const MAX_PREVIEW = 240
// Wall-clock budget. A user regex can backtrack pathologically; bounding total
// time keeps a bad pattern from wedging the main process indefinitely.
const DEADLINE_MS = 3000
// In regex mode, do not feed very long lines to a backtracking matcher.
const MAX_REGEX_LINE = 2000
const NUL = String.fromCharCode(0)

// Extensions worth searching. Everything else (images, binaries, archives) is
// skipped up front so we do not read and scan megabytes of noise.
const TEXT_EXT = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.c++', '.h', '.hpp', '.hh', '.hxx', '.ino', '.pde',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.java', '.cs',
  '.lua', '.rb', '.php', '.swift', '.kt', '.sh', '.bat', '.ps1',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.properties',
  '.md', '.markdown', '.txt', '.rst', '.csv', '.tsv', '.log',
  '.html', '.htm', '.css', '.scss', '.less', '.xml', '.svg',
  '.cmake', '.mk', '.gitignore', '.clangd', '.env'
])

function ext(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name.toLowerCase() : name.slice(dot).toLowerCase()
}

function buildRegExp(q: SearchQuery): RegExp | null {
  let source = q.regex ? q.query : q.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (q.wholeWord) source = `\\b${source}\\b`
  const flags = 'g' + (q.caseSensitive ? '' : 'i')
  try {
    return new RegExp(source, flags)
  } catch {
    return null // invalid user regex; caller reports empty results
  }
}

export async function searchInFiles(q: SearchQuery): Promise<SearchResults> {
  const empty: SearchResults = { files: [], total: 0, truncated: false }
  if (!q.query || !q.root || !withinWorkspace(q.root)) return empty
  const re = buildRegExp(q)
  if (!re) return empty

  const paths = await listAllFiles(q.root, MAX_FILES)
  const files: SearchFileResult[] = []
  let total = 0
  let truncated = paths.length >= MAX_FILES
  const deadline = Date.now() + DEADLINE_MS

  for (const path of paths) {
    if (total >= MAX_MATCHES || Date.now() > deadline) {
      truncated = true
      break
    }
    if (!TEXT_EXT.has(ext(path))) continue
    let stat: import('fs').Stats
    try {
      stat = await fs.stat(path)
    } catch {
      continue
    }
    if (stat.size > MAX_FILE_BYTES) continue

    let content: string
    try {
      content = await fs.readFile(path, 'utf8')
    } catch {
      continue
    }
    if (content.includes(NUL)) continue // binary

    const matches: SearchMatch[] = []
    const lines = content.split('\n')
    for (let i = 0; i < lines.length && matches.length < MAX_PER_FILE; i++) {
      if (Date.now() > deadline) {
        truncated = true
        break
      }
      const raw = lines[i].replace(/\r$/, '')
      // A very long line is where catastrophic backtracking bites; skip it in
      // regex mode rather than feed it to the matcher.
      if (q.regex && raw.length > MAX_REGEX_LINE) continue
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(raw)) !== null) {
        // Trim long lines around the match so the preview stays readable.
        const start = Math.max(0, m.index - 40)
        const preview = raw.slice(start, start + MAX_PREVIEW)
        matches.push({
          line: i + 1,
          column: m.index + 1,
          preview,
          matchStart: m.index - start,
          matchEnd: m.index - start + (m[0].length || 1)
        })
        total++
        if (m.index === re.lastIndex) re.lastIndex++ // guard zero-width matches
        if (matches.length >= MAX_PER_FILE || total >= MAX_MATCHES) break
      }
    }
    if (matches.length > 0) files.push({ path, matches })
  }

  return { files, total, truncated }
}
