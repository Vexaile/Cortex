import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { GitStatus, GitFileDiff, GitDiffKind } from '../../shared/ipc'
import { parsePorcelain } from '../../shared/gitStatus'
import { getWorkspaceRoot, withinWorkspace } from './fsService'
import { safeCommand, needsShell } from './commandResolver'

/**
 * Read-only git surface for the open workspace. Every git invocation goes
 * through execFile with an ARGUMENT ARRAY and NO SHELL, so a branch or file
 * name can never be interpreted as a command; git itself is resolved from PATH
 * via safeCommand (never the workspace, so a repo shipping a git.exe cannot
 * hijack it), and a git resolved to a .cmd/.bat shim is refused outright rather
 * than run through a shell (which would reintroduce argument injection via a
 * crafted path). Porcelain paths are repo-root-relative, so all commands run
 * with cwd at the repository top level and results are confined to the open
 * workspace. No mutating command is exposed - staging/commit/push come later.
 */

const execFileAsync = promisify(execFile)
const NOT_REPO: GitStatus = { isRepo: false, ahead: 0, behind: 0, files: [] }

/** Forward slashes for git rev:path specs, even on Windows. */
const gp = (p: string): string => p.replace(/\\/g, '/')

async function runGit(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  const bin = safeCommand('git', getWorkspaceRoot())
  // Only a real executable: a .cmd/.bat shim would need a shell, and a shell
  // would let a crafted path/branch inject a command. Refusing is safe-fail.
  if (!bin || needsShell(bin)) return { ok: false, stdout: '' }
  try {
    const { stdout } = await execFileAsync(bin, args, {
      cwd,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    })
    return { ok: true, stdout: stdout as string }
  } catch {
    // A non-zero exit (not a repo, path not in this ref, a lock, an overflow)
    // is an expected outcome, surfaced as ok:false rather than thrown.
    return { ok: false, stdout: '' }
  }
}

/** The repository top level containing the workspace, or null if not a repo. */
async function repoRoot(): Promise<string | null> {
  const ws = getWorkspaceRoot()
  if (!ws) return null
  const r = await runGit(ws, ['rev-parse', '--show-toplevel'])
  const top = r.ok ? r.stdout.trim() : ''
  return top || null
}

function gitRunnable(): boolean {
  const bin = safeCommand('git', getWorkspaceRoot())
  return !!bin && !needsShell(bin)
}

export async function status(): Promise<GitStatus> {
  const ws = getWorkspaceRoot()
  if (!ws) return NOT_REPO
  if (!gitRunnable()) return { isRepo: false, ahead: 0, behind: 0, files: [], error: 'git is not available on PATH.' }
  const root = await repoRoot()
  if (!root) return NOT_REPO // rev-parse said this is not a work tree
  // -uall lists untracked files individually so an untracked directory is not
  // collapsed to a single un-diffable "dir/" row.
  const res = await runGit(root, ['status', '--porcelain=v1', '-z', '--branch', '-uall'])
  if (!res.ok) return { isRepo: true, ahead: 0, behind: 0, files: [], error: 'Could not read git status.' }
  const parsed = parsePorcelain(res.stdout)
  // Porcelain paths are repo-root-relative; keep only those inside the open
  // workspace (which may be a subdirectory of the repo).
  const files = parsed.files.filter((f) => withinWorkspace(join(root, f.path)))
  return { isRepo: true, branch: parsed.branch, ahead: parsed.ahead, behind: parsed.behind, files }
}

/** Content of a repo-relative path at a git ref (`HEAD:p`, `:p` for the index),
 *  or '' when the path does not exist in that ref (a new or deleted file). */
async function showAt(root: string, spec: string): Promise<string> {
  const r = await runGit(root, ['show', spec])
  return r.ok ? r.stdout : ''
}

async function readWorking(abs: string): Promise<string> {
  try {
    return await readFile(abs, 'utf8')
  } catch {
    return '' // absent (deleted / never created)
  }
}

export async function fileDiff(relPath: string, kind: GitDiffKind, orig?: string): Promise<GitFileDiff | null> {
  const ws = getWorkspaceRoot()
  const bad = (s: unknown): boolean => typeof s !== 'string' || /[\r\n\0]/.test(s)
  if (!ws || bad(relPath) || (orig !== undefined && bad(orig))) return null
  const root = await repoRoot()
  if (!root) return null
  const abs = join(root, relPath)
  if (!withinWorkspace(abs)) return null
  // An untracked directory (should not occur with -uall) is not a file to diff.
  if (relPath.endsWith('/')) return { path: relPath, oldContent: '', newContent: '', binary: false, directory: true }

  let oldContent = ''
  let newContent = ''
  if (kind === 'untracked') {
    newContent = await readWorking(abs)
  } else if (kind === 'staged') {
    // The staged change: HEAD (or the rename's original path) vs the index.
    oldContent = await showAt(root, `HEAD:${gp(orig ?? relPath)}`)
    newContent = await showAt(root, `:${gp(relPath)}`)
  } else {
    // The unstaged change: the index vs the working tree.
    oldContent = await showAt(root, `:${gp(relPath)}`)
    newContent = await readWorking(abs)
  }
  const binary = oldContent.includes('\0') || newContent.includes('\0')
  return { path: relPath, oldContent: binary ? '' : oldContent, newContent: binary ? '' : newContent, binary }
}
