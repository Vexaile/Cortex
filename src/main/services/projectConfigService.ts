import { promises as fs } from 'fs'
import { join } from 'path'
import type { ProjectConfig } from '../../shared/ipc'
import { isBareCommand } from '../../shared/security'

/** Per-project build configuration, stored at <workspace>/.cortex/config.json. */

function configPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.cortex', 'config.json')
}

/** The file exactly as written, with no sanitization. Only the WRITER may use
 *  this: it exists so persisting one setting cannot delete another one that the
 *  app merely refuses to honour. */
async function readRawProjectConfig(workspaceRoot: string): Promise<ProjectConfig> {
  try {
    const raw = await fs.readFile(configPath(workspaceRoot), 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? (parsed as ProjectConfig) : {}
  } catch {
    return {}
  }
}

export async function getProjectConfig(workspaceRoot: string): Promise<ProjectConfig> {
  try {
    const raw = await fs.readFile(configPath(workspaceRoot), 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || !parsed) return {}
    const cfg = { ...(parsed as ProjectConfig) }
    // This file travels with the workspace, so it is untrusted: a cloned repo
    // can ship one. `compiler` is spawned as a command (build path and the LSP
    // toolchain probe), so a config that points it at an absolute path to an
    // arbitrary binary would be code execution on open. Only honour a bare,
    // PATH-resolved name here; a real absolute compiler path belongs in the
    // trusted app settings.
    if (cfg.compiler && !isBareCommand(cfg.compiler)) delete cfg.compiler
    return cfg
  } catch {
    return {}
  }
}

export async function setProjectConfig(
  workspaceRoot: string,
  patch: ProjectConfig
): Promise<ProjectConfig> {
  // The RAW file, not the sanitized view: basing the merge on the sanitized one
  // meant that saving any setting silently deleted a `compiler` line the user
  // had hand-written, out of their own version-controlled file, as a git
  // deletion they never made. Refusing to honour a value is not a licence to
  // erase it.
  const current = await readRawProjectConfig(workspaceRoot)
  const next: ProjectConfig = { ...current, ...patch }
  await fs.mkdir(join(workspaceRoot, '.cortex'), { recursive: true })
  await fs.writeFile(configPath(workspaceRoot), JSON.stringify(next, null, 2), 'utf8')
  return next
}
