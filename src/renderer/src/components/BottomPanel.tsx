import { Terminal, Radio, AlertTriangle, X, Trash2 } from 'lucide-react'
import { useStore, type BottomView } from '../store/useStore'
import OutputConsole from './OutputConsole'
import SerialMonitor from './SerialMonitor'
import ProblemsPanel from './ProblemsPanel'

const TABS: { view: BottomView; icon: typeof Terminal; label: string }[] = [
  { view: 'output', icon: Terminal, label: 'Output' },
  { view: 'serial', icon: Radio, label: 'Serial Monitor' },
  { view: 'problems', icon: AlertTriangle, label: 'Problems' }
]

export default function BottomPanel(): JSX.Element {
  const { bottomView, setBottom, toggleBottom, clearOutput, clearSerial, diagnostics, bottomHeight } = useStore()
  const problemCount = diagnostics.length

  return (
    <div className="flex shrink-0 flex-col bg-ide-panel" style={{ height: bottomHeight }}>
      {/* A narrow panel must never make a tab unreachable. Without nowrap the
          "Serial Monitor" label wrapped to two lines and broke the bar height,
          and Problems was clipped away entirely at 1000px wide. */}
      <div className="cq row h-8 shrink-0 justify-between gap-1 border-b border-ide-border px-1">
        <div className="row h-full min-w-0 overflow-x-auto scrollbar-none">
          {TABS.map(({ view, icon: Icon, label }) => (
            <button
              key={view}
              onClick={() => setBottom(view)}
              title={label}
              className={`row h-full shrink-0 gap-1.5 whitespace-nowrap border-b-2 px-3 text-[12px] ${
                bottomView === view
                  ? 'border-ide-accent text-ide-text'
                  : 'border-transparent text-ide-muted hover:text-ide-text'
              }`}
            >
              <Icon size={14} className="shrink-0" />
              <span className="cq-label">{label}</span>
              {view === 'problems' && problemCount > 0 && (
                <span className="ml-0.5 rounded-full bg-ide-red/80 px-1.5 text-[10px] text-white">
                  {problemCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="row shrink-0 gap-0.5 pr-1 text-ide-muted">
          <button
            className="rounded p-1 hover:bg-ide-hover hover:text-ide-text"
            title="Clear"
            onClick={() => (bottomView === 'serial' ? clearSerial() : clearOutput())}
          >
            <Trash2 size={14} />
          </button>
          <button className="rounded p-1 hover:bg-ide-hover hover:text-ide-text" title="Close" onClick={toggleBottom}>
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {bottomView === 'output' && <OutputConsole />}
        {bottomView === 'serial' && <SerialMonitor />}
        {bottomView === 'problems' && <ProblemsPanel />}
      </div>
    </div>
  )
}
