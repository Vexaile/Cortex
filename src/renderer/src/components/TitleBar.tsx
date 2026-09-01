import { Cpu, Search, Settings, Sparkles } from 'lucide-react'
import { useStore } from '../store/useStore'
import MenuBar from './MenuBar'
import FileIcon from './FileIcon'

/**
 * The slim window chrome: app mark, the menu bar, the project / file
 * breadcrumb, and a right-side cluster of global actions (Search, Settings,
 * Cortex Agent). The run/build/board/serial controls live on the Toolbar row
 * below, so the title bar is no longer overloaded. Every control here maps to
 * a real action; anything without a backing feature (e.g. notifications) is
 * omitted rather than shown dead.
 */
export default function TitleBar(): JSX.Element {
  const workspaceName = useStore((s) => s.workspaceName)
  const tabs = useStore((s) => s.tabs)
  const activePath = useStore((s) => s.activePath)
  const setSidebar = useStore((s) => s.setSidebar)
  const toggleAi = useStore((s) => s.toggleAi)
  const sidebarVisible = useStore((s) => s.sidebarVisible)
  const sidebarView = useStore((s) => s.sidebarView)
  const aiVisible = useStore((s) => s.aiVisible)

  const activeTab = tabs.find((t) => t.path === activePath)
  const settingsActive = sidebarVisible && sidebarView === 'settings'

  const iconBtn = (active: boolean): string =>
    `no-drag grid h-6 w-6 place-items-center rounded transition-colors ${
      active ? 'bg-ide-hover text-ide-text' : 'text-ide-muted hover:bg-ide-hover hover:text-ide-text'
    }`

  return (
    <div className="drag flex h-9 items-center gap-2 border-b border-ide-border bg-ide-bar px-2 text-[12px]">
      <div className="row gap-1.5 pl-1 font-semibold">
        <div className="grid h-5 w-5 place-items-center rounded-md bg-cortex-gradient">
          <Cpu size={12} className="text-white" />
        </div>
        {/* Solid text: gradient-clipped text at 12px is unreadable and its
            middle third fails contrast. The gradient lives on the mark. */}
        <span className="text-ide-text">Cortex</span>
      </div>

      {/* File / Edit / Sketch / Tools / Help. Open/Save moved into File. */}
      <MenuBar />

      {workspaceName && (
        <span className="row min-w-0 gap-1.5">
          {/* Theme token, not text-white: on the bar surface white is invisible
              in Cortex Light. Matches the "Cortex" wordmark above. */}
          <span className="truncate text-ide-text">
            {workspaceName}
            {activeTab && <span> / {activeTab.name}</span>}
          </span>
          {activeTab && <FileIcon path={activeTab.path} size={13} />}
        </span>
      )}

      <div className="flex-1" />

      {/* Global actions. Search opens the command palette; Settings and Agent
          mirror the activity rail and highlight when their surface is open. */}
      <div className="no-drag flex shrink-0 items-center gap-0.5">
        <button
          className={iconBtn(false)}
          onClick={() => window.dispatchEvent(new CustomEvent('cortex:palette', { detail: 'commands' }))}
          title="Search commands (Ctrl+Shift+P)"
        >
          <Search size={15} />
        </button>
        <button className={iconBtn(settingsActive)} onClick={() => setSidebar('settings')} title="Settings (Ctrl+,)">
          <Settings size={15} />
        </button>
        <button className={iconBtn(aiVisible)} onClick={toggleAi} title="Cortex Agent">
          <Sparkles size={15} />
        </button>
      </div>
    </div>
  )
}
