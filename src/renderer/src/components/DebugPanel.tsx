import { useEffect, useRef, useState } from 'react'
import {
  Bug,
  Play,
  StepForward,
  ArrowDownToLine,
  ArrowUpFromLine,
  Square,
  Pause,
  ChevronRight,
  ChevronDown,
  X,
  Circle
} from 'lucide-react'
import PanelHeader from './PanelHeader'
import { useStore, isSketch } from '../store/useStore'
import { isHeaderPath } from '@shared/languages'
import { parseGdbValue, type GdbNode } from '@shared/gdbValue'

// A single array/struct can list thousands of elements; render a bounded window
// so expanding one never freezes the panel.
const MAX_CHILDREN = 200

/**
 * One row of a debug value, expandable when gdb printed an aggregate (a struct
 * or array). Every line of text is exactly what gdb returned - expansion only
 * re-lays-out that string as a tree, it never asks for or invents more data.
 * `action` (a remove button, say) renders at the end of the root row only.
 */
function VarNode({
  node,
  depth,
  action
}: {
  node: GdbNode
  depth: number
  action?: JSX.Element
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const kids = node.children
  const expandable = !!kids && kids.length > 0
  const pad = 12 + depth * 14
  return (
    <>
      <div
        className="group row items-baseline gap-1 py-0.5 text-[11px]"
        style={{ paddingLeft: pad, paddingRight: 12 }}
      >
        {expandable ? (
          <button
            className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded text-ide-faint hover:text-ide-text"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            title={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
        )}
        {node.name && <span className="mono shrink-0 text-ide-cyan">{node.name}</span>}
        <span className="mono truncate text-ide-text" title={node.value}>
          {node.value}
        </span>
        {action}
      </div>
      {open &&
        kids &&
        kids
          .slice(0, MAX_CHILDREN)
          .map((c, i) => <VarNode key={(c.name ?? '') + i} node={c} depth={depth + 1} />)}
      {open && kids && kids.length > MAX_CHILDREN && (
        <div className="text-[10px] text-ide-faint" style={{ paddingLeft: pad + 14 }}>
          {kids.length - MAX_CHILDREN} more not shown
        </div>
      )}
    </>
  )
}

function Section({
  title,
  count,
  children
}: {
  title: string
  count?: number
  children: React.ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div className="border-b border-ide-border/60">
      <button
        className="row h-7 w-full items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-ide-muted hover:text-ide-text"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
        {count !== undefined && count > 0 && <span className="text-ide-faint">({count})</span>}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  )
}

const baseName = (p?: string): string => (p ? p.replace(/\\/g, '/').split('/').pop() || p : '')

export default function DebugPanel(): JSX.Element {
  const debug = useStore((s) => s.debug)
  const breakpoints = useStore((s) => s.breakpoints)
  const startDebug = useStore((s) => s.startDebug)
  const stopDebug = useStore((s) => s.stopDebug)
  const debugContinue = useStore((s) => s.debugContinue)
  const debugStepOver = useStore((s) => s.debugStepOver)
  const debugStepInto = useStore((s) => s.debugStepInto)
  const debugStepOut = useStore((s) => s.debugStepOut)
  const debugPause = useStore((s) => s.debugPause)
  const selectDebugFrame = useStore((s) => s.selectDebugFrame)
  const revealLocation = useStore((s) => s.revealLocation)
  const toggleBreakpoint = useStore((s) => s.toggleBreakpoint)
  // Without these the panel structurally cannot gate its own button, so it
  // offered "Start Debugging" for Python, Rust, sketches and headers alike.
  const activePath = useStore((s) => s.activePath)
  const tabs = useStore((s) => s.tabs)
  const activeTab = tabs.find((t) => t.path === activePath)
  const canDebug = !!activeTab?.language.debuggable && !isHeaderPath(activePath ?? '') && !isSketch(activePath)
  const cannotReason = !activeTab
    ? 'Open a C or C++ file to debug.'
    : isSketch(activePath)
      ? 'Arduino sketches cannot be debugged with host gdb. Use Simulate instead.'
      : isHeaderPath(activePath ?? '')
        ? 'A header is not a program. Open the .cpp/.c that includes it.'
        : `Cortex debugs C and C++ with gdb. ${activeTab.language.label} is not supported yet.`

  const stopped = debug.status === 'stopped'
  const running = debug.status === 'running'
  const active = stopped || running || debug.status === 'starting'

  // Watch expressions, evaluated each time execution stops. Each carries a
  // stable id so its expand/collapse state (held in the child VarNode) follows
  // the right row when an earlier watch is removed - an index key would leak a
  // removed row's open-state onto its neighbour.
  const [watch, setWatch] = useState<{ id: number; expr: string; value: string }[]>([])
  const watchId = useRef(0)
  const [newExpr, setNewExpr] = useState('')
  useEffect(() => {
    if (!stopped || watch.length === 0) return
    let cancelled = false
    void Promise.all(watch.map((w) => window.api.debugEvaluate(w.expr).then((value) => ({ ...w, value })))).then(
      (rows) => {
        if (!cancelled) setWatch(rows)
      }
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debug])

  const addWatch = async (): Promise<void> => {
    const expr = newExpr.trim()
    if (!expr) return
    setNewExpr('')
    const value = stopped ? await window.api.debugEvaluate(expr) : ''
    setWatch((w) => [...w, { id: watchId.current++, expr, value }])
  }

  const ctrl = (Icon: typeof Play, label: string, onClick: () => void, enabled: boolean): JSX.Element => (
    <button
      title={label}
      disabled={!enabled}
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded text-ide-muted enabled:hover:bg-ide-hover enabled:hover:text-ide-text disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon size={14} />
    </button>
  )

  const bpList = Object.entries(breakpoints).flatMap(([file, lines]) => lines.map((line) => ({ file, line })))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        icon={<Bug size={13} />}
        actions={
          // Only during a session: a row of greyed-out transport buttons when
          // idle is a dead affordance. The idle state's "Start Debugging" below
          // is the real entry point.
          active ? (
            <div className="row gap-0.5">
              {running
                ? ctrl(Pause, 'Pause', debugPause, true)
                : ctrl(Play, 'Continue', debugContinue, stopped)}
              {ctrl(StepForward, 'Step Over', debugStepOver, stopped)}
              {ctrl(ArrowDownToLine, 'Step Into', debugStepInto, stopped)}
              {ctrl(ArrowUpFromLine, 'Step Out', debugStepOut, stopped)}
              {ctrl(Square, 'Stop', stopDebug, active)}
            </div>
          ) : undefined
        }
      >
        Debug
      </PanelHeader>

      {!active ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <Bug size={22} className="text-ide-faint" />
          <div className="text-[12px] text-ide-muted">
            {canDebug
              ? `Debug ${baseName(activePath ?? undefined)} with gdb. Click a line's gutter to set a breakpoint, then start.`
              : cannotReason}
          </div>
          <button
            className="btn btn-accent text-[12px] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void startDebug()}
            disabled={!canDebug}
            title={canDebug ? 'Start a gdb session for this file' : cannotReason}
          >
            <Play size={13} /> Start Debugging
          </button>
          {debug.error && <div className="text-[11px] text-ide-red">{debug.error}</div>}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {debug.reason && (
            <div className="px-3 py-1 text-[10px] text-ide-faint">
              {running ? 'Running...' : `Paused: ${debug.reason.replace(/-/g, ' ')}`}
            </div>
          )}

          <Section title="Call Stack" count={debug.stack.length}>
            {debug.stack.length === 0 ? (
              <div className="px-3 py-1 text-[11px] text-ide-faint">{running ? 'Running.' : 'No frames.'}</div>
            ) : (
              debug.stack.map((f) => (
                <button
                  key={f.level}
                  className={`row w-full items-baseline justify-between gap-2 px-3 py-0.5 text-left text-[11px] hover:bg-ide-hover ${
                    f.level === debug.frame ? 'bg-ide-accent/10 text-ide-text' : 'text-ide-muted'
                  }`}
                  onClick={() => selectDebugFrame(f.level)}
                >
                  <span className="mono truncate">{f.func || '??'}</span>
                  <span className="shrink-0 text-[10px] text-ide-faint">
                    {baseName(f.file)}:{f.line}
                  </span>
                </button>
              ))
            )}
          </Section>

          <Section title="Variables" count={debug.variables.length}>
            {debug.variables.length === 0 ? (
              <div className="px-3 py-1 text-[11px] text-ide-faint">No variables in scope.</div>
            ) : (
              debug.variables.map((v) => (
                <VarNode key={v.name} node={{ ...parseGdbValue(v.value), name: v.name }} depth={0} />
              ))
            )}
          </Section>

          <Section title="Watch" count={watch.length}>
            <div className="px-3 py-1">
              <input
                className="h-6 w-full rounded border border-ide-border bg-ide-bg px-2 text-[11px] text-ide-text outline-none placeholder:text-ide-faint"
                placeholder="Add expression..."
                value={newExpr}
                onChange={(e) => setNewExpr(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addWatch()}
              />
            </div>
            {watch.map((w) => (
              <VarNode
                key={w.id}
                node={{ ...parseGdbValue(w.value || '...'), name: w.expr }}
                depth={0}
                action={
                  <button
                    className="ml-auto shrink-0 text-ide-faint opacity-0 hover:text-ide-text group-hover:opacity-100"
                    onClick={() => setWatch((ws) => ws.filter((x) => x.id !== w.id))}
                    title="Remove watch"
                    aria-label="Remove watch"
                  >
                    <X size={11} />
                  </button>
                }
              />
            ))}
          </Section>

          <Section title="Breakpoints" count={bpList.length}>
            {bpList.length === 0 ? (
              <div className="px-3 py-1 text-[11px] text-ide-faint">Click a line&apos;s gutter to set one.</div>
            ) : (
              bpList.map((b) => (
                <div key={`${b.file}:${b.line}`} className="group row items-center gap-1.5 px-3 py-0.5 text-[11px]">
                  <Circle size={9} className="shrink-0 fill-ide-red text-ide-red" />
                  <button
                    className="row min-w-0 items-baseline gap-1.5 text-left hover:text-ide-text"
                    onClick={() => void revealLocation(b.file, b.line, 1)}
                  >
                    <span className="truncate text-ide-muted">{baseName(b.file)}</span>
                    <span className="shrink-0 text-ide-faint">:{b.line}</span>
                  </button>
                  <button
                    className="ml-auto shrink-0 text-ide-faint opacity-0 hover:text-ide-text group-hover:opacity-100"
                    onClick={() => toggleBreakpoint(b.file, b.line)}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))
            )}
          </Section>
        </div>
      )}
    </div>
  )
}
