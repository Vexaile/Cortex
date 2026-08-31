import type * as monaco from 'monaco-editor'
import { LSP_LANGUAGE_ID, langForFile, pathToUri, uriToPath, type LspLang } from '@shared/lsp'
import { useStore } from '../store/useStore'

/**
 * Stable key for a document, independent of how a URI was encoded or cased.
 * Servers echo back a URI they re-canonicalized (RFC 3986 percent-encoding,
 * Windows drive-letter case), which need not match `pathToUri`'s output byte
 * for byte. Comparing decoded paths (with a lowercased drive on Windows)
 * instead means a diagnostics batch is never dropped over cosmetic drift.
 */
function docKey(uriOrPath: string): string {
  let p = uriToPath(uriOrPath.startsWith('file:') ? uriOrPath : pathToUri(uriOrPath)).replace(/\\/g, '/')
  // Fold only the drive letter (case-insensitive on Windows); the rest of the
  // path keeps its case, which matters on case-sensitive filesystems.
  if (/^[a-zA-Z]:/.test(p)) p = p[0].toLowerCase() + p.slice(1)
  return p
}

/**
 * Bridges Monaco to the language servers running in the main process. Registers
 * completion / hover / definition / signature-help providers, syncs the open
 * document (didOpen/didChange/didClose), and turns pushed diagnostics into
 * Monaco markers.
 *
 * Cortex shows one editor at a time, but providers still resolve their context
 * by model, so nothing breaks if that changes. A language with no installed
 * server is skipped, so the editor simply has no IntelliSense rather than
 * erroring.
 */

interface Doc {
  path: string
  root: string
  uri: string
  lang: LspLang
  version: number
}

type Mon = typeof monaco

const docsByModel = new Map<monaco.editor.ITextModel, Doc>()
const docsByUri = new Map<string, { model: monaco.editor.ITextModel; doc: Doc }>()
const changeTimers = new Map<string, ReturnType<typeof setTimeout>>()
// Latest text awaiting a debounced didChange, so a request can flush it first.
const pendingContent = new Map<string, string>()

let available: Record<LspLang, boolean> = { cpp: false, python: false, rust: false }
let monacoRef: Mon | null = null

const toLspPos = (p: monaco.IPosition): { line: number; character: number } => ({
  line: p.lineNumber - 1,
  character: p.column - 1
})

interface LspRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}
const toMonacoRange = (r: LspRange): monaco.IRange => ({
  startLineNumber: r.start.line + 1,
  startColumn: r.start.character + 1,
  endLineNumber: r.end.line + 1,
  endColumn: r.end.character + 1
})

/** LSP CompletionItemKind (1-25) -> Monaco CompletionItemKind. */
function completionKind(m: Mon, k: number | undefined): monaco.languages.CompletionItemKind {
  const K = m.languages.CompletionItemKind
  const map: Record<number, monaco.languages.CompletionItemKind> = {
    1: K.Text, 2: K.Method, 3: K.Function, 4: K.Constructor, 5: K.Field, 6: K.Variable,
    7: K.Class, 8: K.Interface, 9: K.Module, 10: K.Property, 11: K.Unit, 12: K.Value,
    13: K.Enum, 14: K.Keyword, 15: K.Snippet, 16: K.Color, 17: K.File, 18: K.Reference,
    19: K.Folder, 20: K.EnumMember, 21: K.Constant, 22: K.Struct, 23: K.Event,
    24: K.Operator, 25: K.TypeParameter
  }
  return (k && map[k]) ?? K.Text
}

type LspContents = string | { kind?: string; value: string } | Array<string | { language?: string; value: string }>
function contentsToMarkdown(c: LspContents): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x.value ? '```\n' + x.value + '\n```' : '')).join('\n\n')
  return c.value ?? ''
}

const LANG_LABEL: Record<LspLang, string> = { cpp: 'C++', python: 'Python', rust: 'Rust' }
// A real signal a symbol comes from the language's own standard library, not a
// guess: clangd's completion `detail` for a std:: symbol names the namespace in
// the signature, and pyright's `documentation` for a builtin/stdlib symbol
// names the defining module. Deliberately narrow (word-boundary matches on
// well-known module names) rather than broad, so this stays a claim backed by
// the server's own text instead of a label slapped on everything.
const STD_LIB_HINT: Record<LspLang, RegExp> = {
  cpp: /\b(?:std|__gnu_cxx)::/,
  python: /\b(?:builtins|typing|collections|itertools|functools|json|re|math|random|datetime|pathlib|io|os|sys|string|enum|dataclasses)\b/,
  rust: /\bstd::/
}

/**
 * Monaco renders `detail` right-aligned on the suggestion row (VS Code's
 * IntelliSense look this is matching). Raw LSP detail is often just a type
 * ("int") or a full signature, or nothing at all for a pyright local - none of
 * which tells a user WHERE something comes from at a glance. This adds that
 * without inventing information the server didn't provide.
 */
function friendlyDetail(m: Mon, it: LspCompletion, lang: LspLang): string | undefined {
  const K = m.languages.CompletionItemKind
  const kind = completionKind(m, it.kind)
  if (kind === K.Variable || kind === K.Field || kind === K.Property) {
    return it.detail ? `Variable · ${it.detail}` : 'Variable in this file'
  }
  if (kind === K.Constant) return it.detail ? `Constant · ${it.detail}` : 'Constant in this file'
  if (kind === K.Function || kind === K.Method || kind === K.Class || kind === K.Module) {
    const doc = it.documentation ? contentsToMarkdown(it.documentation as LspContents) : ''
    const haystack = `${it.label} ${it.detail ?? ''} ${doc}`
    if (STD_LIB_HINT[lang].test(haystack)) return `${LANG_LABEL[lang]} standard library`
  }
  return it.detail
}

/** Send any debounced edit for a doc immediately, so a following request sees
 * the current buffer rather than the version clangd last heard about. */
function flushChange(doc: Doc): void {
  const content = pendingContent.get(doc.uri)
  if (content === undefined) return
  pendingContent.delete(doc.uri)
  const t = changeTimers.get(doc.uri)
  if (t) {
    clearTimeout(t)
    changeTimers.delete(doc.uri)
  }
  doc.version += 1
  void window.api.lspNotify({
    lang: doc.lang,
    root: doc.root,
    method: 'textDocument/didChange',
    params: { textDocument: { uri: doc.uri, version: doc.version }, contentChanges: [{ text: content }] }
  })
}

async function lspRequest<T = unknown>(doc: Doc, method: string, params: object): Promise<T | null> {
  if (!available[doc.lang]) return null
  flushChange(doc) // the server must see edits before it answers about them
  const res = await window.api.lspRequest({ lang: doc.lang, root: doc.root, method, params })
  return (res as T) ?? null
}

// Which Monaco language ids each server answers for. Monaco registers `c` and
// `cpp` as SEPARATE ids, so registering only 'cpp' left every .c file with a
// green clangd badge and working squiggles but dead completion/hover/F12.
const REGISTRATIONS: Array<[LspLang, string]> = [
  ['cpp', 'cpp'],
  ['cpp', 'c'],
  ['python', 'python'],
  ['rust', 'rust']
]

function registerProviders(m: Mon): void {
  for (const [lang, id] of REGISTRATIONS) {
    m.languages.registerCompletionItemProvider(id, {
      triggerCharacters: ['.', '>', ':', '<', '"', '/', '*'],
      async provideCompletionItems(model, position, _context, token) {
        const doc = docsByModel.get(model)
        if (!doc) return { suggestions: [] }
        const res = await lspRequest<{ items?: LspCompletion[] } | LspCompletion[]>(doc, 'textDocument/completion', {
          textDocument: { uri: doc.uri },
          position: toLspPos(position)
        })
        if (token.isCancellationRequested) return { suggestions: [] }
        const items = Array.isArray(res) ? res : (res?.items ?? [])
        const word = model.getWordUntilPosition(position)
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        }
        return {
          suggestions: items.slice(0, 200).map((it) => ({
            label: it.label,
            kind: completionKind(m, it.kind),
            insertText: it.insertText ?? it.textEdit?.newText ?? it.label,
            insertTextRules: it.insertTextFormat === 2 ? m.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            detail: friendlyDetail(m, it, lang),
            documentation: it.documentation ? { value: contentsToMarkdown(it.documentation as LspContents) } : undefined,
            sortText: it.sortText,
            filterText: it.filterText,
            range
          }))
        }
      }
    })

    m.languages.registerHoverProvider(id, {
      async provideHover(model, position, token) {
        const doc = docsByModel.get(model)
        if (!doc) return null
        const res = await lspRequest<{ contents: LspContents; range?: LspRange }>(doc, 'textDocument/hover', {
          textDocument: { uri: doc.uri },
          position: toLspPos(position)
        })
        if (token.isCancellationRequested || !res?.contents) return null
        const value = contentsToMarkdown(res.contents)
        if (!value.trim()) return null
        return { contents: [{ value }], range: res.range ? toMonacoRange(res.range) : undefined }
      }
    })

    m.languages.registerDefinitionProvider(id, {
      async provideDefinition(model, position, token) {
        const doc = docsByModel.get(model)
        if (!doc) return null
        const res = await lspRequest<LspLocation | LspLocation[] | LspLocationLink[]>(doc, 'textDocument/definition', {
          textDocument: { uri: doc.uri },
          position: toLspPos(position)
        })
        if (token.isCancellationRequested) return null
        const arr = Array.isArray(res) ? res : res ? [res] : []
        return arr.map((l) => {
          const uri = 'uri' in l ? l.uri : l.targetUri
          const range = 'range' in l ? l.range : l.targetSelectionRange
          return { uri: m.Uri.parse(uri), range: toMonacoRange(range) }
        })
      }
    })

    m.languages.registerSignatureHelpProvider(id, {
      signatureHelpTriggerCharacters: ['(', ','],
      async provideSignatureHelp(model, position, token) {
        const doc = docsByModel.get(model)
        if (!doc) return null
        const res = await lspRequest<LspSignatureHelp>(doc, 'textDocument/signatureHelp', {
          textDocument: { uri: doc.uri },
          position: toLspPos(position)
        })
        if (token.isCancellationRequested || !res?.signatures?.length) return null
        return {
          value: {
            signatures: res.signatures.map((s) => ({
              label: s.label,
              documentation: s.documentation ? { value: contentsToMarkdown(s.documentation as LspContents) } : undefined,
              parameters: (s.parameters ?? []).map((p) => ({
                label: p.label,
                documentation: p.documentation ? { value: contentsToMarkdown(p.documentation as LspContents) } : undefined
              }))
            })),
            activeSignature: res.activeSignature ?? 0,
            activeParameter: res.activeParameter ?? 0
          },
          dispose: () => {}
        }
      }
    })
  }
}

function severity(m: Mon, s: number | undefined): monaco.MarkerSeverity {
  const S = m.MarkerSeverity
  return s === 1 ? S.Error : s === 2 ? S.Warning : s === 4 ? S.Hint : S.Info
}

/**
 * Call with the Monaco instance. Idempotent, and safe to call concurrently: the
 * promise is memoized, so a second caller awaits the SAME initialisation rather
 * than racing past a boolean that was set before `available` was populated
 * (which left that document permanently without a server).
 */
let initPromise: Promise<void> | null = null
export function initLsp(m: Mon): Promise<void> {
  if (!initPromise) initPromise = doInitLsp(m)
  return initPromise
}

async function doInitLsp(m: Mon): Promise<void> {
  monacoRef = m
  available = (await window.api.lspServers().catch(() => ({ cpp: false, python: false, rust: false }))) as Record<LspLang, boolean>
  // Surface availability to the status bar (read outside React via the store).
  useStore.getState().setLspServers({ ...available })
  registerProviders(m)

  // Read-only introspection for diagnostics/support: which servers are live and
  // which documents are open. No behaviour depends on it.
  ;(window as unknown as { __cortexLsp?: unknown }).__cortexLsp = {
    available: (): Record<LspLang, boolean> => ({ ...available }),
    openDocs: (): string[] => [...docsByUri.keys()]
  }

  window.api.onLspDiagnostics(({ uri, diagnostics }) => {
    const entry = docsByUri.get(docKey(uri))
    if (!entry || entry.model.isDisposed()) return
    const markers: monaco.editor.IMarkerData[] = (diagnostics as LspDiagnostic[]).map((d) => ({
      severity: severity(m, d.severity),
      message: d.source ? `${d.message} (${d.source})` : d.message,
      code: typeof d.code === 'object' ? String(d.code.value) : d.code != null ? String(d.code) : undefined,
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      source: 'lsp'
    }))
    try {
      m.editor.setModelMarkers(entry.model, 'lsp', markers)
    } catch {
      /* model disposed mid-update */
    }
  })

  // A server that died is respawned lazily on the next request, but that fresh
  // process has never heard of the documents this renderer already opened. Replay
  // didOpen (with the current buffer) for every open doc of the dead server so
  // completion/hover/diagnostics keep working instead of going silently dead.
  window.api.onLspBusy(({ lang, busy }) => {
    useStore.getState().setLspBusy(lang, busy)
  })

  window.api.onLspServerExit(({ lang, root, givenUp }) => {
    // Main gave up restarting this server (it crashed repeatedly). Replaying
    // didOpen is what respawns it, so replaying now would restart the loop main
    // just broke. Report it as off instead of leaving a green badge over an
    // IntelliSense that will never answer.
    if (givenUp) {
      useStore.getState().setLspServers({ ...useStore.getState().lspServers, [lang]: false })
      // Retract this server's squiggles as well. Diagnostics are only ever
      // cleared by a server publishing an empty set, and there is no server left
      // to do it: every marker it had published would otherwise stay frozen on
      // screen for the rest of the session, including on lines the user has
      // since fixed.
      for (const [model, doc] of docsByModel) {
        if (doc.lang !== lang || doc.root !== root || model.isDisposed()) continue
        monacoRef?.editor.setModelMarkers(model, 'lsp', [])
      }
      return
    }
    for (const [model, doc] of docsByModel) {
      if (doc.lang !== lang || doc.root !== root || model.isDisposed()) continue
      doc.version += 1
      pendingContent.delete(doc.uri)
      void window.api.lspNotify({
        lang,
        root,
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: doc.uri,
            languageId: LSP_LANGUAGE_ID[lang],
            version: doc.version,
            text: model.getValue()
          }
        }
      })
    }
  })
}

/** Open (or re-open) a document for the given file, if a server handles it. */
export function openDoc(path: string, root: string, model: monaco.editor.ITextModel, content: string): void {
  const lang = langForFile(path)
  if (!lang || !available[lang] || !root) return
  const uri = pathToUri(path)
  const doc: Doc = { path, root, uri, lang, version: 1 }
  docsByModel.set(model, doc)
  docsByUri.set(docKey(uri), { model, doc })
  void window.api.lspNotify({
    lang,
    root,
    method: 'textDocument/didOpen',
    params: { textDocument: { uri, languageId: LSP_LANGUAGE_ID[lang], version: 1, text: content } }
  })
}

/** Full-document change, debounced (clangd advertises full sync; simplest correct).
 * A pending edit can be flushed early by flushChange when a request needs it. */
export function changeDoc(model: monaco.editor.ITextModel, content: string): void {
  const doc = docsByModel.get(model)
  if (!doc) return
  pendingContent.set(doc.uri, content)
  const prev = changeTimers.get(doc.uri)
  if (prev) clearTimeout(prev)
  changeTimers.set(doc.uri, setTimeout(() => flushChange(doc), 300))
}

export function closeDoc(model: monaco.editor.ITextModel): void {
  const doc = docsByModel.get(model)
  if (!doc) return
  const t = changeTimers.get(doc.uri)
  if (t) clearTimeout(t)
  changeTimers.delete(doc.uri)
  pendingContent.delete(doc.uri)
  docsByModel.delete(model)
  docsByUri.delete(docKey(doc.uri))
  void window.api.lspNotify({
    lang: doc.lang,
    root: doc.root,
    method: 'textDocument/didClose',
    params: { textDocument: { uri: doc.uri } }
  })
  if (monacoRef && !model.isDisposed()) monacoRef.editor.setModelMarkers(model, 'lsp', [])
}

// ---- LSP payload shapes we read ------------------------------------------

interface LspCompletion {
  label: string
  kind?: number
  insertText?: string
  insertTextFormat?: number
  textEdit?: { newText: string }
  detail?: string
  documentation?: unknown
  sortText?: string
  filterText?: string
}
interface LspLocation {
  uri: string
  range: LspRange
}
interface LspLocationLink {
  targetUri: string
  targetSelectionRange: LspRange
}
interface LspSignatureHelp {
  signatures: Array<{
    label: string
    documentation?: unknown
    parameters?: Array<{ label: string | [number, number]; documentation?: unknown }>
  }>
  activeSignature?: number
  activeParameter?: number
}
interface LspDiagnostic {
  range: LspRange
  message: string
  severity?: number
  source?: string
  code?: string | number | { value: string | number }
}
