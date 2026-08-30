import { promises as fs } from 'fs'
import { join, basename, resolve } from 'path'
import chokidar, { FSWatcher } from 'chokidar'
import type { BrowserWindow } from 'electron'
import type { FileNode, FileReadResult } from '../../shared/ipc'
import { IPC } from '../../shared/ipc'
import { isWithin } from '../../shared/security'

const IGNORE = new Set(['node_modules', '.git', 'out', 'dist', 'release', '.cortex'])

// The currently open workspace. Renderer-initiated writes/deletes are confined
// to it so a compromised renderer cannot mutate arbitrary files on disk.
let workspaceRoot: string | null = null
export function setWorkspaceRoot(root: string): void {
  workspaceRoot = resolve(root)
}
export function getWorkspaceRoot(): string | null {
  return workspaceRoot
}
/** True when `p` is the open workspace or a path within it. Used to confine
 * renderer-supplied roots (LSP, etc.) the way file writes are confined. */
export function withinWorkspace(p: string): boolean {
  return !!workspaceRoot && isWithin(workspaceRoot, resolve(p))
}
function assertWithin(p: string): void {
  if (!workspaceRoot) return // no workspace open yet: nothing to confine against
  if (!isWithin(workspaceRoot, resolve(p))) {
    throw new Error(`Refused: path is outside the open workspace: ${p}`)
  }
}

/** Read a directory one level deep (lazy tree loading). */
export async function readDir(dirPath: string): Promise<FileNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const nodes: FileNode[] = entries
    .filter((e) => !IGNORE.has(e.name))
    .map((e) => ({
      name: e.name,
      path: join(dirPath, e.name),
      isDir: e.isDirectory()
    }))
  // Directories first, then alphabetical.
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

/** Anything larger opens as a placeholder: Monaco chokes and it is almost
 * certainly generated, not something you meant to edit. */
const MAX_EDITABLE_BYTES = 8 * 1024 * 1024

/**
 * Read a file for the editor, refusing binaries and oversized files.
 *
 * A plain utf8 read let `.bin`/`.elf`/`.o`/`.png` open as editable mojibake;
 * saving that tab re-encoded U+FFFD over the artifact and destroyed it. A NUL
 * byte anywhere is the standard binary heuristic (it is what git uses).
 *
 * The scan covers the WHOLE buffer, not a leading window: a PDF or tar whose
 * first pages are ASCII would otherwise pass the sniff and then be decoded
 * lossily. Reading once also avoids a stat/open race and cannot leak a handle.
 */
export async function readFile(filePath: string): Promise<FileReadResult> {
  const stat = await fs.stat(filePath)
  if (stat.size > MAX_EDITABLE_BYTES) return { kind: 'too-large', size: stat.size }
  const buf = await fs.readFile(filePath)
  if (buf.includes(0)) return { kind: 'binary' }
  return { kind: 'text', content: buf.toString('utf8') }
}

/**
 * Probe for optional files (a saved diagram, a project config) without going
 * through the throw path. Electron logs every rejected ipcMain.handle to
 * stderr, so "this workspace has no diagram yet" was printing an ENOENT stack
 * on every open, which is exactly the noise that hides real errors.
 */
export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/** Recursively list all file paths under root (for quick-open). Capped. */
export async function listAllFiles(root: string, cap = 8000): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    if (out.length >= cap) return
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full)
      } else if (e.isFile()) {
        // Only real files. A symlink is neither dir nor recursed here; following
        // it (stat/read) could escape the workspace, so it is skipped.
        out.push(full)
        if (out.length >= cap) return
      }
    }
  }
  await walk(root)
  return out
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  assertWithin(filePath)
  await fs.writeFile(filePath, content, 'utf8')
}

export async function createFile(filePath: string): Promise<void> {
  assertWithin(filePath)
  await fs.writeFile(filePath, '', { flag: 'wx' })
}

export async function createDir(dirPath: string): Promise<void> {
  assertWithin(dirPath)
  await fs.mkdir(dirPath, { recursive: true })
}

export async function rename(oldPath: string, newPath: string): Promise<void> {
  assertWithin(oldPath)
  assertWithin(newPath)
  await fs.rename(oldPath, newPath)
}

export async function remove(targetPath: string): Promise<void> {
  assertWithin(targetPath)
  await fs.rm(targetPath, { recursive: true, force: true })
}

// ---- file watching -------------------------------------------------------

let watcher: FSWatcher | null = null

export function startWatch(rootPath: string, win: BrowserWindow): void {
  setWorkspaceRoot(rootPath)
  stopWatch()
  watcher = chokidar.watch(rootPath, {
    // Match whole path SEGMENTS. A substring test silently unwatched output.cpp,
    // layout.h and distance.cpp, and killed the whole watcher for any workspace
    // whose path merely contained "dist".
    ignored: (p: string) => p.split(/[\\/]/).some((seg) => IGNORE.has(seg)),
    ignoreInitial: true,
    depth: 12,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 }
  })
  const emit = (type: string) => (path: string) => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.FS_EVENT, { type, path, name: basename(path) })
    }
  }
  watcher
    .on('add', emit('add'))
    .on('unlink', emit('unlink'))
    .on('addDir', emit('addDir'))
    .on('unlinkDir', emit('unlinkDir'))
    .on('change', emit('change'))
}

export function stopWatch(): void {
  if (watcher) {
    void watcher.close()
    watcher = null
  }
}
