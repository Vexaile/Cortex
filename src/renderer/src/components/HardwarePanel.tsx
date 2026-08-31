import { useMemo } from 'react'
import { Network, RefreshCw, Cpu } from 'lucide-react'
import { useStore } from '../store/useStore'
import { buildHardwareGraph, type HardwareGraph, type HwNode } from '@shared/hardwareGraph'
import PanelHeader from './PanelHeader'
import EmptyState from './EmptyState'

/**
 * The derived hardware view of the open project: board, recognized devices,
 * buses, and GPIO pins, each traceable back to the exact call site that put
 * it in the graph. Everything here is read from the source - nothing is
 * asked of the user and nothing is guessed (inferred bus attachments say so
 * and say why).
 */

function SiteLink({ file, line }: { file: string; line: number }): JSX.Element {
  // Selectors, not the bare store: one whole-store subscription per row would
  // re-render every row on every set(), including each serial-monitor chunk.
  const workspaceRoot = useStore((s) => s.workspaceRoot)
  const revealLocation = useStore((s) => s.revealLocation)
  const open = (): void => {
    if (!workspaceRoot) return
    const sep = workspaceRoot.includes('\\') ? '\\' : '/'
    // Trailing-separator strip: a drive-root workspace ("C:\") would
    // otherwise produce "C:\\src\..." and defeat the editor's tab dedupe.
    const root = workspaceRoot.replace(/[\\/]+$/, '')
    void revealLocation(`${root}${sep}${file.replace(/\//g, sep)}`, line, 1)
  }
  const base = file.split('/').pop()
  return (
    <button onClick={open} className="mono shrink-0 text-[10px] text-ide-faint hover:text-ide-cyan" title={`${file}:${line}`}>
      {base}:{line}
    </button>
  )
}

function NodeRow({ node, sites, note }: { node: HwNode; sites: Array<{ file: string; line: number }>; note?: string }): JSX.Element {
  return (
    <div className="px-3 py-1 pl-6">
      <div className="row gap-2">
        <span className="min-w-0 truncate text-ide-text">{node.label}</span>
        {sites[0] && <SiteLink file={sites[0].file} line={sites[0].line} />}
      </div>
      {node.detail && <div className="truncate text-[11px] text-ide-muted">{node.detail}</div>}
      {note && <div className="text-[11px] text-ide-faint">{note}</div>}
    </div>
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

function sitesFor(graph: HardwareGraph, nodeId: string): Array<{ file: string; line: number }> {
  return graph.edges
    .filter((e) => e.to === nodeId && e.file != null && e.line != null)
    .map((e) => ({ file: e.file!, line: e.line! }))
}

export default function HardwarePanel(): JSX.Element {
  const projectModel = useStore((s) => s.projectModel)
  const refreshProjectModel = useStore((s) => s.refreshProjectModel)
  const graph = useMemo(() => (projectModel ? buildHardwareGraph(projectModel) : null), [projectModel])

  const board = graph?.nodes.find((n) => n.kind === 'board')
  const devices = graph?.nodes.filter((n) => n.kind === 'device') ?? []
  const buses = graph?.nodes.filter((n) => n.kind === 'bus') ?? []
  const pins = graph?.nodes.filter((n) => n.kind === 'pin') ?? []
  // A found board or a truncated scan still deserves the full view: hiding a
  // detected board behind "Nothing detected", or claiming nothing exists when
  // the scan gave up early, would both be lies of omission.
  const empty = !graph || (!board && !graph.incomplete && devices.length + buses.length + pins.length === 0)

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        icon={<Network size={13} />}
        actions={
          <button
            title="Rescan project"
            onClick={() => void refreshProjectModel()}
            className="rounded p-1 hover:bg-ide-hover hover:text-ide-text"
          >
            <RefreshCw size={13} />
          </button>
        }
      >
        Hardware
      </PanelHeader>

      {empty ? (
        <EmptyState icon={<Network size={22} />}>
          Nothing detected yet. Pins, buses, and known devices found in this project&apos;s source appear here.
        </EmptyState>
      ) : (
        <div className="flex-1 overflow-auto py-1 text-[12.5px]">
          {board && (
            <div className="row gap-2 px-3 py-1.5">
              <Cpu size={14} className="shrink-0 text-ide-muted" />
              <span className="text-ide-text">{board.label}</span>
              {board.detail && <span className="truncate text-[11px] text-ide-muted">{board.detail}</span>}
            </div>
          )}
          {!board && (
            <div className="px-3 py-1.5 text-[11px] text-ide-faint">
              No board configured (no platformio.ini found).
            </div>
          )}

          <Section title="Devices" count={devices.length}>
            {devices.map((d) => (
              <NodeRow
                key={d.id}
                node={d}
                sites={sitesFor(graph!, d.id)}
                note={graph!.edges.find((e) => e.from === d.id && e.relation === 'likely-on-bus')?.note}
              />
            ))}
          </Section>

          <Section title="Buses" count={buses.length}>
            {buses.map((b) => (
              <NodeRow key={b.id} node={b} sites={sitesFor(graph!, b.id)} />
            ))}
          </Section>

          <Section title="Pins" count={pins.length}>
            {pins.map((p) => (
              <NodeRow key={p.id} node={p} sites={sitesFor(graph!, p.id)} />
            ))}
          </Section>

          {graph!.incomplete && (
            <div className="px-3 py-1.5 text-[11px] text-ide-faint">
              Partial scan: the project is larger than the scan cap, so this list is a sample.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
