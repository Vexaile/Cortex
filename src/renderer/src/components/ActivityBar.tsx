import { Files, Search, Cpu, Library, Network, Bug, Radio, Sparkles, Settings, CircuitBoard } from 'lucide-react'
import { useStore, type SidebarView } from '../store/useStore'

// The sidebar rail, in the order a first-time user meets the work: find code,
// get the hardware set up (boards + libraries), debug it, watch the wire.
const ITEMS: { view: SidebarView; icon: typeof Files; label: string }[] = [
  { view: 'explorer', icon: Files, label: 'Explorer' },
  { view: 'search', icon: Search, label: 'Search' },
  { view: 'boards', icon: Cpu, label: 'Boards Manager' },
  { view: 'libraries', icon: Library, label: 'Library Manager' },
  { view: 'hardware', icon: Network, label: 'Hardware' },
  { view: 'debug', icon: Bug, label: 'Debug' },
  { view: 'serial', icon: Radio, label: 'Serial & Devices' }
]

export default function ActivityBar(): JSX.Element {
  const { sidebarView, sidebarVisible, mainView, aiVisible, setSidebar, setMainView, toggleAi } = useStore()

  const railButton = (
    active: boolean,
    label: string,
    Icon: typeof Files,
    onClick: () => void
  ): JSX.Element => (
    <button
      key={label}
      title={label}
      onClick={onClick}
      className={`relative flex h-11 w-full items-center justify-center transition-colors ${
        active ? 'text-ide-text' : 'text-ide-faint hover:text-ide-text'
      }`}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded bg-cortex-gradient-v" />}
      <Icon size={22} strokeWidth={1.6} />
    </button>
  )

  return (
    <div className="flex w-12 flex-col items-center border-r border-ide-border bg-ide-bar py-2">
      {ITEMS.map(({ view, icon, label }) =>
        // No mainView gate: the sidebar renders beside the simulator too, so a
        // highlight tied to the editor would contradict the screen.
        railButton(sidebarVisible && sidebarView === view, label, icon, () => setSidebar(view))
      )}

      {/* Simulator switches the whole main view */}
      {railButton(mainView === 'simulator', 'Simulator', CircuitBoard, () =>
        setMainView(mainView === 'simulator' ? 'editor' : 'simulator')
      )}

      {/* aiVisible is live state (sending a chat sets it), so without this the
          panel could be open while its icon still read as off. */}
      {railButton(aiVisible, 'AI Assistant', Sparkles, toggleAi)}

      <div className="flex-1" />

      {railButton(sidebarVisible && sidebarView === 'settings', 'Settings', Settings, () => setSidebar('settings'))}
    </div>
  )
}
