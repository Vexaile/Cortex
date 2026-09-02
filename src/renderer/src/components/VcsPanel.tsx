import { useCallback, useEffect, useRef, useState } from 'react'
import { GitBranch, RefreshCw, ArrowUp, ArrowDown, Plus, Minus, Check } from 'lucide-react'
import PanelHeader from './PanelHeader'
import DiffView from './DiffView'
import { useStore } from '../store/useStore'
import type { GitStatus, GitFileStatus, GitFileDiff, GitDiffKind, GitOpResult } from '@shared/ipc'

const baseName = (p: string): string => p.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() || p
const dirOf = (p: string): string => {
  const s = p.replace(/\\/g, '/').replace(/\/$/, '')
  const i = s.lastIndexOf('/')
  return i < 0 ? '' : s.slice(0, i)
}

interface Section {
  kind: GitDiffKind
  label: string
  has: (f: GitFileStatus) => boolean
  letterFrom: (f: GitFileStatus) => string
}
// A file can belong to more than one section: staged AND further modified in
// the worktree (porcelain "MM") shows under both, each with its own diff - which
// is the honest picture. Untracked entries are excluded from Changes so they do
// not appear twice.
const SECTIONS: Section[] = [
  { kind: 'staged', label: 'Staged Changes', has: (f) => f.index !== ' ' && f.index !== '?', letterFrom: (f) => f.index },
  { kind: 'unstaged', label: 'Changes', has: (f) => f.worktree !== ' ' && f.worktree !== '?', letterFrom: (f) => f.worktree },
  { kind: 'untracked', label: 'Untracked', has: (f) => f.index === '?', letterFrom: () => '?' }
]
const isStaged = SECTIONS[0].has

// A one-letter tag with an AA-safe hue (the on-* tokens) for a status row.
function tagOf(letter: string): { text: string; cls: string; title: string } {
  switch (letter) {
    case '?':
      return { text: 'U', cls: 'text-ide-on-moss', title: 'Untracked' }
    case 'A':
      return { text: 'A', cls: 'text-ide-on-moss', title: 'Added' }
    case 'D':
      return { text: 'D', cls: 'text-ide-on-red', title: 'Deleted' }
    case 'R':
      return { text: 'R', cls: 'text-ide-on-amber', title: 'Renamed' }
    case 'C':
      return { text: 'C', cls: 'text-ide-on-amber', title: 'Copied' }
    case 'M':
      return { text: 'M', cls: 'text-ide-on-amber', title: 'Modified' }
    default:
      return { text: letter.trim() || '?', cls: 'text-ide-muted', title: 'Changed' }
  }
}

interface OpenDesc {
  key: string
  path: string
  kind: GitDiffKind
  orig?: string
}

export default function VcsPanel(): JSX.Element {
  const workspaceRoot = useStore((s) => s.workspaceRoot)
  const notify = useStore((s) => s.notify)
  const confirm = useStore((s) => s.confirm)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [commitError, setCommitError] = useState<string | null>(null)
  const [open, setOpen] = useState<OpenDesc | null>(null)
  const [diff, setDiff] = useState<GitFileDiff | null>(null)
  const statusGen = useRef(0)
  const diffGen = useRef(0)
  const openRef = useRef<OpenDesc | null>(null) // latest selection, for the refresh closure

  const loadDiff = useCallback(async (d: OpenDesc): Promise<void> => {
    const my = ++diffGen.current
    const res = await window.api.gitDiff(d.path, d.kind, d.orig)
    if (my === diffGen.current) setDiff(res)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const my = ++statusGen.current
    setLoading(true)
    const s = await window.api.gitStatus()
    if (my !== statusGen.current) return // a newer refresh superseded this one
    setStatus(s)
    setLoading(false)
    // Reconcile the open diff: drop it if its file left that section, otherwise
    // re-fetch so an edit to the open file is reflected rather than going stale.
    const cur = openRef.current
    if (cur) {
      const sec = SECTIONS.find((x) => x.kind === cur.kind)
      const still = !!sec && s.files.some((f) => f.path === cur.path && sec.has(f))
      if (!still) {
        openRef.current = null
        setOpen(null)
        setDiff(null)
      } else {
        void loadDiff(cur)
      }
    }
  }, [loadDiff])

  useEffect(() => {
    void refresh()
  }, [refresh, workspaceRoot])

  // Reflect edits/saves while the panel is open, debounced so a burst is one refresh.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const unsub = window.api.onFsEvent(() => {
      if (t) clearTimeout(t)
      t = setTimeout(() => void refresh(), 400)
    })
    return () => {
      if (t) clearTimeout(t)
      unsub()
    }
  }, [refresh])

  const select = (d: OpenDesc): void => {
    if (openRef.current?.key === d.key) {
      openRef.current = null
      setOpen(null)
      setDiff(null)
      return
    }
    openRef.current = d
    setOpen(d)
    setDiff(null)
    void loadDiff(d)
  }

  // Run a mutating op, then refresh. Serialized behind `busy` so a double click
  // cannot fire two overlapping stage/commit calls.
  const doOp = async (op: () => Promise<GitOpResult>): Promise<GitOpResult> => {
    if (busy) return { ok: false, error: 'A git operation is already running.' }
    setBusy(true)
    let r: GitOpResult
    try {
      r = await op()
    } catch {
      r = { ok: false, error: 'git operation failed.' }
    }
    // Stay busy THROUGH the refresh: clearing it before the gitStatus round-trip
    // reopens a window where the (still-stale) staged count + message re-enable
    // Commit, so a held Enter could fire a second (spurious) commit.
    try {
      await refresh()
    } catch {
      /* refresh guards its own errors; never leave busy stuck */
    } finally {
      setBusy(false)
    }
    return r
  }

  const files = status?.files ?? []
  const stagedCount = files.filter(isStaged).length
  const canCommit = stagedCount > 0 && msg.trim().length > 0 && !busy

  const doCommit = async (): Promise<void> => {
    if (!canCommit) return
    setCommitError(null)
    const r = await doOp(() => window.api.gitCommit(msg))
    if (r.ok) {
      notify('success', 'Committed', `${stagedCount} file${stagedCount === 1 ? '' : 's'}`)
      setMsg('')
    } else {
      setCommitError(r.error ?? 'Commit failed.')
    }
  }

  // Push is outward-facing (it publishes to a remote), so it always confirms
  // first and is never automatic. The Push affordance only appears when there
  // are commits ahead of a known upstream, so this guard is belt-and-braces.
  const doPush = async (): Promise<void> => {
    const s = status
    if (busy || !s?.upstream || s.ahead < 1) return
    const ok = await confirm({
      title: 'Push commits',
      message: `Push ${s.ahead} commit${s.ahead === 1 ? '' : 's'} to ${s.upstream}?`,
      confirmLabel: 'Push'
    })
    if (!ok) return
    const r = await doOp(() => window.api.gitPush())
    if (r.ok) notify('success', 'Pushed', `to ${s.upstream}`)
    else notify('error', 'Push failed', r.error)
  }

  const header = (
    <PanelHeader
      icon={<GitBranch size={13} />}
      actions={
        <button
          title="Refresh"
          aria-label="Refresh source control"
          onClick={() => void refresh()}
          className="grid h-6 w-6 place-items-center rounded text-ide-muted hover:bg-ide-hover hover:text-ide-text"
        >
          <RefreshCw size={13} className={loading ? 'motion-safe:animate-spin' : ''} />
        </button>
      }
    >
      Source Control
    </PanelHeader>
  )

  const centered = (children: React.ReactNode): JSX.Element => (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">{children}</div>
    </div>
  )

  if (!workspaceRoot) return centered(<div className="text-[12px] text-ide-muted">Open a folder to track its changes.</div>)

  if (status?.error) {
    return centered(
      <>
        <GitBranch size={22} className="text-ide-faint" />
        <div className="text-[12px] text-ide-muted">{status.error}</div>
      </>
    )
  }

  if (status && !status.isRepo) {
    return centered(
      <>
        <GitBranch size={22} className="text-ide-faint" />
        <div className="text-[12px] text-ide-muted">This folder is not a git repository.</div>
        <div className="text-[11px] text-ide-faint">Run git init in a terminal to start tracking changes.</div>
      </>
    )
  }

  const actionBtn = (kind: GitDiffKind, paths: string[], label: string): JSX.Element => (
    <button
      className="grid h-4 w-4 shrink-0 place-items-center rounded text-ide-faint opacity-0 hover:bg-ide-hover hover:text-ide-text group-hover:opacity-100 disabled:cursor-not-allowed"
      title={label}
      aria-label={label}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation()
        void doOp(() => (kind === 'staged' ? window.api.gitUnstage(paths) : window.api.gitStage(paths)))
      }}
    >
      {kind === 'staged' ? <Minus size={12} /> : <Plus size={12} />}
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      {status?.branch && (
        <div className="row items-center gap-1.5 border-b border-ide-border/60 px-3 py-1 text-[11px]">
          <GitBranch size={12} className="shrink-0 text-ide-faint" />
          <span className="truncate text-ide-text">{status.branch}</span>
          {status.behind > 0 && (
            <span className="row items-center text-ide-faint" title={`${status.behind} behind ${status.upstream ?? 'upstream'}`}>
              <ArrowDown size={11} />
              {status.behind}
            </span>
          )}
          {status.ahead > 0 &&
            (status.upstream ? (
              <button
                className="row ml-auto items-center gap-1 rounded px-1.5 py-0.5 text-ide-muted enabled:hover:bg-ide-hover enabled:hover:text-ide-text disabled:cursor-not-allowed disabled:opacity-40"
                disabled={busy}
                onClick={() => void doPush()}
                title={`Push ${status.ahead} commit${status.ahead === 1 ? '' : 's'} to ${status.upstream}`}
              >
                <ArrowUp size={12} /> Push {status.ahead}
              </button>
            ) : (
              <span className="row ml-auto items-center text-ide-faint" title={`${status.ahead} unpushed (no upstream set)`}>
                <ArrowUp size={11} />
                {status.ahead}
              </span>
            ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="border-b border-ide-border/60 px-2 py-1.5">
          <input
            className="h-7 w-full rounded border border-ide-border bg-ide-bg px-2 text-[12px] text-ide-text outline-none placeholder:text-ide-faint focus:border-ide-accent disabled:opacity-50"
            placeholder={stagedCount > 0 ? 'Commit message' : 'Stage changes, then commit'}
            value={msg}
            disabled={busy}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doCommit()
            }}
          />
          <button
            className="btn btn-accent mt-1 h-7 w-full justify-center text-[12px] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canCommit}
            onClick={() => void doCommit()}
            title={
              stagedCount === 0 ? 'Stage changes first' : !msg.trim() ? 'Enter a commit message' : 'Commit staged changes'
            }
          >
            <Check size={13} /> Commit{stagedCount > 0 ? ` (${stagedCount})` : ''}
          </button>
          {commitError && <div className="mono mt-1 text-[11px] text-ide-on-red">{commitError}</div>}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {files.length === 0 ? (
          <div className="px-3 py-3 text-center text-[11px] text-ide-faint">
            {loading ? 'Reading status...' : 'No changes. The working tree is clean.'}
          </div>
        ) : (
          SECTIONS.map((sec) => {
            const group = files.filter(sec.has)
            if (group.length === 0) return null
            return (
              <div key={sec.kind} className="border-b border-ide-border/40 pb-1 last:border-b-0">
                <div className="group row h-6 items-center gap-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-ide-muted">
                  {sec.label}
                  <span className="text-ide-faint">({group.length})</span>
                  <span className="ml-auto">
                    {actionBtn(sec.kind, group.map((f) => f.path), sec.kind === 'staged' ? 'Unstage all' : 'Stage all')}
                  </span>
                </div>
                {group.map((f) => {
                  const key = `${sec.kind}:${f.path}`
                  const t = tagOf(sec.letterFrom(f))
                  const isOpen = open?.key === key
                  const dir = dirOf(f.path)
                  return (
                    <div key={key} className="group">
                      <div className={`row items-baseline gap-2 pl-3 pr-2 text-[11px] hover:bg-ide-hover ${isOpen ? 'bg-ide-accent/10' : ''}`}>
                        <button
                          className="row min-w-0 flex-1 items-baseline gap-2 py-0.5 text-left"
                          onClick={() => select({ key, path: f.path, kind: sec.kind, orig: f.orig })}
                          title={`${t.title}: ${f.path}${f.orig ? ` (from ${f.orig})` : ''}`}
                        >
                          <span className={`mono w-3 shrink-0 text-center font-semibold ${t.cls}`}>{t.text}</span>
                          <span className="truncate text-ide-text">{baseName(f.path)}</span>
                          {dir && <span className="ml-auto truncate pl-2 text-[10px] text-ide-faint">{dir}</span>}
                        </button>
                        {actionBtn(sec.kind, [f.path], sec.kind === 'staged' ? 'Unstage' : 'Stage')}
                      </div>
                      {isOpen && (
                        <div className="border-y border-ide-border/60 bg-ide-bg/40">
                          {!diff ? (
                            <div className="px-3 py-1.5 text-[11px] text-ide-faint">Loading diff...</div>
                          ) : diff.directory ? (
                            <div className="px-3 py-1.5 text-[11px] text-ide-faint">A directory - open a file to see its diff.</div>
                          ) : diff.binary ? (
                            <div className="px-3 py-1.5 text-[11px] text-ide-faint">Binary file - no text diff.</div>
                          ) : (
                            <DiffView oldContent={diff.oldContent} newContent={diff.newContent} />
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
