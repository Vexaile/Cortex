import { useEffect, useRef } from 'react'
import {
  PackageCheck,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  Cpu,
  ArrowUpCircle,
  Download,
  Search,
  Camera,
  Lock
} from 'lucide-react'
import { useStore } from '../store/useStore'
import type { DependencyStatus, EnvFinding, FindingSeverity, UpdateStatus } from '@shared/environment'
import { restorePlan } from '@shared/lockfile'
import PanelHeader from './PanelHeader'
import EmptyState from './EmptyState'

/**
 * The Intelligent Dependency & Environment view: the evidence-based
 * reconcileEnvironment report for the open project. Board/core status, the
 * libraries the source includes (resolved to an installed library, provided by
 * the toolchain, or unverified), and available updates with risk. Every claim
 * is backed by the report; nothing is guessed, and proposed installs/updates
 * run through the same streamed, user-visible path as the package managers.
 */

const SEV_ICON: Record<FindingSeverity, typeof Info> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  ok: CheckCircle2
}
const SEV_COLOR: Record<FindingSeverity, string> = {
  error: 'text-ide-red',
  warning: 'text-ide-amber',
  info: 'text-ide-faint',
  ok: 'text-ide-moss'
}

function SiteLink({ file, line }: { file: string; line: number }): JSX.Element {
  const workspaceRoot = useStore((s) => s.workspaceRoot)
  const revealLocation = useStore((s) => s.revealLocation)
  // A project-model file is usually workspace-relative, but can be absolute when
  // the root's separators differ from the file listing; handle both.
  const isAbsolute = /^[a-zA-Z]:[\\/]/.test(file) || file.startsWith('/')
  const open = (): void => {
    if (isAbsolute) {
      void revealLocation(file, line, 1)
      return
    }
    if (!workspaceRoot) return
    const sep = workspaceRoot.includes('\\') ? '\\' : '/'
    const root = workspaceRoot.replace(/[\\/]+$/, '')
    void revealLocation(`${root}${sep}${file.replace(/\//g, sep)}`, line, 1)
  }
  const baseName = file.split(/[\\/]/).pop()
  return (
    <button onClick={open} className="mono shrink-0 text-[10px] text-ide-faint hover:text-ide-cyan" title={`${file}:${line}`}>
      {baseName}:{line}
    </button>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }): JSX.Element | null {
  if (count === 0) return null
  return (
    <div className="pb-1">
      <div className="row gap-1.5 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-ide-muted">
        {title} <span className="text-ide-faint">· {count}</span>
      </div>
      {children}
    </div>
  )
}

const DEP_BADGE: Record<DependencyStatus['state'], { label: string; cls: string }> = {
  resolved: { label: 'resolved', cls: 'bg-ide-moss/15 text-ide-moss' },
  'provided-by-toolchain': { label: 'toolchain', cls: 'bg-ide-bar text-ide-faint' },
  unverified: { label: 'unverified', cls: 'bg-ide-amber/15 text-ide-amber' },
  missing: { label: 'missing', cls: 'bg-ide-red/15 text-ide-red' }
}
const RISK_CLS: Record<UpdateStatus['risk'], string> = {
  low: 'bg-ide-moss/15 text-ide-moss',
  medium: 'bg-ide-amber/15 text-ide-amber',
  high: 'bg-ide-red/15 text-ide-red',
  unknown: 'bg-ide-bar text-ide-faint'
}

/**
 * Reproducibility: the observed lockfile and its drift. A compact status line
 * (in sync / N changes / no snapshot) with a Snapshot action, expanding to the
 * concrete differences only when the environment has drifted. Everything shown
 * is an observed fact from @shared/lockfile; no compatibility is judged.
 */
function Reproducibility(): JSX.Element {
  const lockCheck = useStore((s) => s.lockCheck)
  const lockBusy = useStore((s) => s.lockBusy)
  const lockRestoring = useStore((s) => s.lockRestoring)
  const running = useStore((s) => s.running)
  const snapshot = useStore((s) => s.snapshotEnvironment)
  const restore = useStore((s) => s.restoreFromLock)

  const drift = lockCheck?.drift
  const has = !!lockCheck
  const inSync = drift?.inSync ?? false
  const when = lockCheck?.lock.generatedAt
  // Installable drift only (missing/changed cores+libraries); a board change or
  // an extra is shown but never auto-applied, so Restore appears only when there
  // is something it can actually do.
  const planCount = drift ? restorePlan(drift).length : 0
  const busy = lockBusy || lockRestoring || running

  let StatusIcon = Camera
  let statusCls = 'text-ide-faint'
  let statusText = 'No environment snapshot'
  if (has && inSync) {
    StatusIcon = CheckCircle2
    statusCls = 'text-ide-moss'
    statusText = 'In sync with the lockfile'
  } else if (has && drift) {
    StatusIcon = AlertTriangle
    statusCls = 'text-ide-amber'
    const n = drift.breakingCount
    statusText = `${n} change${n === 1 ? '' : 's'} since the snapshot`
  }

  return (
    <div className="border-t border-ide-border/60 pt-1">
      <div className="row items-center gap-1.5 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-ide-muted">
        <Lock size={11} /> Reproducibility
      </div>
      <div className="row items-start gap-2 px-3 py-1 pl-4">
        <StatusIcon size={13} className={`mt-0.5 shrink-0 ${statusCls}`} />
        <div className="min-w-0 flex-1">
          <div className="text-ide-text">{statusText}</div>
          {when && (
            <div className="text-[10px] text-ide-faint" title={when}>
              snapshot {new Date(when).toLocaleString()}
            </div>
          )}
        </div>
        <div className="row shrink-0 gap-1.5">
          {has && !inSync && planCount > 0 && (
            <button
              className="btn whitespace-nowrap border border-ide-border text-[11px] disabled:opacity-40"
              onClick={() => void restore()}
              disabled={busy}
              title={`Install the locked version of ${planCount} package${planCount === 1 ? '' : 's'} to match the snapshot`}
            >
              <Download size={12} /> {lockRestoring ? 'Restoring...' : `Restore ${planCount}`}
            </button>
          )}
          <button
            className="btn whitespace-nowrap border border-ide-border text-[11px] disabled:opacity-40"
            onClick={() => void snapshot()}
            disabled={busy}
            title={has ? 'Overwrite the lockfile with the current environment' : 'Record the current environment to a lockfile'}
          >
            <Camera size={12} /> {lockBusy ? 'Saving...' : has ? 'Re-snapshot' : 'Snapshot'}
          </button>
        </div>
      </div>

      {has && drift && !inSync && (
        <div className="pb-1">
          {drift.boardChanged && (
            <DriftRow badge={{ label: 'board', cls: 'bg-ide-amber/15 text-ide-amber' }}>
              <span className="mono text-[11px]">
                {drift.boardChanged.from || 'none'} {'->'} {drift.boardChanged.to || 'none'}
              </span>
            </DriftRow>
          )}
          {drift.coresMissing.map((c) => (
            <DriftRow key={`cm-${c.id}`} badge={{ label: 'missing', cls: 'bg-ide-red/15 text-ide-red' }}>
              <span className="mono truncate">{c.id}</span>
              <span className="text-[11px] text-ide-muted">core, locked {c.version}</span>
            </DriftRow>
          ))}
          {drift.librariesMissing.map((l) => (
            <DriftRow key={`lm-${l.name}`} badge={{ label: 'missing', cls: 'bg-ide-red/15 text-ide-red' }}>
              <span className="truncate">{l.name}</span>
              <span className="text-[11px] text-ide-muted">locked {l.version}</span>
            </DriftRow>
          ))}
          {drift.coresChanged.map((c) => (
            <DriftRow key={`cc-${c.id}`} badge={{ label: 'changed', cls: 'bg-ide-amber/15 text-ide-amber' }}>
              <span className="mono truncate">{c.id}</span>
              <span className="text-[11px] text-ide-muted">
                {c.installed} (locked {c.locked})
              </span>
            </DriftRow>
          ))}
          {drift.librariesChanged.map((l) => (
            <DriftRow key={`lc-${l.name}`} badge={{ label: 'changed', cls: 'bg-ide-amber/15 text-ide-amber' }}>
              <span className="truncate">{l.name}</span>
              <span className="text-[11px] text-ide-muted">
                {l.installed} (locked {l.locked})
              </span>
            </DriftRow>
          ))}
        </div>
      )}
    </div>
  )
}

function DriftRow({
  badge,
  children
}: {
  badge: { label: string; cls: string }
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="row items-center gap-2 px-3 py-0.5 pl-4">
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${badge.cls}`}>{badge.label}</span>
      {children}
    </div>
  )
}

export default function EnvironmentPanel(): JSX.Element {
  const report = useStore((s) => s.environmentReport)
  const envLoading = useStore((s) => s.envLoading)
  const inspectEnvironment = useStore((s) => s.inspectEnvironment)
  const checkLock = useStore((s) => s.checkLock)
  const workspaceRoot = useStore((s) => s.workspaceRoot)
  const selectedFqbn = useStore((s) => s.selectedFqbn)
  const running = useStore((s) => s.running)
  const installCore = useStore((s) => s.installCore)
  const installLib = useStore((s) => s.installLib)
  const setSidebar = useStore((s) => s.setSidebar)

  // Inspect on open and whenever the project or board changes (uses the cached
  // package snapshot; the Refresh button forces a re-read). The lock drift is
  // checked against the same board/package state, so re-check it in lockstep.
  useEffect(() => {
    if (workspaceRoot) {
      void inspectEnvironment(false)
      void checkLock()
    }
  }, [workspaceRoot, selectedFqbn, inspectEnvironment, checkLock])

  // A completed package op invalidates the environment cache in the main
  // process, so re-inspect whenever any op finishes (running true -> false),
  // regardless of which panel started it. After a non-package run the cache is
  // warm, so this is a cheap model-only refresh. A package op can also change
  // the drift (installing a locked-but-missing library brings it into sync).
  const prevRunning = useRef(running)
  useEffect(() => {
    if (prevRunning.current && !running) {
      void inspectEnvironment(false)
      void checkLock()
    }
    prevRunning.current = running
  }, [running, inspectEnvironment, checkLock])

  const runSuggestion = (f: EnvFinding): void => {
    const s = f.suggestion
    if (!s) return
    // A missing header only tells us which header, not the package: send the
    // engineer to the Library Manager to find one that provides it.
    if (s.kind === 'search-library') {
      setSidebar('libraries')
      return
    }
    if (running) return // call-time guard: runPackageOp drops an op while one is running
    if (s.kind === 'install-core') void installCore(s.target)
    else void installLib(s.target, s.version)
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        icon={<PackageCheck size={13} />}
        actions={
          <button
            title="Re-scan environment"
            onClick={() => {
              void inspectEnvironment(true)
              void checkLock()
            }}
            className="rounded p-1 hover:bg-ide-hover hover:text-ide-text"
          >
            <RefreshCw size={13} className={envLoading ? 'animate-spin' : ''} />
          </button>
        }
      >
        Environment
      </PanelHeader>

      {!workspaceRoot ? (
        <EmptyState icon={<PackageCheck size={22} />}>
          Open a folder to see its board, libraries, and whether the environment can build it.
        </EmptyState>
      ) : !report ? (
        <div className="grid flex-1 place-items-center text-[12px] text-ide-faint">
          {envLoading ? 'Inspecting environment...' : 'No environment data.'}
        </div>
      ) : (
        <div className="flex-1 overflow-auto py-1 text-[12.5px]">
          {/* Board / core line */}
          <div className="row gap-2 px-3 py-1.5">
            <Cpu size={14} className="shrink-0 text-ide-muted" />
            {report.core.fqbn ? (
              <span className="mono min-w-0 truncate text-ide-text" title={report.core.fqbn}>
                {report.core.fqbn}
              </span>
            ) : (
              <span className="text-[11px] text-ide-faint">No board selected</span>
            )}
            {report.core.installed && report.core.installedVersion && (
              <span className="shrink-0 rounded bg-ide-moss/15 px-1.5 py-0.5 text-[10px] text-ide-moss">
                core {report.core.installedVersion}
              </span>
            )}
          </div>

          {/* Reproducibility: the lockfile and any drift since it was taken. */}
          <Reproducibility />

          {/* Diagnostics: core/board status + the library-level explanation
              (why headers are unverified). Updates get their own section. */}
          <Section title="Diagnostics" count={report.findings.filter((f) => f.category !== 'update').length}>
            {report.findings
              .filter((f) => f.category !== 'update')
              .map((f) => {
                const Icon = SEV_ICON[f.severity]
                const search = f.suggestion?.kind === 'search-library'
                return (
                  <div key={f.id} className="px-3 py-1 pl-4">
                    <div className="row items-start gap-2">
                      <Icon size={13} className={`mt-0.5 shrink-0 ${SEV_COLOR[f.severity]}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-ide-text">{f.title}</div>
                        <div className="text-[11px] leading-snug text-ide-muted">{f.detail}</div>
                        {f.file && f.line != null && (
                          <div className="pt-0.5">
                            <SiteLink file={f.file} line={f.line} />
                          </div>
                        )}
                      </div>
                      {f.suggestion && (
                        <button
                          className="btn shrink-0 whitespace-nowrap border border-ide-border text-[11px] disabled:opacity-40"
                          onClick={() => runSuggestion(f)}
                          disabled={running && !search}
                          title={search ? 'Find a library in the Library Manager' : `Install ${f.suggestion.target}`}
                        >
                          {search ? <Search size={12} /> : <Download size={12} />} {search ? 'Find library' : 'Install'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
          </Section>

          {/* Dependencies: each #include header and how it resolves. */}
          <Section title="Dependencies" count={report.dependencies.length}>
            {report.dependencies.map((d) => {
              const badge = DEP_BADGE[d.state]
              return (
                <div key={d.header} className="px-3 py-1 pl-4">
                  <div className="row gap-2">
                    <span className="mono min-w-0 flex-1 truncate text-ide-text" title={d.header}>
                      {d.header}
                    </span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${badge.cls}`}>{badge.label}</span>
                    {d.usedAt[0] && <SiteLink file={d.usedAt[0].file} line={d.usedAt[0].line} />}
                  </div>
                  {d.provider && (
                    <div className="text-[11px] text-ide-muted">
                      {d.provider}
                      {d.providerVersion ? ` ${d.providerVersion}` : ''}
                    </div>
                  )}
                </div>
              )
            })}
          </Section>

          {/* Updates: installed libraries with a newer version, with risk. */}
          <Section title="Updates" count={report.updates.length}>
            {report.updates.map((u) => (
              <div key={u.library} className="px-3 py-1 pl-4">
                <div className="row gap-2">
                  <ArrowUpCircle size={13} className="shrink-0 text-ide-accent" />
                  <span className="min-w-0 truncate text-ide-text">{u.library}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${RISK_CLS[u.risk]}`}>{u.risk}</span>
                  <button
                    className="btn shrink-0 whitespace-nowrap border border-ide-border text-[11px] disabled:opacity-40"
                    onClick={() => {
                      if (!running) void installLib(u.library, u.latest)
                    }}
                    disabled={running}
                    title={`Update to ${u.latest}`}
                  >
                    <Download size={12} /> {u.installed} to {u.latest}
                  </button>
                </div>
                <div className="text-[11px] text-ide-muted">{u.reason}</div>
              </div>
            ))}
          </Section>

          {report.incomplete && (
            <div className="px-3 py-1.5 text-[11px] text-ide-faint">
              Partial picture: the include scan was truncated or the installed libraries did not report which headers they
              provide, so some dependencies are unverified. A build gives the certain answer.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
