import { X, Circle, FileCode2, FileWarning } from 'lucide-react'
import { useStore } from '../store/useStore'
import CodeEditor from './CodeEditor'
import EmptyState from './EmptyState'
import FileIcon from './FileIcon'

export default function EditorArea(): JSX.Element {
  const { tabs, activePath, setActive, closeTab } = useStore()
  const activeTab = tabs.find((t) => t.path === activePath)

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-ide-bg">
      {/* Tab bar */}
      <div className="row h-9 shrink-0 overflow-x-auto border-b border-ide-border bg-ide-panel">
        {tabs.map((tab) => {
          const active = tab.path === activePath
          const dirty = tab.content !== tab.savedContent
          return (
            // The tab is a wrapper, not the control: the selectable part and
            // the close button are siblings. Making the whole tab a <button>
            // would nest the close button inside it, which is invalid HTML and
            // is why this was a click-only <div> that Tab could never reach.
            <div
              key={tab.path}
              className={`row group relative h-full min-w-0 max-w-[200px] border-r border-ide-border pr-2 text-[12px] ${
                active ? 'bg-ide-bg text-ide-text' : 'text-ide-muted hover:bg-ide-hover'
              }`}
            >
              {/* A real selected-tab indicator; a 5-unit bg shift is not one. */}
              {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-ide-accent" />}
              <button
                type="button"
                onClick={() => setActive(tab.path)}
                title={tab.path}
                className="row h-full min-w-0 flex-1 cursor-pointer gap-1.5 pl-3 pr-1 text-left"
              >
                <span className="flex shrink-0 items-center">
                  <FileIcon path={tab.path} size={13} />
                </span>
                <span className="truncate">{tab.name}</span>
              </button>
              {/* The unsaved marker must always be visible (it was hover-only, so a
                  dirty tab looked identical to a saved one). Swap to X on hover. */}
              <button
                type="button"
                onClick={() => closeTab(tab.path)}
                title={dirty ? 'Unsaved changes. Click to close' : 'Close'}
                className="shrink-0 rounded p-0.5 text-ide-faint hover:bg-ide-hover hover:text-ide-text"
              >
                {dirty ? (
                  <>
                    <Circle size={9} className="fill-ide-amber text-ide-amber group-hover:hidden" />
                    <X size={14} className="hidden group-hover:block" />
                  </>
                ) : (
                  <X size={14} className="opacity-0 group-hover:opacity-100" />
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* Editor surface */}
      <div className="min-h-0 flex-1">
        {activePath && activeTab?.readOnlyReason ? (
          // Never mount Monaco for a binary/oversized file: a tab with no editor
          // cannot be dirtied, so it can never be saved back over the original.
          <EmptyState icon={<FileWarning size={24} />}>
            {activeTab.readOnlyReason}
            <div className="mt-1 text-[11px] text-ide-faint">{activeTab.name}</div>
          </EmptyState>
        ) : activePath ? (
          <CodeEditor path={activePath} />
        ) : (
          <EmptyState icon={<FileCode2 size={24} />}>
            Select a file in the Explorer to start editing, or press Ctrl+P to search by name.
          </EmptyState>
        )}
      </div>
    </div>
  )
}
