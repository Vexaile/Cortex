/**
 * The brain of the Intelligent Dependency & Environment System: a pure,
 * dependency-free reconciliation of what a project DECLARES and USES against
 * what is actually INSTALLED, producing an evidence-based EnvironmentReport.
 *
 * No Electron, no fs, no arduino-cli here. The main-process gatherer composes
 * the inputs (from projectModelService + packageService + the selected board)
 * and this function reasons over plain data, so it is fully unit-tested.
 *
 * Honesty contract (see docs/implementation/INTELLIGENT_DEPENDENCY_SYSTEM.md
 * section 5): this static reconcile only claims what it can prove. A header is
 * `resolved` when an installed library reports it provides it, or
 * `provided-by-toolchain` when it is a C/C++ standard header or a core-bundled
 * Arduino header; anything else is `unverified` (Cortex could not confirm a
 * provider, a build will), never a false `missing`. The `missing` and
 * `conflict` states exist for the later build-correlation slice, which has
 * certain evidence; they are not emitted from static data.
 */

import { pinConflicts, type PinUse } from './pinCapability'

export type DependencyState = 'resolved' | 'provided-by-toolchain' | 'unverified' | 'missing'
export type FindingSeverity = 'ok' | 'info' | 'warning' | 'error'
export type UpdateRisk = 'low' | 'medium' | 'high' | 'unknown'

export interface EnvUsedInclude {
  /** The #include target as scanned, e.g. "Wire.h", "Adafruit_MPU6050.h", "vector". */
  header: string
  file: string
  line: number
}

export interface EnvInstalledCore {
  /** vendor:arch, e.g. "esp32:esp32". */
  id: string
  installedVersion: string
  latestVersion: string
}

export interface EnvInstalledLibrary {
  name: string
  installedVersion: string
  latestVersion: string
  /** Headers this library declares it provides (arduino-cli `lib list`
   *  provides_includes). May be empty when the CLI did not report them. */
  providesIncludes: string[]
}

export interface EnvInput {
  /** Selected board target, e.g. "esp32:esp32:esp32devkitv1", or null. */
  fqbn: string | null
  boardName?: string
  installedCores: EnvInstalledCore[]
  installedLibraries: EnvInstalledLibrary[]
  usedIncludes: EnvUsedInclude[]
  /** Headers the last build reported as not found (e.g. from a "No such file"
   *  compiler error). These are CERTAIN evidence: an unverified header that the
   *  compiler could not find is upgraded to `missing`. */
  buildMissingHeaders?: string[]
  /** GPIO pins the source uses, with roles, for hardware-capability checks. */
  pins?: PinUse[]
  /** The board's actual MCU (arduino-cli board details build.mcu, e.g. "esp32"),
   *  the ground truth for pin-capability facts. Absent when it could not be
   *  determined, in which case no hardware pin claim is made. */
  boardMcu?: string
  /** True when the project scan hit its cap; the used-include list is a sample. */
  librariesTruncated?: boolean
  /** Whether the board toolchain (arduino-cli) could be queried at all. When
   *  false, an empty installedCores means "could not check", not "nothing
   *  installed", so the engine must not claim a core is missing or suggest a
   *  specific install. Defaults to available when omitted. */
  arduinoCliAvailable?: boolean
}

export interface CoreStatus {
  fqbn: string | null
  /** vendor:arch parsed from the fqbn, or null when the fqbn is absent/malformed. */
  platformId: string | null
  installed: boolean
  installedVersion?: string
}

export interface DependencyStatus {
  header: string
  state: DependencyState
  /** Installed library that provides it (state === 'resolved'). */
  provider?: string
  providerVersion?: string
  usedAt: { file: string; line: number }[]
}

export interface UpdateStatus {
  library: string
  installed: string
  latest: string
  risk: UpdateRisk
  reason: string
}

export interface EnvSuggestion {
  kind: 'install-core' | 'install-library' | 'update-library' | 'search-library'
  target: string
  version?: string
}

export interface EnvFinding {
  id: string
  severity: FindingSeverity
  category: 'board' | 'core' | 'library' | 'update' | 'hardware'
  title: string
  detail: string
  header?: string
  library?: string
  /** Source location, for findings tied to a specific site (e.g. a pin conflict). */
  file?: string
  line?: number
  suggestion?: EnvSuggestion
}

export interface EnvironmentReport {
  core: CoreStatus
  dependencies: DependencyStatus[]
  updates: UpdateStatus[]
  findings: EnvFinding[]
  /** The picture is partial: the scan was truncated, or no provider map was
   *  available so unresolved headers could not be reasoned about confidently. */
  incomplete: boolean
}

/**
 * Headers we can prove are provided without a user-installed library on EVERY
 * supported target, so classifying them 'provided-by-toolchain' can never be a
 * false green. This is deliberately the INTERSECTION across cores, not the
 * union: it holds only the universal Arduino core headers (Arduino/Wire/SPI/
 * HardwareSerial), the GCC freestanding C headers (shipped independent of any
 * libc), and the C-library headers present in BOTH avr-libc and newlib.
 *
 * Deliberately excluded because they are NOT universal (they would over-claim
 * on AVR/SAMD/SAM, violating the honesty rule): EEPROM.h (absent on SAMD/SAM);
 * the libc-hosted headers avr-libc lacks (fenv/locale/signal/wchar/wctype); and
 * the entire C++ STL (extension-less <vector>/<string>/..., absent on AVR which
 * ships no hosted libstdc++). Those fall to installed-library matching or stay
 * `unverified` and are confirmed by a build.
 */
const TOOLCHAIN_HEADERS = new Set<string>([
  // Universal Arduino core headers
  'arduino.h', 'wire.h', 'spi.h', 'hardwareserial.h',
  // GCC freestanding C headers (present regardless of libc)
  'float.h', 'iso646.h', 'limits.h', 'stdarg.h', 'stdbool.h', 'stddef.h', 'stdint.h',
  // C-library headers present in both avr-libc and newlib
  'assert.h', 'ctype.h', 'errno.h', 'inttypes.h', 'math.h', 'setjmp.h',
  'stdio.h', 'stdlib.h', 'string.h', 'time.h'
])

/** Normalize an #include target for comparison: strip delimiters/whitespace and
 *  lowercase, keeping any subpath (e.g. "freertos/task.h"). */
export function normalizeHeader(header: string): string {
  return header.trim().replace(/^[<"]|[">]$/g, '').trim().toLowerCase()
}

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i >= 0 ? path.slice(i + 1) : path
}

/**
 * Pull the not-found headers out of compiler diagnostics. Matches the gcc/clang
 * "X.h: No such file or directory" wording, so a failed build becomes certain
 * evidence that a header is missing. Returns normalized, de-duplicated headers.
 */
export function extractMissingHeaders(diagnostics: { message: string }[]): string[] {
  const out = new Set<string>()
  for (const d of diagnostics) {
    const m = /([A-Za-z0-9_./\\-]+\.[A-Za-z0-9_]+):\s*No such file or directory/i.exec(d.message || '')
    if (m) out.add(normalizeHeader(m[1]))
  }
  return [...out]
}

/** vendor:arch from a vendor:arch:board fqbn. Null when absent or malformed. */
export function platformIdFromFqbn(fqbn: string | null | undefined): string | null {
  if (!fqbn) return null
  const parts = fqbn.split(':')
  if (parts.length < 3 || !parts[0] || !parts[1]) return null
  return `${parts[0]}:${parts[1]}`
}

interface Semver {
  major: number
  minor: number
  patch: number
}
function parseSemver(v: string): Semver | null {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(v || '')
  if (!m) return null
  // Pre-release tags are ignored, so a pre-release and its final compare equal.
  // This can only MISS an update (rc -> final), never invent one, so it stays
  // within the honesty contract; precise pre-release ordering is out of scope.
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0) }
}

/** Compare a.b.c: negative if x < y, positive if x > y, 0 if equal. */
function cmpSemver(x: Semver, y: Semver): number {
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch
}

/** Update risk from the installed->latest delta, with the delta as the reason.
 *  Never a fabricated number: the tier is the size of the version bump. */
export function updateRisk(installed: string, latest: string): { risk: UpdateRisk; reason: string } {
  const a = parseSemver(installed)
  const b = parseSemver(latest)
  if (!a || !b) return { risk: 'unknown', reason: 'Version format is not comparable.' }
  if (cmpSemver(b, a) <= 0) return { risk: 'low', reason: 'Already up to date.' }
  if (b.major > a.major) return { risk: 'high', reason: 'Major version bump; the API may have changed.' }
  if (b.minor > a.minor) return { risk: 'medium', reason: 'Minor version bump; new features, usually compatible.' }
  return { risk: 'low', reason: 'Patch update; fixes only.' }
}

/**
 * Reconcile the environment into an evidence-based report. Pure: same input
 * always yields the same report.
 */
export function reconcileEnvironment(input: EnvInput): EnvironmentReport {
  const findings: EnvFinding[] = []

  // ---- board / core ----
  const cliAvailable = input.arduinoCliAvailable !== false
  const platformId = platformIdFromFqbn(input.fqbn)
  // An empty installedVersion is arduino-cli's "not installed" sentinel (it also
  // appears on search-result rows), so a bare id match is not proof of install.
  const installedCore = platformId
    ? input.installedCores.find((c) => c.id === platformId && !!c.installedVersion)
    : undefined
  const core: CoreStatus = {
    fqbn: input.fqbn ?? null,
    platformId,
    installed: !!installedCore,
    installedVersion: installedCore?.installedVersion
  }
  if (input.fqbn && !platformId) {
    findings.push({
      id: 'fqbn-malformed',
      severity: 'warning',
      category: 'board',
      title: 'The selected board identifier is malformed',
      detail: `"${input.fqbn}" is not a vendor:arch:board identifier, so Cortex cannot check whether its core is installed.`
    })
  } else if (input.fqbn && platformId && !cliAvailable) {
    // Cannot see cores at all: do not claim the core is missing or suggest a fix.
    findings.push({
      id: 'toolchain-missing',
      severity: 'warning',
      category: 'core',
      title: 'The board toolchain (arduino-cli) is unavailable',
      detail: `Cortex could not query installed cores, so it cannot confirm whether the ${platformId} core for ${input.fqbn} is installed. Install arduino-cli to enable core and library checks.`
    })
  } else if (input.fqbn && platformId && !installedCore) {
    findings.push({
      id: 'core-missing',
      severity: 'error',
      category: 'core',
      title: `The core for ${input.boardName || input.fqbn} is not installed`,
      detail: `The selected board ${input.fqbn} needs the ${platformId} core, which is not among the installed cores. The project cannot build for this board until it is installed.`,
      suggestion: { kind: 'install-core', target: platformId }
    })
  } else if (installedCore) {
    findings.push({
      id: 'core-ok',
      severity: 'ok',
      category: 'core',
      title: `Core installed: ${platformId} ${installedCore.installedVersion}`,
      detail: `The ${platformId} core that ${input.fqbn} needs is installed.`
    })
  }

  // ---- dependencies (used #include headers vs installed libraries) ----
  // Only actually-installed libraries (non-empty version) can provide headers.
  const installedLibs = input.installedLibraries.filter((l) => !!l.installedVersion)
  // A reliable provider map exists only if at least one installed library
  // reported the headers it provides; without it we cannot reason about
  // unmatched headers, so the report is marked incomplete.
  const hasProviderMap = installedLibs.some((l) => l.providesIncludes.length > 0)

  // Full-path index, plus a basename index used ONLY when a basename is provided
  // by exactly one library, so two libraries that both ship a "config.h" are
  // never cross-attributed.
  const providerByHeader = new Map<string, EnvInstalledLibrary>()
  const basenameToLibs = new Map<string, Set<EnvInstalledLibrary>>()
  for (const lib of installedLibs) {
    for (const h of lib.providesIncludes) {
      const norm = normalizeHeader(h)
      if (!providerByHeader.has(norm)) providerByHeader.set(norm, lib)
      const base = basename(norm)
      let set = basenameToLibs.get(base)
      if (!set) {
        set = new Set()
        basenameToLibs.set(base, set)
      }
      set.add(lib)
    }
  }
  const providerFor = (norm: string): EnvInstalledLibrary | undefined => {
    const full = providerByHeader.get(norm)
    if (full) return full
    const set = basenameToLibs.get(basename(norm))
    return set && set.size === 1 ? [...set][0] : undefined
  }

  const byHeader = new Map<string, DependencyStatus>()
  for (const inc of input.usedIncludes) {
    const norm = normalizeHeader(inc.header)
    if (!norm) continue
    let dep = byHeader.get(norm)
    if (!dep) {
      dep = { header: norm, state: 'unverified', usedAt: [] }
      byHeader.set(norm, dep)
    }
    if (!dep.usedAt.some((u) => u.file === inc.file && u.line === inc.line)) {
      dep.usedAt.push({ file: inc.file, line: inc.line })
    }
  }

  // Headers the compiler could not find (certain evidence of missing). Matched
  // on the FULL normalized header only: the compiler and the scanner both spell
  // it from the same #include, so an exact match is right, and a basename
  // fallback would cross-attribute a bare "config.h" to a used "vendor/config.h".
  const missingSet = new Set((input.buildMissingHeaders ?? []).map((h) => normalizeHeader(h)))

  for (const dep of byHeader.values()) {
    // Provider first: if an installed library declares it, that is the truth,
    // and it correctly resolves an extension-less header a library ships.
    const provider = providerFor(dep.header)
    if (provider) {
      dep.state = 'resolved'
      dep.provider = provider.name
      dep.providerVersion = provider.installedVersion
      continue
    }
    // Then the provable-universal toolchain/core headers.
    if (TOOLCHAIN_HEADERS.has(dep.header) || TOOLCHAIN_HEADERS.has(basename(dep.header))) {
      dep.state = 'provided-by-toolchain'
      continue
    }
    // A build that reported this exact header not-found is certain evidence it
    // is missing; that beats the static "unverified".
    if (missingSet.has(dep.header)) {
      dep.state = 'missing'
      continue
    }
    // Otherwise we cannot prove a provider from static data (a core-bundled,
    // STL, or not-yet-installed header), so a build gives the verdict later.
    dep.state = 'unverified'
  }

  const dependencies = [...byHeader.values()].sort((a, b) => a.header.localeCompare(b.header))

  // Compiler-confirmed missing dependencies (certain).
  for (const d of dependencies.filter((x) => x.state === 'missing')) {
    findings.push({
      id: `missing-${d.header}`,
      severity: 'error',
      category: 'library',
      title: `No installed library provides ${d.header}`,
      detail: `The build reported that ${d.header} could not be found, and no installed library provides it. Install the library that supplies this header.`,
      header: d.header,
      file: d.usedAt[0]?.file,
      line: d.usedAt[0]?.line,
      suggestion: { kind: 'search-library', target: d.header }
    })
  }

  // Hardware-aware checks: a pin driven as an output that the board routes to an
  // input-only pad. Only emitted when the board's pinout is known with certainty.
  for (const c of pinConflicts(input.boardMcu, input.pins ?? [])) {
    findings.push({
      id: `pin-${c.gpio}-${c.file}-${c.line}`,
      severity: 'error',
      category: 'hardware',
      title: `GPIO${c.gpio} is input-only but driven as an output`,
      detail: c.reason,
      file: c.file,
      line: c.line
    })
  }

  const unverified = dependencies.filter((d) => d.state === 'unverified')
  if (unverified.length > 0) {
    findings.push({
      id: 'deps-unverified',
      severity: 'info',
      category: 'library',
      title: `${unverified.length} include${unverified.length > 1 ? 's' : ''} could not be matched to an installed library`,
      detail: hasProviderMap
        ? `Cortex could not find an installed library that provides ${unverified.map((d) => d.header).join(', ')}. They may be provided by the board core, or the library may not be installed. Building will confirm.`
        : `Cortex could not read which headers the installed libraries provide, so ${unverified.map((d) => d.header).join(', ')} are unverified. Building will confirm.`
    })
  }

  // ---- updates (installed libraries with a newer version available) ----
  const updates: UpdateStatus[] = []
  for (const lib of installedLibs) {
    if (!lib.latestVersion || !lib.installedVersion) continue
    const a = parseSemver(lib.installedVersion)
    const b = parseSemver(lib.latestVersion)
    if (!a || !b || cmpSemver(b, a) <= 0) continue
    const { risk, reason } = updateRisk(lib.installedVersion, lib.latestVersion)
    updates.push({ library: lib.name, installed: lib.installedVersion, latest: lib.latestVersion, risk, reason })
    findings.push({
      id: `update-${lib.name}`,
      severity: risk === 'high' ? 'warning' : 'info',
      category: 'update',
      title: `Update available: ${lib.name} ${lib.installedVersion} -> ${lib.latestVersion}`,
      detail: `${reason} Risk: ${risk}.`,
      library: lib.name,
      suggestion: { kind: 'update-library', target: lib.name, version: lib.latestVersion }
    })
  }

  const incomplete = !!input.librariesTruncated || (unverified.length > 0 && !hasProviderMap)

  // Stable, useful ordering: errors first, then warnings, then info, then ok.
  const order: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2, ok: 3 }
  findings.sort((a, b) => order[a.severity] - order[b.severity])

  return { core, dependencies, updates, findings, incomplete }
}
