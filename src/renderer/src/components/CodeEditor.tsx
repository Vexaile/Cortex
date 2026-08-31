import { useEffect, useRef, useState } from 'react'
import Editor, { loader } from '@monaco-editor/react'
// The editor API only. The 'monaco-editor' barrel registers every language
// Monaco ships (~80 of them: Solidity, Apex, FreeMarker, ABAP...), which is how
// an embedded IDE that supports nine languages came to emit 91 chunks and 24MB.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
// editor.api is the core editor + types ONLY - no editor contributions. Without
// this, hover (ours AND Monaco's own marker/diagnostic tooltip), find/replace,
// folding, multi-cursor, rename, parameter hints, and most of what makes Monaco
// feel like an editor rather than a textarea are simply never registered, since
// their controllers live here, not in editor.api. This is core editor UX, not
// per-language weight (that's the basic-languages imports below and the
// language *workers* under vs/language/*, which this still correctly skips).
import 'monaco-editor/esm/vs/editor/editor.all'
// Exactly the languages shared/languages.ts claims. Adding one there means
// adding its contribution here, or the file opens with no highlighting.
// zig and plaintext have no Monaco grammar to import.
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution'
import 'monaco-editor/esm/vs/basic-languages/lua/lua.contribution'
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'
// Ancillary files: an embedded project is not only firmware. README.md, CI
// yaml, .ini board configs, .xml manifests, linker scripts and shell helpers
// all sit in the tree and used to open as flat plaintext.
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution'
import 'monaco-editor/esm/vs/basic-languages/ini/ini.contribution'
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution'
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { useStore } from '../store/useStore'
import { initLsp, openDoc, changeDoc, closeDoc } from '../lsp/lspClient'
import { registerZig, registerJson } from '../monaco/zig'

// Bundle Monaco locally (no CDN) so it works under a strict CSP.
// One worker: the json/css/html/ts language services are IntelliSense for
// languages this IDE does not build, and ts.worker alone was 11.5MB. The
// basic-languages contributions above are tokenizers and need no worker.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(self as any).MonacoEnvironment = {
  getWorker: () => new editorWorker()
}
loader.config({ monaco })

let themeDefined = false
function defineTheme(m: typeof monaco): void {
  if (themeDefined) return
  // Cortex Dark: amber keywords/numbers (Arduino warmth), moss strings, teal
  // types, violet macros/registers. See docs/THEME.md.
  m.editor.defineTheme('cortex-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      // Matches ide.faint. The old 5B6675 measured 3.29:1 on the editor bg and
      // failed AA; the token was raised but this literal was missed.
      { token: 'comment', foreground: '7D8899', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'E8952B' },
      { token: 'keyword.directive', foreground: 'C58BE6' },
      { token: 'keyword.directive.include', foreground: 'C58BE6' },
      { token: 'number', foreground: 'E8B44A' },
      { token: 'number.hex', foreground: 'E8B44A' },
      { token: 'string', foreground: '8FBF6B' },
      { token: 'string.escape', foreground: '4FB8A8' },
      { token: 'type', foreground: '4FB8A8' },
      { token: 'type.identifier', foreground: '4FB8A8' },
      { token: 'identifier', foreground: 'E6EBF4' },
      { token: 'function', foreground: '5B9DF0' },
      { token: 'macro', foreground: 'C58BE6' },
      { token: 'operator', foreground: '98A3B6' },
      { token: 'delimiter', foreground: '98A3B6' },
      { token: 'variable', foreground: 'E6EBF4' },
      { token: 'variable.predefined', foreground: 'C58BE6' }
    ],
    colors: {
      'editor.background': '#0C1017',
      'editor.foreground': '#E6EBF4',
      'editor.lineHighlightBackground': '#11161F',
      'editorLineNumber.foreground': '#3A4557',
      'editorLineNumber.activeForeground': '#98A3B6',
      'editorGutter.background': '#0C1017',
      'editorCursor.foreground': '#2E6FE0',
      'editorIndentGuide.background1': '#1B2230',
      'editorIndentGuide.activeBackground1': '#2E6FE0',
      'editor.selectionBackground': '#1E3A5F',
      'editor.selectionHighlightBackground': '#1E3A5F66',
      'editorBracketMatch.background': '#2E6FE033',
      'editorBracketMatch.border': '#2E6FE0',
      'editorWidget.background': '#171D28',
      'editorHoverWidget.background': '#171D28',
      'editorSuggestWidget.background': '#171D28',
      'editorWhitespace.foreground': '#232B38'
    }
  })
  themeDefined = true
}

const norm = (p: string): string => p.toLowerCase().replace(/\\/g, '/')

export default function CodeEditor({ path }: { path: string }): JSX.Element {
  const tabs = useStore((s) => s.tabs)
  const updateContent = useStore((s) => s.updateContent)
  const runActive = useStore((s) => s.runActive)
  const saveActive = useStore((s) => s.saveActive)
  const diagnostics = useStore((s) => s.diagnostics)
  const reveal = useStore((s) => s.reveal)
  const clearReveal = useStore((s) => s.clearReveal)
  const workspaceRoot = useStore((s) => s.workspaceRoot)
  const breakpoints = useStore((s) => s.breakpoints)
  const debug = useStore((s) => s.debug)
  const toggleBreakpoint = useStore((s) => s.toggleBreakpoint)

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof monaco | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const decoRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  // Bumped in onMount so the effects below re-run once Monaco is actually ready
  // (onMount is async and fires after the initial render's effects).
  const [mountNonce, setMountNonce] = useState(0)
  const tab = tabs.find((t) => t.path === path)

  // Sync compiler diagnostics for THIS file into Monaco as inline markers.
  useEffect(() => {
    const editor = editorRef.current
    const m = monacoRef.current
    const model = editor?.getModel()
    if (!editor || !m || !model || model.isDisposed()) return
    const mine = diagnostics.filter((d) => norm(d.file) === norm(path))
    const markers: monaco.editor.IMarkerData[] = mine.map((d) => ({
      severity:
        d.severity === 'error'
          ? m.MarkerSeverity.Error
          : d.severity === 'warning'
            ? m.MarkerSeverity.Warning
            : m.MarkerSeverity.Info,
      message: d.code ? `${d.message} [${d.code}]` : d.message,
      startLineNumber: d.line,
      startColumn: d.column,
      endLineNumber: d.line,
      endColumn: d.column + 1,
      source: 'cortex'
    }))
    try {
      m.editor.setModelMarkers(model, 'cortex', markers)
    } catch {
      /* model disposed mid-switch */
    }
  }, [diagnostics, path, mountNonce])

  // Breakpoint dots in the glyph margin + the current debug line, kept in sync
  // with the store.
  useEffect(() => {
    const editor = editorRef.current
    const m = monacoRef.current
    const model = editor?.getModel()
    if (!editor || !m || !model || model.isDisposed()) return
    const decos: monaco.editor.IModelDeltaDecoration[] = []
    for (const line of breakpoints[path] ?? []) {
      decos.push({
        range: new m.Range(line, 1, line, 1),
        options: {
          glyphMarginClassName: 'cortex-bp',
          glyphMarginHoverMessage: { value: 'Breakpoint' },
          stickiness: m.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      })
    }
    const onLine =
      debug.status === 'stopped' && debug.currentLine && debug.currentFile && norm(debug.currentFile) === norm(path)
        ? debug.currentLine
        : null
    if (onLine) {
      decos.push({
        range: new m.Range(onLine, 1, onLine, 1),
        options: { isWholeLine: true, className: 'cortex-debug-line', glyphMarginClassName: 'cortex-debug-arrow' }
      })
    }
    if (!decoRef.current) decoRef.current = editor.createDecorationsCollection()
    decoRef.current.set(decos)
  }, [breakpoints, debug, path, mountNonce])

  // Tell the language server the document is closing when this editor unmounts
  // (a file switch remounts via key={path}), so the server drops it and its
  // markers clear.
  useEffect(() => {
    return () => {
      const model = modelRef.current
      if (model) closeDoc(model)
    }
  }, [])

  // Jump to a location when the Problems panel requests a reveal for this file.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !reveal || norm(reveal.path) !== norm(path)) return
    editor.revealLineInCenter(reveal.line)
    editor.setPosition({ lineNumber: reveal.line, column: reveal.column })
    editor.focus()
    clearReveal()
  }, [reveal, path, clearReveal, mountNonce])

  if (!tab) return <div className="flex-1 bg-ide-bg" />

  return (
    <Editor
      key={path}
      height="100%"
      theme="cortex-dark"
      language={tab.language.monaco}
      value={tab.content}
      beforeMount={(m) => {
        defineTheme(m)
        // Monaco has no Zig grammar; register ours before the model is created
        // or it silently falls back to plaintext.
        registerZig(m)
        registerJson(m)
      }}
      onChange={(value) => {
        updateContent(path, value ?? '')
        const model = editorRef.current?.getModel()
        if (model) changeDoc(model, value ?? '')
      }}
      onMount={(editor, m) => {
        editorRef.current = editor
        monacoRef.current = m
        modelRef.current = editor.getModel()
        // Start the language server for this file (if one is installed) and open
        // the document. initLsp is idempotent; openDoc is a no-op for languages
        // with no server, so the editor degrades to plain highlighting.
        void initLsp(m).then(() => {
          const model = editor.getModel()
          if (model && workspaceRoot) openDoc(path, workspaceRoot, model, editor.getValue())
        })
        // Exposed so the menu bar's Edit/Format items can drive the focused
        // editor (Monaco actions are not reachable via document.execCommand).
        // Cleared on dispose: switching to the Simulator unmounts this editor,
        // and a stale handle would let the menu drive a disposed instance.
        const w = window as unknown as { __cortexEditor?: typeof editor }
        w.__cortexEditor = editor
        editor.onDidDispose(() => {
          if (w.__cortexEditor === editor) delete w.__cortexEditor
        })
        editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => void saveActive())
        editor.addCommand(m.KeyCode.F5, () => void runActive())
        // Toggle a breakpoint when the glyph margin (left of the line numbers) is
        // clicked, the way every debugger does it.
        editor.onMouseDown((e) => {
          if (e.target.type === m.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position) {
            toggleBreakpoint(path, e.target.position.lineNumber)
          }
        })
        setMountNonce((n) => n + 1)
      }}
      options={{
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
        fontLigatures: true,
        // Off by default: with the sidebar and AI panel open the code column is
        // ~470px, and the minimap renders as a smear that clips actual code.
        minimap: { enabled: false },
        glyphMargin: true, // breakpoint dots + the current debug line arrow
        stickyScroll: { enabled: false },
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        tabSize: 2,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        padding: { top: 8 }
      }}
    />
  )
}
