/**
 * Language Server Protocol wire format + config. Pure and dependency-free
 * (TextEncoder/TextDecoder, not Buffer), so it runs in the main process and is
 * unit-testable in the node test env, and can be imported by the renderer for
 * types without pulling a Node polyfill.
 *
 * The main-process lspService uses the codec to talk to clangd / pyright /
 * rust-analyzer over stdio; the renderer uses the types and helpers.
 */

export type LspLang = 'cpp' | 'python' | 'rust'

/** A request or notification the renderer sends to a language server. */
export interface LspCall {
  lang: LspLang
  root: string
  method: string
  params: unknown
}

/** Diagnostics pushed from a server to the renderer (main -> renderer). */
export interface LspDiagnosticsPush {
  uri: string
  diagnostics: unknown[]
}

/** A server is loading/indexing and cannot answer usefully yet. */
export interface LspBusy {
  lang: LspLang
  busy: boolean
  title?: string
}

/** Notice that a language server died, so the renderer can replay didOpen for
 * its documents against the respawned process (main -> renderer). */
export interface LspServerExit {
  lang: LspLang
  root: string
  /** Set when main has stopped restarting this server (it kept crashing). The
   *  renderer must NOT replay didOpen then: the replay is what respawns it. */
  givenUp?: boolean
}

/** Which languages have a server installed. */
export type LspAvailability = Record<LspLang, boolean>

/** The stdio server for each language. Availability is checked at spawn time. */
export const LSP_SERVERS: Record<LspLang, { cmd: string; args: string[] }> = {
  // clang-tidy off by default: it is noisy without a project config and slows
  // the first response, which is the one a user judges the feature by.
  cpp: { cmd: 'clangd', args: ['--background-index', '--clang-tidy=false', '--limit-results=50'] },
  python: { cmd: 'pyright-langserver', args: ['--stdio'] },
  rust: { cmd: 'rust-analyzer', args: [] }
}

/** Monaco/LSP languageId for each server language. */
export const LSP_LANGUAGE_ID: Record<LspLang, string> = { cpp: 'cpp', python: 'python', rust: 'rust' }

/** Human name of each server, for the status bar and install hints. */
export const LSP_SERVER_LABEL: Record<LspLang, string> = {
  cpp: 'clangd',
  python: 'Pyright',
  rust: 'rust-analyzer'
}

/**
 * What "indexing" actually means per server, because it differs and the
 * difference matters. rust-analyzer returns EMPTY results while it loads the
 * Cargo workspace. clangd keeps answering completion/hover for the open file
 * from its preamble the whole time it background-indexes; only cross-file
 * search is incomplete. Telling a C++ user "completion stays empty" would be
 * plainly false.
 */
export const LSP_BUSY_HINT: Record<LspLang, string> = {
  cpp: 'clangd is building its background index. Completion and hover in this file work now; cross-file search gets better when it finishes.',
  python: 'Pyright is analysing the project. Results may be incomplete until it finishes.',
  rust: 'rust-analyzer is loading this project. Completion and hover stay empty until it finishes.'
}

/** How to actually get each server. "Install it" with no command leaves the
 * user to go and find out how, which is the thing this product exists to fix. */
export const LSP_INSTALL_HINT: Record<LspLang, string> = {
  cpp: 'clangd ships with LLVM: winget install LLVM.LLVM (or apt install clangd).',
  python: 'npm install -g pyright',
  rust: 'rustup component add rust-analyzer'
}

/** Exported so a test can assert it never drifts from the language table in
 * shared/languages.ts (they had diverged, leaving .hxx/.c++ as "Text" files
 * with clangd squiggles painted on top). */
export const CPP_EXT = new Set(['.c', '.cc', '.cpp', '.cxx', '.c++', '.h', '.hpp', '.hh', '.hxx'])

/**
 * Which server (if any) handles a file. `.ino` is deliberately excluded: clangd
 * treats it as C++ but cannot find the Arduino core without a compile database,
 * so it would flood every sketch with "Arduino.h not found". The Simulator
 * already covers `.ino`.
 */
export function langForFile(path: string): LspLang | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  const ext = path.slice(dot).toLowerCase()
  if (CPP_EXT.has(ext)) return 'cpp'
  // .pyw is a declared Python extension too; omitting it silently denied those
  // files a server while the status bar still advertised one.
  if (ext === '.py' || ext === '.pyw') return 'python'
  if (ext === '.rs') return 'rust'
  return null
}

/** OS path -> file URI. clangd on Windows wants file:///C:/dir/file.cpp. */
export function pathToUri(p: string): string {
  let path = p.replace(/\\/g, '/')
  if (!path.startsWith('/')) path = '/' + path // C:/x -> /C:/x
  // Encode each segment but keep the slashes and the drive colon.
  return (
    'file://' +
    path
      .split('/')
      .map((seg) => encodeURIComponent(seg).replace(/%3A/gi, ':'))
      .join('/')
  )
}

/** file URI -> OS path. Inverse of pathToUri. */
export function uriToPath(uri: string): string {
  let p = uri.replace(/^file:\/\//, '')
  p = decodeURIComponent(p)
  if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1) // /C:/x -> C:/x
  return p
}

// ---- wire codec (Content-Length framed JSON-RPC) --------------------------

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Frame a JSON-RPC message: `Content-Length: N\r\n\r\n<json>` as UTF-8 bytes. */
export function encodeMessage(msg: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(msg))
  const header = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`)
  const out = new Uint8Array(header.length + body.length)
  out.set(header)
  out.set(body, header.length)
  return out
}

const CRLFCRLF = [13, 10, 13, 10]

function indexOfHeaderEnd(buf: Uint8Array): number {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === CRLFCRLF[0] && buf[i + 1] === CRLFCRLF[1] && buf[i + 2] === CRLFCRLF[2] && buf[i + 3] === CRLFCRLF[3]) {
      return i
    }
  }
  return -1
}

/**
 * Reassembles framed messages from a byte stream. Server output arrives in
 * arbitrary chunks (a header split from its body, two messages in one chunk),
 * so parsing is byte-accurate: Content-Length counts bytes, not characters.
 */
export class MessageBuffer {
  private buf = new Uint8Array(0)
  private contentLength = -1

  append(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buf.length + chunk.length)
    merged.set(this.buf)
    merged.set(chunk, this.buf.length)
    this.buf = merged
  }

  /** The next complete message, or null if one is not fully buffered yet. */
  next(): unknown | null {
    if (this.contentLength < 0) {
      const end = indexOfHeaderEnd(this.buf)
      if (end < 0) return null
      const header = decoder.decode(this.buf.subarray(0, end))
      const m = header.match(/content-length:\s*(\d+)/i)
      this.contentLength = m ? parseInt(m[1], 10) : 0
      this.buf = this.buf.subarray(end + 4)
    }
    if (this.buf.length < this.contentLength) return null
    const body = this.buf.subarray(0, this.contentLength)
    this.buf = this.buf.subarray(this.contentLength)
    this.contentLength = -1
    try {
      return JSON.parse(decoder.decode(body))
    } catch {
      return null
    }
  }

  /** Drop any buffered bytes and partial-frame state. Called when a server dies
   * so a leftover half-frame is not spliced onto the next process's output. */
  reset(): void {
    this.buf = new Uint8Array(0)
    this.contentLength = -1
  }
}
