import { useEffect, useState } from 'react'
import {
  Files,
  Search,
  Cpu,
  Library,
  Network,
  PackageCheck,
  Bug,
  Radio,
  Settings,
  CircuitBoard,
  MoreHorizontal,
  Terminal,
  AlertTriangle
} from 'lucide-react'
import { useStore, type SidebarView } from '../store/useStore'

type Item = { view: SidebarView; icon: typeof Files; label: string }

// Primary tools stay pinned in the rail: finding code, the hardware graph, the
// environment, the docs, and the wire - the surfaces used across a whole
// session. The occasional package-manager installers and the contextual
// debugger move into "More tools" so the rail is a short, scannable column
// rather than a wall of a dozen icons.
const PRIMARY: Item[] = [
  { view: 'explorer', icon: Files, label: 'Explorer' },
  { view: 'search', icon: Search, label: 'Search' },
  { view: 'hardware', icon: Network, label: 'Hardware' },
  { view: 'environment', icon: PackageCheck, label: 'Environment' },
  { view: 'serial', icon: Radio, label: 'Serial & Devices' }
]
const MORE: Item[] = [
  { view: 'boards', icon: Cpu, label: 'Boards Manager' },
  { view: 'libraries', icon: Library, label: 'Library Manager' },
  { view: 'debug', icon: Bug, label: 'Debug' }
]

export default function ActivityBar(): JSX.Element {
  const sidebarView = useStore((s) => s.sidebarView)
  const sidebarVisible = useStore((s) => s.sidebarVisible)
  const mainView = useStore((s) => s.mainView)
  const bottomView = useStore((s) => s.bottomView)
  const bottomVisible = useStore((s) => s.bottomVisible)
  const workspaceRoot = useStore((s) => s.workspaceRoot)
  const setSidebar = useStore((s) => s.setSidebar)
  const setMainView = useStore((s) => s.setMainView)
  const setBottom = useStore((s) => s.setBottom)
  const openTerminal = useStore((s) => s.openTerminal)
  const toggleBottom = useStore((s) => s.toggleBottom)

  const moreActive = MORE.some((m) => m.view === sidebarView) && sidebarVisible
  // Terminal only lives in the editor view; clicking it there toggles it.
  const terminalActive = bottomVisible && bottomView === 'terminal' && mainView === 'editor'
  // Mirror terminalActive's editor guard: the bottom dock is not rendered in the
  // simulator, so without it Problems would stay lit while hidden and need two
  // clicks (the first would toggleBottom() a dock that is not on screen).
  const problemsActive = bottomVisible && bottomView === 'problems' && mainView === 'editor'
  // Problems lives in the bottom dock, which only renders in the editor view, so
  // route through the editor first the way openTerminal already does.
  const showProblems = (): void => {
    if (problemsActive) toggleBottom()
    else {
      if (mainView === 'simulator') setMainView('editor')
      setBottom('problems')
    }
  }

  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => {
    if (!moreOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setMoreOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [moreOpen])

  const railButton = (active: boolean, label: string, Icon: typeof Files, onClick: () => void): JSX.Element => (
    <button
      key={label}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`relative flex h-11 w-full items-center justify-center transition-colors ${
        active ? 'text-ide-text' : 'text-ide-faint hover:text-ide-text'
      }`}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded bg-cortex-gradient-v" />}
      <Icon size={22} strokeWidth={1.6} />
    </button>
  )

  const divider = <div className="my-1.5 h-px w-6 shrink-0 bg-ide-border" />

  return (
    <div className="flex w-12 shrink-0 flex-col items-center border-r border-ide-border bg-ide-bar py-2">
      {PRIMARY.map(({ view, icon, label }) =>
        // No mainView gate: the sidebar renders beside the simulator too, so a
        // highlight tied to the editor would contradict the screen.
        railButton(sidebarVisible && sidebarView === view, label, icon, () => setSidebar(view))
      )}

      {/* More tools: the overflow the rail declutters into. Opens a labelled
          popover to the right; highlights when the tool you are in lives here. */}
      <div className="relative w-full">
        {railButton(moreActive || moreOpen, 'More tools', MoreHorizontal, () => setMoreOpen((o) => !o))}
        {moreOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
            <div
              role="menu"
              className="absolute left-full top-0 z-50 ml-1 w-52 rounded-md border border-ide-border bg-ide-panel py-1 shadow-xl"
            >
              <div className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-ide-faint">
                More tools
              </div>
              {MORE.map(({ view, icon: Icon, label }) => {
                const active = sidebarVisible && sidebarView === view
                return (
                  <button
                    key={view}
                    role="menuitem"
                    className={`row w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] hover:bg-ide-hover ${
                      active ? 'text-ide-text' : 'text-ide-muted'
                    }`}
                    onClick={() => {
                      setSidebar(view)
                      setMoreOpen(false)
                    }}
                  >
                    <Icon size={15} className={active ? 'text-ide-accent' : ''} />
                    {label}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      {divider}

      {/* The Simulator swaps the whole main view. The Agent and Datasheets are
          right-side tools now and live on the right-edge rail. */}
      {railButton(mainView === 'simulator', 'Simulator', CircuitBoard, () =>
        setMainView(mainView === 'simulator' ? 'editor' : 'simulator')
      )}

      <div className="flex-1" />

      {/* Bottom dock quick access: the tools you drop to while working. Shown
          only with a project open, since the dock renders only in the editor
          view of a workspace. Version Control is intentionally absent until
          there is a real Git surface (Phase 10) - a dead button would be worse
          than none. */}
      {workspaceRoot && (
        <>
          {railButton(terminalActive, 'Terminal', Terminal, () => (terminalActive ? toggleBottom() : openTerminal()))}
          {railButton(problemsActive, 'Problems', AlertTriangle, showProblems)}
          {divider}
        </>
      )}

      {railButton(sidebarVisible && sidebarView === 'settings', 'Settings', Settings, () => setSidebar('settings'))}
    </div>
  )
}
