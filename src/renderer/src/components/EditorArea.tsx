import { useRef, useState } from 'react'
import { X, FileCode2, FileWarning } from 'lucide-react'
import { useStore } from '../store/useStore'
import CodeEditor from './CodeEditor'
import EmptyState from './EmptyState'
import FileIcon from './FileIcon'
import Splitter from './Splitter'

// The tab being dragged, for the brief span of a drag. dataTransfer carries the
// same path and is the source of truth on drop; this is only so a pane can show
// its drop overlay during dragover (where dataTransfer.getData is unreadable).
let dragPath: string | null = null

const MIN_RATIO = 0.2
const MAX_RATIO = 0.8

export default function EditorArea(): JSX.Element {
  const tabs = useStore((s) => s.tabs)
  const activeGroup = useStore((s) => s.activeGroup)
  const groupActive = useStore((s) => s.groupActive)
  const setActiveInGroup = useStore((s) => s.setActiveInGroup)
  const focusGroup = useStore((s) => s.focusGroup)
  const closeTab = useStore((s) => s.closeTab)
  const moveTabToGroup = useStore((s) => s.moveTabToGroup)
  const reorderTab = useStore((s) => s.reorderTab)

  const split = tabs.some((t) => t.group === 1)
  const [dragActive, setDragActive] = useState(false)
  const [dropZone, setDropZone] = useState<{ group: number; half: 'left' | 'right' } | null>(null)
  const [ratio, setRatio] = useState(0.5)
  const containerRef = useRef<HTMLDivElement>(null)

  const endDrag = (): void => {
    dragPath = null
    setDragActive(false)
    setDropZone(null)
  }

  // Splitting needs at least two tabs in the source pane: moving the only tab
  // to a new group just collapses straight back, so a single tab offers no split.
  const canSplit = !split && tabs.filter((t) => t.group === 0).length > 1

  const onPaneDrop = (group: number, half: 'left' | 'right'): void => {
    const path = dragPath
    endDrag()
    if (!path) return
    // Before a split exists, the drop half picks the destination: the right half
    // splits to a new right pane (only when there is a tab to spare), left half
    // stays. Once split, dropping onto a pane moves the tab into that pane's group.
    const target = split ? group : half === 'right' && canSplit ? 1 : 0
    moveTabToGroup(path, target)
  }

  const onTabStripDrop = (group: number, index: number, after: boolean): void => {
    const path = dragPath
    endDrag()
    if (!path) return
    const dragged = tabs.find((t) => t.path === path)
    if (!dragged) return
    if (dragged.group !== group) {
      moveTabToGroup(path, group) // cross-group: lands in the other pane (reorder there is a later refinement)
      return
    }
    // Insert before or after the dropped-on tab based on the pointer. Removing
    // the dragged tab first shifts every position after it, so drop one earlier
    // when the tab was to the left of the target.
    const siblings = tabs.filter((t) => t.group === group)
    const fromIdx = siblings.findIndex((t) => t.path === path)
    let target = index + (after ? 1 : 0)
    if (fromIdx > -1 && fromIdx < target) target -= 1
    reorderTab(path, target)
  }

  const onSplitterDelta = (delta: number): void => {
    const w = containerRef.current?.clientWidth ?? 0
    if (!w) return
    setRatio((r) => Math.max(MIN_RATIO, Math.min(MAX_RATIO, r + delta / w)))
  }

  const pane = (group: number): JSX.Element => {
    const groupTabs = tabs.filter((t) => t.group === group)
    const paneActivePath = groupActive[group] ?? null
    const paneActiveTab = groupTabs.find((t) => t.path === paneActivePath)
    const focused = activeGroup === group

    return (
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-ide-bg"
        style={split && group === 0 ? { flex: `0 0 ${ratio * 100}%` } : undefined}
        onMouseDownCapture={() => {
          if (!focused) focusGroup(group)
        }}
      >
        {/* Tab strip */}
        <div className="row h-9 shrink-0 overflow-x-auto border-b border-ide-border bg-ide-panel">
          {groupTabs.map((tab, index) => {
            const active = tab.path === paneActivePath
            const dirty = tab.content !== tab.savedContent
            return (
              <div
                key={tab.path}
                draggable
                onDragStart={(e) => {
                  dragPath = tab.path
                  setDragActive(true)
                  e.dataTransfer.effectAllowed = 'move'
                  // A custom mime, NOT text/plain: Monaco's drop-into-editor
                  // reacts to text/plain and would paste the file path into the
                  // document when a tab is dropped onto an editor pane.
                  e.dataTransfer.setData('application/x-cortex-tab', tab.path)
                }}
                onDragEnd={endDrag}
                onDragOver={(e) => {
                  if (dragPath) e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const rect = e.currentTarget.getBoundingClientRect()
                  const after = e.clientX - rect.left > rect.width / 2
                  onTabStripDrop(group, index, after)
                }}
                className={`row group relative h-full min-w-0 max-w-[200px] shrink-0 cursor-grab border-r border-ide-border pr-2 text-[12px] transition-colors ${
                  active ? 'bg-ide-bg text-ide-text' : 'text-ide-muted hover:bg-ide-hover'
                }`}
              >
                {/* Selected-tab indicator: the accent bar on the focused pane, a
                    muted bar on the unfocused one, so it is clear which pane has focus. */}
                {active && (
                  <span className={`absolute inset-x-0 top-0 h-0.5 ${focused ? 'bg-ide-accent' : 'bg-ide-faint'}`} />
                )}
                <button
                  type="button"
                  onClick={() => setActiveInGroup(group, tab.path)}
                  title={tab.path}
                  className="row h-full min-w-0 flex-1 cursor-pointer gap-1.5 pl-3 pr-1 text-left"
                >
                  <span className="flex shrink-0 items-center">
                    <FileIcon path={tab.path} size={13} />
                  </span>
                  <span className="truncate">{tab.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => closeTab(tab.path)}
                  title={dirty ? 'Unsaved changes. Click to close' : 'Close'}
                  className="shrink-0 rounded p-0.5 text-ide-faint hover:bg-ide-hover hover:text-ide-text"
                >
                  {/* No unsaved dot next to the tab (removed by the user's
                      request); dirtiness is conveyed by the title only. */}
                  <X size={14} className="opacity-0 group-hover:opacity-100" />
                </button>
              </div>
            )
          })}
          {/* Dropping onto the empty strip area appends to this group. */}
          <div
            className="min-w-8 flex-1"
            onDragOver={(e) => {
              if (dragPath) e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              // The empty strip area means "move to the end of this group".
              onTabStripDrop(group, Math.max(0, groupTabs.length - 1), true)
            }}
          />
        </div>

        {/* Editor surface, with a split/move drop overlay while dragging a tab. */}
        <div
          className="relative min-h-0 flex-1"
          onDragOver={(e) => {
            if (!dragPath) return
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            const half: 'left' | 'right' = e.clientX - rect.left > rect.width / 2 ? 'right' : 'left'
            setDropZone((z) => (z && z.group === group && z.half === half ? z : { group, half }))
          }}
          onDragLeave={(e) => {
            // Only clear when the pointer actually left this element, not a child.
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDropZone((z) => (z?.group === group ? null : z))
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            const half: 'left' | 'right' = e.clientX - rect.left > rect.width / 2 ? 'right' : 'left'
            onPaneDrop(group, half)
          }}
        >
          {paneActiveTab?.readOnlyReason ? (
            <EmptyState icon={<FileWarning size={24} />}>
              {paneActiveTab.readOnlyReason}
              <div className="mt-1 text-[11px] text-ide-faint">{paneActiveTab.name}</div>
            </EmptyState>
          ) : paneActivePath ? (
            <CodeEditor path={paneActivePath} />
          ) : (
            <EmptyState icon={<FileCode2 size={24} />}>
              Select a file in the Explorer to start editing, or press Ctrl+P to search by name.
            </EmptyState>
          )}

          {dragActive && dropZone?.group === group && (split || canSplit) && (
            // Accent-tinted drop target. When already split, the whole pane
            // highlights (drop here to move the tab into this pane). On the
            // single pane, only the half the tab will land in highlights, so
            // the right half reads as "split to the right" (shown only when
            // there is more than one tab, so the affordance is never a no-op).
            <div className="pointer-events-none absolute inset-0 z-20">
              {split ? (
                <div className="absolute inset-0 bg-ide-accent/15 outline outline-1 -outline-offset-1 outline-ide-accent transition-all duration-150" />
              ) : (
                <div
                  className="absolute inset-y-0 bg-ide-accent/15 outline outline-1 -outline-offset-1 outline-ide-accent transition-all duration-150"
                  style={dropZone.half === 'right' ? { left: '50%', right: 0 } : { left: 0, right: '50%' }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (tabs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-ide-bg">
        <div className="h-9 shrink-0 border-b border-ide-border bg-ide-panel" />
        <div className="min-h-0 flex-1">
          <EmptyState icon={<FileCode2 size={24} />}>
            Select a file in the Explorer to start editing, or press Ctrl+P to search by name.
          </EmptyState>
        </div>
      </div>
    )
  }

  return (
    // Plain flex (align-items: stretch), not the `row` utility, so the panes
    // fill the full height instead of centering.
    <div ref={containerRef} className="flex min-h-0 flex-1">
      {pane(0)}
      {split && <Splitter dir="x" title="Resize editor split" onDelta={onSplitterDelta} />}
      {split && pane(1)}
    </div>
  )
}
