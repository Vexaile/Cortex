import { promises as fs } from 'fs'
import { join } from 'path'
import { buildLock, parseLock, diffLock, type CortexLock, type LockCheck, type LockInput } from '../../shared/lockfile'
import { installedSnapshot, boardMcuCached } from './environmentService'

/**
 * Reads and writes the Cortex environment lockfile at
 * <workspace>/.cortex/cortex.lock.json, and computes drift between a stored lock
 * and the currently-installed environment.
 *
 * It owns only the file I/O; the shaping and comparison live in the pure lockfile
 * module (which never reaches for the clock), and the timestamp is supplied by
 * the caller (the IPC layer). The installed cores/libraries and the board MCU
 * come from environmentService's shared single-flight cache, so a snapshot or
 * check never spawns its own arduino-cli reads alongside an inspect.
 */

function lockPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.cortex', 'cortex.lock.json')
}

/** Gather the current installed environment as lock input (without a timestamp).
 *  `refresh` re-reads both the packages and the MCU from disk/CLI so a snapshot
 *  reflects reality rather than a possibly-stale cache. */
async function currentInput(fqbn: string | null, refresh: boolean): Promise<LockInput> {
  const [pkgs, mcu] = await Promise.all([installedSnapshot(refresh), boardMcuCached(fqbn, refresh)])
  return {
    fqbn: fqbn || null,
    mcu,
    cores: pkgs.cores.map((c) => ({ id: c.id, installedVersion: c.installedVersion })),
    libraries: pkgs.libraries.map((l) => ({ name: l.name, installedVersion: l.installedVersion }))
  }
}

/** Snapshot the current environment to the lockfile and return what was written.
 *  `refresh` re-reads the installed packages so the lock reflects disk, not a
 *  possibly-stale cache. */
export async function write(workspaceRoot: string, fqbn: string | null, isoNow: string): Promise<CortexLock> {
  if (!workspaceRoot) throw new Error('no workspace')
  const input = await currentInput(fqbn, true)
  const lock = buildLock({ ...input, generatedAt: isoNow })
  await fs.mkdir(join(workspaceRoot, '.cortex'), { recursive: true })
  await fs.writeFile(lockPath(workspaceRoot), JSON.stringify(lock, null, 2) + '\n', 'utf8')
  return lock
}

/** The stored lock, or null when there is none or it is malformed. */
export async function read(workspaceRoot: string): Promise<CortexLock | null> {
  if (!workspaceRoot) return null
  try {
    const raw = await fs.readFile(lockPath(workspaceRoot), 'utf8')
    return parseLock(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Compare the stored lock against the current installed environment. Returns
 *  null when there is no (valid) lock to check against. */
export async function check(workspaceRoot: string, fqbn: string | null): Promise<LockCheck | null> {
  const lock = await read(workspaceRoot)
  if (!lock) return null
  const drift = diffLock(lock, await currentInput(fqbn, false))
  return { lock, drift }
}
