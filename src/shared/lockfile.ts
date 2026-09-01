/**
 * The reproducibility primitive of the Intelligent Dependency & Environment
 * System: a pure, dependency-free model of the Cortex environment lockfile and
 * the drift between a stored lock and the currently-installed environment.
 *
 * A lock is an OBSERVED snapshot - the exact cores and libraries (with versions)
 * that were installed when it was written, plus the board target. It is not a
 * declaration of intent; it records resolved reality, the way a package lockfile
 * does, so a teammate or CI can reproduce the environment and so a silent library
 * update that no longer matches what the project was built with becomes visible.
 *
 * Honesty contract (see docs/implementation/INTELLIGENT_DEPENDENCY_SYSTEM.md):
 * everything here is observed fact. The diff reports what IS installed versus
 * what the lock RECORDS - a version mismatch or a missing entry is certain, not
 * inferred. No compatibility claims are made; a drift is a difference, and the
 * engineer decides what it means.
 *
 * No Electron, no fs here. The main-process gatherer reads/writes the file and
 * stamps the timestamp (this module never reaches for the clock, so it stays
 * deterministic and fully unit-tested); this module only shapes and compares.
 */

export const LOCK_SCHEMA = 1 as const

export interface LockCore {
  /** vendor:arch, e.g. "esp32:esp32". */
  id: string
  version: string
}

export interface LockLibrary {
  name: string
  version: string
}

export interface CortexLock {
  schema: typeof LOCK_SCHEMA
  board: { fqbn: string | null; mcu?: string }
  cores: LockCore[]
  libraries: LockLibrary[]
  /** ISO timestamp, stamped by the gatherer when the lock is written. */
  generatedAt?: string
}

/** Raw installed state the gatherer collects, before it is shaped into a lock. */
export interface LockInput {
  fqbn: string | null
  mcu?: string
  cores: { id: string; installedVersion: string }[]
  libraries: { name: string; installedVersion: string }[]
  /** Stamped by the caller (this module never reads the clock). */
  generatedAt?: string
}

// Code-unit comparison of the lowercased keys, NOT localeCompare: the lock must
// serialize to the same bytes on every machine, and localeCompare's ordering
// depends on the runtime locale and ICU version (punctuation and spaces sort
// differently across locales), which would give two teammates observing the same
// environment different lock bytes and spurious git diffs. toLowerCase (not the
// locale variant) keeps the key itself deterministic too.
function byLower(a: string, b: string): number {
  const al = a.toLowerCase()
  const bl = b.toLowerCase()
  return al < bl ? -1 : al > bl ? 1 : 0
}

/**
 * Shape a raw installed environment into a normalized, deterministic lock: only
 * actually-installed entries (a non-empty version), deduplicated by identity
 * (first wins), and sorted, so the same environment always serializes to the
 * same bytes and a lock is diffable in version control.
 */
export function buildLock(input: LockInput): CortexLock {
  const coreSeen = new Set<string>()
  const cores: LockCore[] = []
  for (const c of input.cores) {
    if (!c.id || !c.installedVersion || coreSeen.has(c.id)) continue
    coreSeen.add(c.id)
    cores.push({ id: c.id, version: c.installedVersion })
  }
  cores.sort((a, b) => byLower(a.id, b.id))

  const libSeen = new Set<string>()
  const libraries: LockLibrary[] = []
  for (const l of input.libraries) {
    if (!l.name || !l.installedVersion) continue
    const key = l.name.toLowerCase()
    if (libSeen.has(key)) continue
    libSeen.add(key)
    libraries.push({ name: l.name, version: l.installedVersion })
  }
  libraries.sort((a, b) => byLower(a.name, b.name))

  const board: CortexLock['board'] = { fqbn: input.fqbn ?? null }
  if (input.mcu) board.mcu = input.mcu
  const lock: CortexLock = { schema: LOCK_SCHEMA, board, cores, libraries }
  if (input.generatedAt) lock.generatedAt = input.generatedAt
  return lock
}

/**
 * Validate an untrusted, parsed lock (the file travels with the workspace, so a
 * cloned repo can ship one). Returns a normalized lock or null when the shape is
 * not what we wrote. The lock holds only data we display and compare - never a
 * value spawned as a command - so validation is about correctness, not a
 * security boundary; restoring a lock (a future slice) goes through the same
 * gated install path as any user-triggered change.
 */
export function parseLock(value: unknown): CortexLock | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.schema !== LOCK_SCHEMA) return null
  const board = v.board
  if (!board || typeof board !== 'object') return null
  const b = board as Record<string, unknown>
  const fqbn = typeof b.fqbn === 'string' ? b.fqbn : b.fqbn === null ? null : undefined
  if (fqbn === undefined) return null

  // Empty id/name/version is rejected, not accepted-then-silently-dropped:
  // buildLock filters empties, so accepting them here would make parseLock
  // return a lock that differs from the file (an entry vanishing with no signal)
  // instead of rejecting a shape we never write.
  const cores: LockCore[] = []
  if (!Array.isArray(v.cores)) return null
  for (const c of v.cores) {
    if (!c || typeof c !== 'object') return null
    const cc = c as Record<string, unknown>
    if (typeof cc.id !== 'string' || !cc.id || typeof cc.version !== 'string' || !cc.version) return null
    cores.push({ id: cc.id, version: cc.version })
  }

  const libraries: LockLibrary[] = []
  if (!Array.isArray(v.libraries)) return null
  for (const l of v.libraries) {
    if (!l || typeof l !== 'object') return null
    const ll = l as Record<string, unknown>
    if (typeof ll.name !== 'string' || !ll.name || typeof ll.version !== 'string' || !ll.version) return null
    libraries.push({ name: ll.name, version: ll.version })
  }

  const out: CortexLock = { schema: LOCK_SCHEMA, board: { fqbn }, cores, libraries }
  if (typeof b.mcu === 'string') out.board.mcu = b.mcu
  if (typeof v.generatedAt === 'string') out.generatedAt = v.generatedAt
  // Re-normalize so a hand-edited or reordered file still compares deterministically.
  return buildLock({
    fqbn: out.board.fqbn,
    mcu: out.board.mcu,
    cores: cores.map((c) => ({ id: c.id, installedVersion: c.version })),
    libraries: libraries.map((l) => ({ name: l.name, installedVersion: l.version })),
    generatedAt: out.generatedAt
  })
}

export interface LockDrift {
  /** Present when the current board target differs from the locked one. */
  boardChanged: { from: string | null; to: string | null } | null
  /** In the lock, not currently installed at all. */
  coresMissing: LockCore[]
  librariesMissing: LockLibrary[]
  /** Installed, but at a different version than the lock records. */
  coresChanged: { id: string; locked: string; installed: string }[]
  librariesChanged: { name: string; locked: string; installed: string }[]
  /** Installed but not in the lock (informational; does not break the locked set). */
  extraCores: LockCore[]
  extraLibraries: LockLibrary[]
  /** True when everything the lock requires is present at the locked version and
   *  the board matches. Extras do not break sync; they are surfaced as info. */
  inSync: boolean
  /** Count of reproducibility-breaking differences (missing + changed + board). */
  breakingCount: number
}

/** A stored lock paired with its drift against the current environment. */
export interface LockCheck {
  lock: CortexLock
  drift: LockDrift
}

/**
 * Diff a stored lock against the current installed environment. Pure and
 * deterministic. Everything reported is an observed difference; no compatibility
 * judgement is made.
 */
export function diffLock(locked: CortexLock, current: LockInput): LockDrift {
  const cur = buildLock(current)

  const boardChanged =
    (locked.board.fqbn ?? null) !== (cur.board.fqbn ?? null)
      ? { from: locked.board.fqbn ?? null, to: cur.board.fqbn ?? null }
      : null

  // Cores match case-sensitively on their id. Unlike library names, a core id is
  // a canonical vendor:arch from arduino-cli's platform index (always the same
  // case on both sides), so case-folding is unnecessary here; if that ever stops
  // holding, a case-only difference would show as both missing and extra.
  const curCore = new Map(cur.cores.map((c) => [c.id, c.version]))
  const coresMissing: LockCore[] = []
  const coresChanged: { id: string; locked: string; installed: string }[] = []
  for (const c of locked.cores) {
    const installed = curCore.get(c.id)
    if (installed === undefined) coresMissing.push(c)
    else if (installed !== c.version) coresChanged.push({ id: c.id, locked: c.version, installed })
  }
  const lockedCoreIds = new Set(locked.cores.map((c) => c.id))
  const extraCores = cur.cores.filter((c) => !lockedCoreIds.has(c.id))

  // Libraries compare case-insensitively on name (arduino-cli's install identity).
  const curLib = new Map(cur.libraries.map((l) => [l.name.toLowerCase(), l]))
  const librariesMissing: LockLibrary[] = []
  const librariesChanged: { name: string; locked: string; installed: string }[] = []
  for (const l of locked.libraries) {
    const installed = curLib.get(l.name.toLowerCase())
    if (!installed) librariesMissing.push(l)
    else if (installed.version !== l.version)
      librariesChanged.push({ name: l.name, locked: l.version, installed: installed.version })
  }
  const lockedLibNames = new Set(locked.libraries.map((l) => l.name.toLowerCase()))
  const extraLibraries = cur.libraries.filter((l) => !lockedLibNames.has(l.name.toLowerCase()))

  const breakingCount =
    (boardChanged ? 1 : 0) +
    coresMissing.length +
    coresChanged.length +
    librariesMissing.length +
    librariesChanged.length

  return {
    boardChanged,
    coresMissing,
    librariesMissing,
    coresChanged,
    librariesChanged,
    extraCores,
    extraLibraries,
    inSync: breakingCount === 0,
    breakingCount
  }
}
