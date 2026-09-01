import { buildProjectModel } from './projectModelService'
import { coreInstalled, libInstalled } from './packageService'
import { status as boardStatus, boardMcu } from './embeddedService'
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
// The MCU for a given fqbn is stable unless its core is reinstalled/updated, so
// a SUCCESSFUL resolution is cached per fqbn. A failure (transient timeout under
// CLI contention, or a not-yet-installed core) is deliberately NOT cached, so it
// is retried on the next inspect rather than being suppressed permanently.
const mcuCache = new Map<string, string>()
// Coalesce concurrent resolutions of the same fqbn: a panel mount fires inspect
// and checkLock together, each wanting the MCU, and board details is an ~8s CLI
// call - without this they race two of them.
const mcuInflight = new Map<string, Promise<string | undefined>>()
// Bumped on every invalidate(). An MCU resolution captures the generation it
// started under and refuses to write its result if the generation has since
// changed, so a board-details call still in flight when a core (re)install
// completes cannot repopulate the just-cleared cache with a pre-change value.
let mcuGen = 0

/** Drop the cached installed-package snapshot so the next inspect re-reads the
 *  cores/libraries. Wired to packageService: it fires when an install/uninstall/
 *  update-index actually COMPLETES, so the cache is invalidated exactly when the
 *  on-disk package state changed, regardless of which panel started the op. A
 *  core (re)install can change a board's build.mcu, so the MCU cache is dropped
 *  with it (and an in-flight resolve is fenced off by the generation bump). */
export function invalidate(): void {
  pkgCache = null
  mcuCache.clear()
  mcuGen++
}

/** The board's MCU, cached per fqbn (successes only), single-flighted. `refresh`
 *  drops the cached value so a manual re-scan re-reads build.mcu from the CLI -
 *  a core changed OUTSIDE Cortex fires no invalidate, so without this a re-scan
 *  would reuse a stale MCU (the documented silicon ground truth). */
function loadMcu(fqbn: string | null, refresh = false): Promise<string | undefined> {
  if (!fqbn) return Promise.resolve(undefined)
  if (refresh) mcuCache.delete(fqbn)
  const cached = mcuCache.get(fqbn)
  if (cached !== undefined) return Promise.resolve(cached)
  const existing = mcuInflight.get(fqbn)
  if (existing) return existing
  const gen = mcuGen
  const p = (async () => {
    try {
      const mcu = await boardMcu(fqbn)
      if (mcu && gen === mcuGen) mcuCache.set(fqbn, mcu)
      return mcu ?? undefined
    } finally {
      mcuInflight.delete(fqbn)
    }
  })()
  mcuInflight.set(fqbn, p)
  return p
}

/** The current installed cores/libraries + CLI availability, from the shared
 *  single-flight cache. Exposed so the lockfile service reads the SAME snapshot
 *  the inspect path does, rather than storming arduino-cli with its own reads. */
export function installedSnapshot(refresh = false): Promise<PackageSnapshot> {
  return loadPackages(refresh)
}

/** The board's MCU for an fqbn, from the shared per-fqbn cache. `refresh` forces
 *  a re-read (used when snapshotting a lock, which must reflect disk). */
export function boardMcuCached(fqbn: string | null, refresh = false): Promise<string | undefined> {
  return loadMcu(fqbn, refresh)
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
export async function inspect(
  root: string,
  fqbn: string | null,
  refresh = false,
  buildMissingHeaders: string[] = []
): Promise<EnvironmentReport | null> {
  if (!root) return null
  const [model, pkgs, mcu] = await Promise.all([
    buildProjectModel(root),
    loadPackages(refresh),
    loadMcu(fqbn || null, refresh)
  ])
  const input: EnvInput = {
    fqbn: fqbn || null,
    boardMcu: mcu,
    installedCores: pkgs.cores,
    installedLibraries: pkgs.libraries,
    usedIncludes: model.libraries.map((u) => ({ header: u.header, file: u.file, line: u.line })),
    pins: model.pins.map((p) => ({ pin: p.pin, role: p.role, mode: p.mode, file: p.file, line: p.line })),
    buildMissingHeaders,
    librariesTruncated: model.librariesTruncated,
    arduinoCliAvailable: pkgs.cliAvailable
  }
  return reconcileEnvironment(input)
}
