import FileExplorer from './FileExplorer'
import SearchPanel from './SearchPanel'
import BoardsManagerPanel from './BoardsManagerPanel'
import LibraryManagerPanel from './LibraryManagerPanel'
import DebugPanel from './DebugPanel'
import DevicesPanel from './DevicesPanel'
import SettingsPanel from './SettingsPanel'
import { useStore } from '../store/useStore'

export default function SideBar(): JSX.Element {
  const view = useStore((s) => s.sidebarView)
  const width = useStore((s) => s.sidebarWidth)

  return (
    <div className="flex shrink-0 flex-col bg-ide-panel" style={{ width }}>
      {view === 'explorer' && <FileExplorer />}
      {view === 'search' && <SearchPanel />}
      {view === 'boards' && <BoardsManagerPanel />}
      {view === 'libraries' && <LibraryManagerPanel />}
      {view === 'debug' && <DebugPanel />}
      {view === 'serial' && <DevicesPanel />}
      {view === 'settings' && <SettingsPanel />}
    </div>
  )
}
