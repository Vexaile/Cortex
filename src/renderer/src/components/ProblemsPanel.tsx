import { AlertCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import EmptyState from './EmptyState'
import type { Diagnostic } from '@shared/ipc'

const baseName = (p: string): string => p.split(/[\\/]/).pop() || p

function SeverityIcon({ severity }: { severity: Diagnostic['severity'] }): JSX.Element {
  if (severity === 'error') return <AlertCircle size={14} className="shrink-0 text-ide-red" />
  if (severity === 'warning') return <AlertTriangle size={14} className="shrink-0 text-ide-yellow" />
  return <Info size={14} className="shrink-0 text-ide-muted" />
}

export default function ProblemsPanel(): JSX.Element {
  const { diagnostics, revealLocation } = useStore()

  if (diagnostics.length === 0) {
    return (
      <EmptyState icon={<CheckCircle2 size={22} />}>
        No problems detected. Compiler errors and warnings appear here after a build.
      </EmptyState>
    )
  }

  // Group by file, preserving first-seen order.
  const groups = new Map<string, Diagnostic[]>()
  for (const d of diagnostics) {
    if (!groups.has(d.file)) groups.set(d.file, [])
    groups.get(d.file)!.push(d)
  }

  return (
    <div className="h-full overflow-auto py-1 text-[12.5px]">
      {[...groups.entries()].map(([file, items]) => (
        <div key={file}>
          <div className="row gap-1.5 px-3 py-1 text-[11px] font-medium text-ide-muted">
            {baseName(file)} <span className="text-ide-faint">· {items.length}</span>
          </div>
          {items.map((d, i) => (
            <button
              key={`${file}:${d.line}:${d.column}:${i}`}
              onClick={() => void revealLocation(d.file, d.line, d.column)}
              className="row w-full gap-2 px-3 py-1 pl-6 text-left hover:bg-ide-hover"
            >
              <SeverityIcon severity={d.severity} />
              <span className="min-w-0 flex-1 truncate text-ide-text">{d.message}</span>
              {d.code && <span className="mono shrink-0 text-[10px] text-ide-faint">{d.code}</span>}
              <span className="mono shrink-0 text-[10px] text-ide-faint">
                {d.line}:{d.column}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
