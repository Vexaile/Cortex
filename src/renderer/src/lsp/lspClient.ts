import type * as monaco from 'monaco-editor'
import { LSP_LANGUAGE_ID, langForFile, pathToUri, uriToPath, type LspLang } from '@shared/lsp'
import { useStore } from '../store/useStore'
import pythonStdlib from '@shared/stdlib/python.json'
import cppStdlib from '@shared/stdlib/cpp.json'
import pythonSnippets from '@shared/stdlib/python-snippets.json'
import cppSnippets from '@shared/stdlib/cpp-snippets.json'

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
// Which doc + raw LSP item a given Monaco suggestion came from, so
// resolveCompletionItem (called with only the item, no model/position) knows
// what to ask completionItem/resolve for. Monaco reuses the same object
// instance between provide and resolve, so the object itself is a valid key.
const completionOrigin = new WeakMap<monaco.languages.CompletionItem, { doc: Doc; raw: LspCompletion }>()

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

// ---- supplemental stdlib dictionary -----------------------------------
// A hand-curated description/example/doc-link for symbols whose LSP-provided
// documentation is real but too bare to be useful (a lot of typeshed stubs
// carry a signature and no docstring at all - see docs/STDLIB-DICTIONARY-WORKFLOW.md
// for the ongoing curation process). This only ever ADDS to what the server
// already said; it never replaces or contradicts the server's own signature.
interface StdlibSymbol {
  signature?: string
  description: string
  example?: string
  since?: string | null
  docUrl?: string
}
interface StdlibLibrary {
  docUrl?: string
  since?: string | null
  symbols: Record<string, StdlibSymbol>
}
type StdlibFile = Record<string, StdlibLibrary>

const STDLIB_FILES: Partial<Record<LspLang, StdlibFile>> = {
  python: pythonStdlib as StdlibFile,
  cpp: cppStdlib as StdlibFile
}

const stdlibIndexCache = new Map<LspLang, Map<string, { entry: StdlibSymbol; libSince: string | null }>>()
function stdlibIndex(lang: LspLang): Map<string, { entry: StdlibSymbol; libSince: string | null }> {
  const cached = stdlibIndexCache.get(lang)
  if (cached) return cached
  const idx = new Map<string, { entry: StdlibSymbol; libSince: string | null }>()
  const file = STDLIB_FILES[lang]
  if (file) {
    for (const lib of Object.values(file)) {
      for (const [name, entry] of Object.entries(lib.symbols)) idx.set(name, { entry, libSince: lib.since ?? null })
    }
  }
  stdlibIndexCache.set(lang, idx)
  return idx
}

/**
 * Auto-add call parens to a bare completion, cursor landing inside them, the
 * way VS Code/Pylance/CLion all do. Bare pyright does NOT do this itself
 * (`completeFunctionParens` is a Pylance-only setting, confirmed absent from
 * pyright's own source - see LANG_SETTINGS's comment in lspService.ts), so
 * without this "print" only ever completed to "print", not "print()".
 * Covers Class/Constructor too, not just Function/Method: `str`, `int`,
 * `list` etc. are LSP-typed as Class but are exactly as call-shaped as any
 * function in normal use (`str(x)`), and a completion in a call-position
 * beats one in a type-annotation position often enough that the request was
 * explicitly for "ALL functions", parens included. Only skipped when the
 * server's own insertText already has "(" in it - that's a real arg-snippet
 * from clangd/rust-analyzer, not something to double up on.
 */
function withCallParens(
  m: Mon,
  kind: monaco.languages.CompletionItemKind,
  insertText: string,
  alreadySnippet: boolean
): { insertText: string; asSnippet: boolean } {
  const K = m.languages.CompletionItemKind
  const isCallable = kind === K.Function || kind === K.Method || kind === K.Class || kind === K.Constructor
  if (isCallable && !alreadySnippet && !insertText.includes('(')) {
    return { insertText: `${insertText}($0)`, asSnippet: true }
  }
  return { insertText, asSnippet: alreadySnippet }
}

// ---- supplemental template snippets ------------------------------------
// A language server proposes symbols that already exist; it has no opinion on
// boilerplate you're about to write (a class skeleton, a for loop). These are
// editor-level snippets in the same VS Code sense, keyed by construct name so
// typing "cla" prefix-matches "class" the same way it matches any other
// completion label.
interface StdlibSnippet {
  label: string
  description: string
  insertText: string
}
const SNIPPET_FILES: Partial<Record<LspLang, Record<string, StdlibSnippet>>> = {
  python: pythonSnippets as Record<string, StdlibSnippet>,
  cpp: cppSnippets as Record<string, StdlibSnippet>
}

function snippetSuggestions(m: Mon, lang: LspLang, range: monaco.IRange): monaco.languages.CompletionItem[] {
  const snippets = SNIPPET_FILES[lang]
  if (!snippets) return []
  return Object.values(snippets).map((s) => ({
    label: s.label,
    kind: m.languages.CompletionItemKind.Snippet,
    insertText: s.insertText,
    insertTextRules: m.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    detail: 'Snippet',
    documentation: { value: s.description },
    sortText: `zzz_${s.label}`, // real symbols first; a snippet is a fallback, not competing with a real completion
    range
  }))
}

/**
 * Prepend the dictionary's description/example/link ahead of whatever
 * documentation the server already produced (kept below a divider, not
 * discarded - the server's signature is authoritative for the exact
 * overload/types actually in scope, the dictionary is not).
 */
function enrichDocumentation(lang: LspLang, label: string, lspDoc: string): string {
  const found = stdlibIndex(lang).get(label)
  if (!found) return lspDoc
  const since = found.entry.since ?? found.libSince
  const sinceNote = lang === 'cpp' && since ? `_Since ${since}._\n\n` : ''
  const exampleBlock = found.entry.example
    ? `\n\n**Example**\n\`\`\`${lang === 'cpp' ? 'cpp' : lang}\n${found.entry.example}\n\`\`\``
    : ''
  const linkBlock = found.entry.docUrl ? `\n\n[Documentation](${found.entry.docUrl})` : ''
  const lspBlock = lspDoc.trim() ? `\n\n---\n${lspDoc}` : ''
  return `${sinceNote}${found.entry.description}${exampleBlock}${linkBlock}${lspBlock}`
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
          suggestions: items.slice(0, 200).map((it) => {
            const rawDoc = it.documentation ? contentsToMarkdown(it.documentation as LspContents) : ''
            const enriched = enrichDocumentation(lang, it.label, rawDoc)
            const kind = completionKind(m, it.kind)
            const baseInsert = it.insertText ?? it.textEdit?.newText ?? it.label
            const wasSnippet = it.insertTextFormat === 2
            const { insertText, asSnippet } = withCallParens(m, kind, baseInsert, wasSnippet)
            const suggestion: monaco.languages.CompletionItem = {
              label: it.label,
              kind,
              insertText,
              insertTextRules: asSnippet ? m.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
              detail: friendlyDetail(m, it, lang),
              documentation: enriched.trim() ? { value: enriched } : undefined,
              sortText: it.sortText,
              filterText: it.filterText,
              range
            }
            // Servers send full documentation lazily (resolveCompletionItem
            // below), not eagerly for every one of 200 items - stash what that
            // follow-up request needs to ask for THIS one.
            completionOrigin.set(suggestion, { doc, raw: it })
            return suggestion
          }).concat(snippetSuggestions(m, lang, range))
        }
      },
      async resolveCompletionItem(item, token) {
        const origin = completionOrigin.get(item)
        if (!origin) return item
        const resolved = await lspRequest<LspCompletion>(origin.doc, 'completionItem/resolve', origin.raw as object)
        if (token.isCancellationRequested) return item
        // A resolved item can bring a real detail/documentation the initial
        // list omitted, or confirm there simply isn't one - either way, don't
        // downgrade what provideCompletionItems already had (friendlyDetail's
        // "Variable in this file" is worth more than resolve's silence). The
        // dictionary lookup runs regardless of what resolve returned, so a
        // symbol with a real signature but zero prose (typeshed stubs are full
        // of these) still gets a description if one exists.
        const rawDoc = resolved?.documentation ? contentsToMarkdown(resolved.documentation as LspContents) : ''
        const enriched = enrichDocumentation(lang, origin.raw.label, rawDoc)
        if (enriched.trim()) item.documentation = { value: enriched }
        if (resolved?.detail) item.detail = friendlyDetail(m, { ...origin.raw, detail: resolved.detail }, lang)
        return item
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
        const raw = contentsToMarkdown(res.contents)
        // Hover has no item label the way completion does; the identifier
        // under the cursor is the equivalent lookup key.
        const word = model.getWordAtPosition(position)?.word
        const value = word ? enrichDocumentation(lang, word, raw) : raw
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
    // No `code`/`source` on the marker itself: Monaco's own hover renders those
    // as a trailing "source(code)" line (e.g. "lsp(undeclared_var_use)"), which
    // is compiler-internals noise on top of an already-plain-English message.
    const markers: monaco.editor.IMarkerData[] = (diagnostics as LspDiagnostic[]).map((d) => ({
      severity: severity(m, d.severity),
      message: d.message,
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: d.range.end.character + 1
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
  // Opaque correlation token for completionItem/resolve. Servers send back
  // richer detail/documentation for ONE item on demand rather than eagerly for
  // every item in a 200-deep list; `data` is what tells the server which one.
  data?: unknown
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
