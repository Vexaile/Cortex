import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { GitStatus, GitFileDiff, GitDiffKind, GitOpResult } from '../../shared/ipc'
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
  return {
    isRepo: true,
    branch: parsed.branch,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    files
  }
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

// ---- mutations (stage / unstage / commit) ---------------------------------

/** Run a mutating git command; on failure lift git's own stderr as the error,
 *  first line only and length-capped, so the panel can show it honestly. */
async function runMutation(cwd: string, args: string[]): Promise<GitOpResult> {
  const bin = safeCommand('git', getWorkspaceRoot())
  if (!bin || needsShell(bin)) return { ok: false, error: 'git is not available on PATH.' }
  try {
    await execFileAsync(bin, args, {
      cwd,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      // Fail fast instead of blocking the whole panel forever: a stalled network
      // push, or a credential/askpass GUI, would otherwise hang the child (busy
      // stays set). GIT_TERMINAL_PROMPT=0 stops git's own terminal prompt; the
      // timeout backstops the cases it does not cover.
      timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    return { ok: true }
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; killed?: boolean; signal?: string }
    if (err?.killed || err?.signal) return { ok: false, error: 'git timed out (60s) - check the network or remote.' }
    // git writes its real reason to stderr OR (for `commit` with nothing to
    // commit) to stdout. Deliberately NEVER fall back to Node's e.message: it is
    // "Command failed: <absolute git.exe path> commit -m <the message>", which
    // leaks the binary path and the user's commit text and is not git's reason.
    const lines = (s: unknown): string[] =>
      String(s ?? '').split('\n').map((x) => x.trim()).filter((x) => x.length > 0 && !x.startsWith('Command failed'))
    const stderr = lines(err?.stderr)
    const stdout = lines(err?.stdout)
    // Prefer the actual reason. A rejected push leads with "To <remote>" (an
    // unhelpful header that also spells out the remote path), so skip it and
    // pick the fatal/error/rejected/hint line; a `commit` with nothing to do
    // prints only to stdout, where the reason is the last line after "On branch".
    const reason =
      stderr.find((l) => /\[rejected\]|\[remote rejected\]|^error:|^fatal:|^hint:|^remote:/.test(l)) ||
      stderr.find((l) => !l.startsWith('To ')) ||
      stderr[0]
    const msg = reason || stdout[stdout.length - 1] || 'git command failed.'
    return { ok: false, error: msg.slice(0, 300) }
  }
}

/** Validate and normalize a caller-supplied list of repo-relative paths: reject
 *  a newline/NUL (could not come from status) and confine each to the workspace.
 *  Returns forward-slashed paths, or null if any is unacceptable. */
function safePaths(root: string, paths: unknown): string[] | null {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 10000) return null
  const out: string[] = []
  for (const p of paths) {
    if (typeof p !== 'string' || p.length === 0 || /[\r\n\0]/.test(p)) return null
    if (!withinWorkspace(join(root, p))) return null
    out.push(gp(p))
  }
  return out
}

export async function stage(paths: string[]): Promise<GitOpResult> {
  const root = await repoRoot()
  if (!root) return { ok: false, error: 'Not a git repository.' }
  const ps = safePaths(root, paths)
  if (!ps) return { ok: false, error: 'Invalid path.' }
  // `--` ends options, so a path beginning with '-' is a path, never a flag.
  return runMutation(root, ['add', '--', ...ps])
}

export async function unstage(paths: string[]): Promise<GitOpResult> {
  const root = await repoRoot()
  if (!root) return { ok: false, error: 'Not a git repository.' }
  const ps = safePaths(root, paths)
  if (!ps) return { ok: false, error: 'Invalid path.' }
  // `git reset` needs a HEAD to reset the index against; before the first commit
  // there is none, so an added path is dropped from the index instead.
  const head = await runGit(root, ['rev-parse', '--verify', 'HEAD'])
  // -f only overrides the "staged content differs" refusal for an added-then-
  // edited file; --cached keeps it index-only, so the working file is never
  // touched (it becomes untracked, matching what `git reset` does with a HEAD).
  return head.ok
    ? runMutation(root, ['reset', '--quiet', '--', ...ps])
    : runMutation(root, ['rm', '--cached', '-f', '--quiet', '--', ...ps])
}

export async function commit(message: string): Promise<GitOpResult> {
  const root = await repoRoot()
  if (!root) return { ok: false, error: 'Not a git repository.' }
  if (typeof message !== 'string' || !message.trim()) return { ok: false, error: 'Enter a commit message.' }
  // The message is a single argv (no shell), so newlines and metacharacters in
  // it are literal text, never interpretable as commands. git itself rejects an
  // empty index ("nothing to commit") or a missing identity, surfaced as-is.
  return runMutation(root, ['commit', '-m', message])
}

/** Push the current branch to its configured upstream. Outward-facing: the
 *  caller confirms first. No args, so nothing user-controlled reaches git; a
 *  missing upstream / rejected push / auth failure surfaces as git's own error
 *  (GIT_TERMINAL_PROMPT=0 means it fails fast rather than blocking on a prompt). */
export async function push(): Promise<GitOpResult> {
  const root = await repoRoot()
  if (!root) return { ok: false, error: 'Not a git repository.' }
  return runMutation(root, ['push'])
}
