import { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, RefreshCw, FilePlus, FolderPlus } from 'lucide-react'
import { useStore } from '../store/useStore'
import PanelHeader from './PanelHeader'
import EmptyState from './EmptyState'
import type { FileNode } from '@shared/ipc'
import { langFromPath } from '@shared/languages'

const parentDir = (p: string): string => p.replace(/[\\/][^\\/]+$/, '')

function FileIcon({ node }: { node: FileNode }): JSX.Element {
  // Folders already show a chevron for expand state; a second arrow here read as
  // a duplicate. Use a folder glyph instead, and a language-colored dot for files.
  if (node.isDir) return <Folder size={14} className="text-ide-amber" />
  const color = langFromPath(node.path).color
  return <span style={{ color }}>●</span>
}

type OnContext = (x: number, y: number, node: FileNode) => void

function TreeRow({ node, depth, onContext }: { node: FileNode; depth: number; onContext: OnContext }): JSX.Element {
  const { expanded, childrenCache, toggleDir, openFile, activePath } = useStore()
  const isOpen = expanded.has(node.path)
  const isActive = activePath === node.path
  const children = childrenCache[node.path]

  const onClick = (): void => {
    if (node.isDir) void toggleDir(node)
    else void openFile(node.path)
  }

  return (
    <>
      {/* A real button, not a click-only div: this is the primary open-file
          action and it was unreachable by keyboard, and the shared focus ring
          in styles/index.css only matches real controls. */}
      <button
        type="button"
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onContext(e.clientX, e.clientY, node)
        }}
        title={node.path}
        className={`row h-[24px] w-full cursor-pointer select-none gap-1 pr-2 text-left text-[13px] hover:bg-ide-hover ${
          isActive ? 'bg-ide-active' : ''
        }`}
        style={{ paddingLeft: depth * 12 + 6 }}
      >
        {node.isDir ? (
          isOpen ? (
            <ChevronDown size={14} className="text-ide-muted" />
          ) : (
            <ChevronRight size={14} className="text-ide-muted" />
          )
        ) : (
          <span className="w-[14px]" />
        )}
        <span className="w-3 text-center text-[10px]">
          <FileIcon node={node} />
        </span>
        <span className="truncate">{node.name}</span>
      </button>
      {node.isDir &&
        isOpen &&
        children?.map((child) => <TreeRow key={child.path} node={child} depth={depth + 1} onContext={onContext} />)}
    </>
  )
}

interface DialogState {
  mode: 'rename' | 'newFile' | 'newFolder'
  dir: string
  path?: string
  value: string
}

export default function FileExplorer(): JSX.Element {
  const {
    tree,
    workspaceName,
    workspaceRoot,
    refreshTree,
    openWorkspace,
    renameEntry,
    deleteEntry,
    createNewFile,
    createNewFolder
  } = useStore()
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)

  useEffect(() => {
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const handleOpen = async (): Promise<void> => {
    const dir = await window.api.openFolder()
    if (dir) await openWorkspace(dir)
  }

  const dirOf = (node: FileNode | null): string =>
    node ? (node.isDir ? node.path : parentDir(node.path)) : workspaceRoot || ''

  const submitDialog = async (): Promise<void> => {
    if (!dialog || !dialog.value.trim()) return setDialog(null)
    const name = dialog.value.trim()
    if (dialog.mode === 'newFile') await createNewFile(dialog.dir, name)
    else if (dialog.mode === 'newFolder') await createNewFolder(dialog.dir, name)
    else if (dialog.mode === 'rename' && dialog.path) await renameEntry(dialog.path, name)
    setDialog(null)
  }

  const menuActions = menu
    ? [
        { label: 'New File', run: () => setDialog({ mode: 'newFile', dir: dirOf(menu.node), value: '' }) },
        { label: 'New Folder', run: () => setDialog({ mode: 'newFolder', dir: dirOf(menu.node), value: '' }) },
        {
          label: 'Rename',
          run: () => setDialog({ mode: 'rename', dir: parentDir(menu.node.path), path: menu.node.path, value: menu.node.name })
        },
        {
          label: 'Delete',
          run: () => {
            if (window.confirm(`Delete ${menu.node.name}? This cannot be undone.`)) void deleteEntry(menu.node.path)
          }
        },
        { label: 'Copy Path', run: () => void navigator.clipboard?.writeText(menu.node.path) }
      ]
    : []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        actions={
          <>
            <button
              className="rounded p-1 hover:bg-ide-hover hover:text-ide-text"
              onClick={() => workspaceRoot && setDialog({ mode: 'newFile', dir: workspaceRoot, value: '' })}
              title="New file"
            >
              <FilePlus size={14} />
            </button>
            <button
              className="rounded p-1 hover:bg-ide-hover hover:text-ide-text"
              onClick={() => workspaceRoot && setDialog({ mode: 'newFolder', dir: workspaceRoot, value: '' })}
              title="New folder"
            >
              <FolderPlus size={14} />
            </button>
            <button
              className="rounded p-1 hover:bg-ide-hover hover:text-ide-text"
              onClick={async () => {
                setBusy(true)
                await refreshTree()
                setBusy(false)
              }}
              title="Refresh"
            >
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
            </button>
          </>
        }
      >
        {workspaceName || 'Explorer'}
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {tree.length === 0 ? (
          <EmptyState
            icon={<FolderOpen size={22} />}
            action={
              <button className="btn border border-ide-border text-[12px]" onClick={handleOpen}>
                <FolderOpen size={14} /> Open folder
              </button>
            }
          >
            No folder is open.
          </EmptyState>
        ) : (
          tree.map((node) => <TreeRow key={node.path} node={node} depth={0} onContext={(x, y, n) => setMenu({ x, y, node: n })} />)
        )}
      </div>

      {/* context menu */}
      {menu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-md border border-ide-border bg-ide-bar py-1 text-[12px] shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menuActions.map((a) => (
            <button
              key={a.label}
              className={`block w-full px-3 py-1 text-left hover:bg-ide-hover ${a.label === 'Delete' ? 'text-ide-red' : ''}`}
              onClick={() => {
                a.run()
                setMenu(null)
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* input dialog (replaces window.prompt) */}
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-32" onClick={() => setDialog(null)}>
          <div className="w-96 rounded-lg border border-ide-border bg-ide-panel p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-[12px] font-medium text-ide-text">
              {dialog.mode === 'rename' ? 'Rename' : dialog.mode === 'newFile' ? 'New file' : 'New folder'}
            </div>
            <input
              autoFocus
              className="mono w-full rounded bg-ide-bg px-2 py-1.5 text-[13px] outline-none focus:ring-1 focus:ring-ide-accent"
              value={dialog.value}
              onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitDialog()
                if (e.key === 'Escape') setDialog(null)
              }}
            />
            <div className="mt-3 row justify-end gap-2">
              <button className="btn text-[12px]" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button className="btn btn-accent text-[12px]" onClick={() => void submitDialog()}>
                {dialog.mode === 'rename' ? 'Rename' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
