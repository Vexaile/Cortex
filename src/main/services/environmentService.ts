import { buildProjectModel } from './projectModelService'
import { coreInstalled, libInstalled } from './packageService'
import { status as boardStatus } from './embeddedService'
import { reconcileEnvironment, type EnvInput, type EnvironmentReport } from '../../shared/environment'

/**
 * The gatherer for the Intelligent Dependency & Environment System: it composes
 * the existing primitives (the derived project model, the installed cores and
 * libraries from arduino-cli, the selected board, and whether arduino-cli is
 * even available) into the input for the pure reconcileEnvironment engine, and
 * returns its evidence-based report. It never re-implements arduino-cli; it
 * calls packageService.
 *
 * The arduino-cli reads are slow (daemon-less, seconds each) and independent of
 * the open file, so the installed cores/libraries + availability are cached and
 * only re-fetched on an explicit refresh (a package mutation, or the panel's
 * Refresh). The project model is rebuilt each inspect (it is cheap and the file
 * watcher changes it).
 */

interface PackageSnapshot {
  cliAvailable: boolean
  cores: EnvInput['installedCores']
  libraries: EnvInput['installedLibraries']
}

let pkgCache: PackageSnapshot | null = null
let inflight: Promise<PackageSnapshot> | null = null

/** Drop the cached installed-package snapshot so the next inspect re-reads the
 *  cores/libraries. Wired to packageService: it fires when an install/uninstall/
 *  update-index actually COMPLETES, so the cache is invalidated exactly when the
 *  on-disk package state changed, regardless of which panel started the op. */
export function invalidate(): void {
  pkgCache = null
}

async function loadPackages(refresh: boolean): Promise<PackageSnapshot> {
  if (pkgCache && !refresh) return pkgCache
  // Coalesce concurrent loads: the panel can fire several inspects at once (mount
  // + a board change), and each load spawns three daemon-less arduino-cli reads.
  // Without this, those invocations storm the CLI and a contended one can return
  // empty. One load in flight serves them all.
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const [avail, cores, libs] = await Promise.all([boardStatus(), coreInstalled(), libInstalled()])
      pkgCache = {
        cliAvailable: !!avail.available,
        cores: cores.map((c) => ({ id: c.id, installedVersion: c.installedVersion, latestVersion: c.latestVersion })),
        libraries: libs.map((l) => ({
          name: l.name,
          installedVersion: l.installedVersion,
          latestVersion: l.latestVersion,
          providesIncludes: l.providesIncludes ?? []
        }))
      }
      return pkgCache
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * Reconcile the open project's environment. `root` is the workspace (already
 * confined by the caller), `fqbn` the selected board target. `refresh` forces a
 * re-read of the installed cores/libraries.
 */
export async function inspect(root: string, fqbn: string | null, refresh = false): Promise<EnvironmentReport | null> {
  if (!root) return null
  const [model, pkgs] = await Promise.all([buildProjectModel(root), loadPackages(refresh)])
  const input: EnvInput = {
    fqbn: fqbn || null,
    installedCores: pkgs.cores,
    installedLibraries: pkgs.libraries,
    usedIncludes: model.libraries.map((u) => ({ header: u.header, file: u.file, line: u.line })),
    librariesTruncated: model.librariesTruncated,
    arduinoCliAvailable: pkgs.cliAvailable
  }
  return reconcileEnvironment(input)
}
