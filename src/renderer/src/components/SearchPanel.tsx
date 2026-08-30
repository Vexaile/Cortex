import { useEffect, useMemo, useState } from 'react'
import { Search, CaseSensitive, WholeWord, Regex, ChevronRight, ChevronDown, X } from 'lucide-react'
import PanelHeader from './PanelHeader'
import { useStore } from '../store/useStore'
import type { SearchResults, SearchFileResult } from '@shared/ipc'

/** Workspace search: file content across the open folder, grouped by file, with
 * click-to-open at the match and case / whole-word / regex toggles. */
export default function SearchPanel(): JSX.Element {
  const workspaceRoot = useStore((s) => s.workspaceRoot)
  const revealLocation = useStore((s) => s.revealLocation)

  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [results, setResults] = useState<SearchResults | null>(null)
  const [searching, setSearching] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!query.trim() || !workspaceRoot) {
      setResults(null)
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      const r = await window.api.searchInFiles({ root: workspaceRoot, query, caseSensitive, wholeWord, regex })
      setResults(r)
      setSearching(false)
    }, 250)
    return () => clearTimeout(t)
  }, [query, caseSensitive, wholeWord, regex, workspaceRoot])

  const fileCount = results?.files.length ?? 0

  const toggle = (active: boolean, set: (v: boolean) => void, Icon: typeof Search, label: string): JSX.Element => (
    <button
      title={label}
      onClick={() => set(!active)}
      className={`grid h-6 w-6 place-items-center rounded ${
        active ? 'bg-ide-accent/20 text-ide-accent' : 'text-ide-faint hover:bg-ide-hover hover:text-ide-text'
      }`}
    >
      <Icon size={13} />
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader>Search</PanelHeader>
      <div className="space-y-1.5 p-2">
        <div className="row gap-1.5 rounded border border-ide-border bg-ide-bg px-2">
          <Search size={13} className="shrink-0 text-ide-faint" />
          <input
            autoFocus
            className="h-7 w-full bg-transparent text-[12px] text-ide-text outline-none placeholder:text-ide-faint"
            placeholder="Search files and text..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="shrink-0 text-ide-faint hover:text-ide-text" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          )}
        </div>
        <div className="row gap-0.5">
          {toggle(caseSensitive, setCaseSensitive, CaseSensitive, 'Match case')}
          {toggle(wholeWord, setWholeWord, WholeWord, 'Match whole word')}
          {toggle(regex, setRegex, Regex, 'Use regular expression')}
          <div className="flex-1" />
          {results && (
            <span className="self-center text-[10px] text-ide-faint">
              {results.total} {results.total === 1 ? 'result' : 'results'} in {fileCount}{' '}
              {fileCount === 1 ? 'file' : 'files'}
              {results.truncated && ' (truncated)'}
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-3">
        {!workspaceRoot ? (
          <div className="p-3 text-[12px] text-ide-faint">Open a folder to search.</div>
        ) : searching && !results ? (
          <div className="p-3 text-[12px] text-ide-faint">Searching...</div>
        ) : results && results.files.length === 0 && query.trim() ? (
          <div className="p-3 text-[12px] text-ide-faint">No results.</div>
        ) : (
          results?.files.map((f) => (
            <FileGroup
              key={f.path}
              file={f}
              root={workspaceRoot}
              collapsed={collapsed.has(f.path)}
              onToggle={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev)
                  if (next.has(f.path)) next.delete(f.path)
                  else next.add(f.path)
                  return next
                })
              }
              onOpen={(line, column) => void revealLocation(f.path, line, column)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function FileGroup({
  file,
  root,
  collapsed,
  onToggle,
  onOpen
}: {
  file: SearchFileResult
  root: string
  collapsed: boolean
  onToggle: () => void
  onOpen: (line: number, column: number) => void
}): JSX.Element {
  const rel = useMemo(() => {
    const norm = (p: string): string => p.replace(/\\/g, '/')
    const r = norm(root)
    const p = norm(file.path)
    return p.startsWith(r + '/') ? p.slice(r.length + 1) : p
  }, [file.path, root])
  const name = rel.split('/').pop() ?? rel
  const dir = rel.slice(0, rel.length - name.length - 1)

  return (
    <div>
      <button
        className="row sticky top-0 w-full items-center gap-1 bg-ide-panel px-2 py-1 text-left hover:bg-ide-hover"
        onClick={onToggle}
      >
        {collapsed ? <ChevronRight size={13} className="text-ide-faint" /> : <ChevronDown size={13} className="text-ide-faint" />}
        <span className="truncate text-[12px] text-ide-text">{name}</span>
        {dir && <span className="truncate text-[10px] text-ide-faint">{dir}</span>}
        <span className="ml-auto shrink-0 rounded-full bg-ide-bg px-1.5 text-[9px] text-ide-muted">{file.matches.length}</span>
      </button>
      {!collapsed &&
        file.matches.map((m, i) => (
          <button
            key={i}
            className="row w-full items-baseline gap-2 px-2 py-0.5 pl-6 text-left hover:bg-ide-hover"
            onClick={() => onOpen(m.line, m.column)}
            title={`Line ${m.line}`}
          >
            <span className="mono w-8 shrink-0 text-right text-[10px] text-ide-faint">{m.line}</span>
            <span className="mono truncate text-[11px] text-ide-muted">
              {m.preview.slice(0, m.matchStart)}
              <span className="rounded-sm bg-ide-amber/30 text-ide-text">{m.preview.slice(m.matchStart, m.matchEnd)}</span>
              {m.preview.slice(m.matchEnd)}
            </span>
          </button>
        ))}
    </div>
  )
}
