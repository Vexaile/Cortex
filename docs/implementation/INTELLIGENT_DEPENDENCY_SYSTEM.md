# Cortex Intelligent Dependency & Environment System

Status: in progress. This document is the design of record; it is updated as
slices land. See `CORTEX_PROGRESS.md` for what has shipped.

## 1. Goal

Turn Cortex's package handling from a "Library Manager" (a thin UI over
`arduino-cli`) into an **intelligence layer** that understands the whole
environment required to build and run an embedded project, and can:

> Discover -> Resolve -> Understand -> Validate -> Explain -> Repair

The user promise: a user says "I need this library" (or "why won't this build?")
and Cortex answers from evidence, not by echoing a compiler error, about the
chain:

```
project -> board -> MCU/arch -> framework -> toolchain -> libraries ->
transitive deps -> the headers the source actually includes ->
hardware requirements -> simulator support -> build/flash environment
```

## 2. Non-goals

- **Not a new package registry.** We sit on top of arduino-cli (and, later,
  PlatformIO / git / ESP-IDF). Our value is the reasoning layer, not hosting.
- **No fabricated data.** Every finding, compatibility claim, and risk score is
  backed by observed evidence (installed metadata, the parsed project, a real
  build result, curated facts). When we cannot substantiate a claim we say so
  ("unverified"), we do not guess.
- **No silent environment changes.** Installs and repairs are proposed; the user
  (or, for the agent, the approval gate) applies them.
- **Not a full SAT dependency solver.** We resolve what the ecosystems already
  resolve and add correlation/validation on top; we do not reimplement npm.

## 3. Architecture

The system is a thin **intelligence layer** composed of three parts, each built
to extend what exists:

```
                    Environment Report (evidence-based)
                              ^
                              | reconcile()  [pure, shared/environment.ts]
        +---------------------+----------------------+
        |                     |                      |
   ProjectModel         installed cores/libs     selected board
 (projectModelService)  (packageService)         (projectConfig fqbn)
   declared + used         resolve/install          intent
        |                     |                      |
        +--- hardwareGraph (board/pin/bus/device, DEVICE_MAP) ---+
                              |
                       simulator capabilities (later)
```

- **Pure core (`src/shared/environment.ts`)** - the model types and the
  `reconcileEnvironment(input)` function: given the declared/used dependencies,
  what is installed, and the selected board, produce a structured
  `EnvironmentReport` of evidence-based findings. No Electron, no fs, no CLI, so
  it is fully unit-tested. This is the brain; everything else feeds it data or
  renders its output.
- **Gatherer service (`src/main/services/environmentService.ts`, later slice)** -
  composes the existing primitives (`buildProjectModel`, `packageService.core/
  libInstalled`, `projectConfigService` fqbn, `settings`) into the reconcile
  input, caches it, and exposes it over IPC. It calls the existing arduino-cli
  layer; it never re-shells or reimplements it.
- **Surfaces** - a Dependencies / Environment panel (Taste-Skill), the Hardware
  panel, the command palette, and the AI agent all read the same report. One
  information model, not five dashboards.

Deliberately NOT a parallel system: `packageService` stays the sole install/
resolve engine, `projectModelService` stays the sole project scanner,
`hardwareGraph` stays the sole hardware derivation. We add a layer that
correlates them.

## 4. Data model

Canonical, in `src/shared/environment.ts` (pure). Two layers:

- The pure engine takes a **minimal input contract** (`EnvInstalledCore`,
  `EnvInstalledLibrary`, `EnvUsedInclude`) rather than importing the full IPC
  DTOs, so it stays dependency-free and testable (a ports/adapters boundary).
  The gatherer service maps the real DTOs (`CorePlatform`, `LibPackage`,
  `ProjectModel.libraries`) onto this contract.
- The IPC/DTO layer is where the "don't invent parallels" rule applies: extend
  `CorePlatform` / `LibPackage` / `ProjectModel` with optional fields rather
  than forking them. Concretely, `LibPackage` must gain `providesIncludes`
  (arduino-cli `lib list` `provides_includes`) - the field the reconcile engine
  depends on to resolve a header to a library - and `packageService.normalizeLib`
  must surface it; today it is dropped.

- `EnvironmentReport { core: CoreStatus, dependencies: DependencyStatus[],
  updates: UpdateStatus[], findings: EnvFinding[], incomplete: boolean }`
- `CoreStatus { fqbn, platformId, installed, installedVersion? }` - platformId is
  `vendor:arch` parsed from the fqbn `vendor:arch:board`.
- `DependencyStatus { header, state, provider?, providerVersion?, usedAt[] }`
  with `state` in `resolved | provided-by-toolchain | unverified | missing`.
  The static reconcile emits only the first three (the honesty contract, section
  5); `missing` is defined in the type but only ever set by the later
  build-correlation slice, which has certain evidence.
- `UpdateStatus { library, installed, latest, risk, reason }` - risk from the
  semver delta, never a fabricated number.
- `EnvFinding { id, severity, category, title, detail, header?, library?, file?,
  line?, suggestion? }` - severity `ok|info|warning|error`; suggestion is a
  structured, user-approved action (`install-core|install-library|
  update-library`).

Future fields (documented now, added when their evidence source lands): MCU/arch
on `BoardInfo`, `providesIncludes` and transitive `dependencies[]` on
`LibPackage`, per-library `simulationSupport`, `hardwareRequirements`,
integrity/checksum, source origin.

## 5. Resolution & compatibility strategy (honesty tiers)

The engine only claims what it can prove. Each dependency header resolves to a
tier:

The engine checks the provider first, so a library that genuinely ships a header
always wins over a guess:

- **resolved** - an installed library declares it provides this header
  (arduino-cli `lib list` `provides_includes`). High confidence: we have the
  provider name and version. A basename is only matched when exactly one
  installed library provides it, so two libraries that both ship a `config.h`
  are never cross-attributed.
- **provided-by-toolchain** - the header is on a curated set proven present on
  EVERY supported target: the universal Arduino core headers (Arduino/Wire/SPI/
  HardwareSerial), the GCC freestanding C headers, and the C-library headers
  common to both avr-libc and newlib. Deliberately NOT here (they would
  over-claim on AVR/SAMD/SAM): `EEPROM.h`, the libc-hosted headers avr-libc
  lacks, and the entire C++ STL (`<vector>` etc., absent on AVR).
- **unverified** - not resolved and not provably-universal. We cannot prove a
  provider from static data (it may be a core-bundled header, an STL header on a
  hosted target, or a not-yet-installed library), so we say so rather than guess
  either way. A build gives the certain verdict.

The static reconcile NEVER emits **missing** or **conflict**: a core-bundled or
newly-added header would make a static "missing" a false positive. Those states
exist in the model only for the build-correlation slice, which has the compiler
as certain evidence.

Core/board compatibility (this slice): the selected fqbn's platform
(`vendor:arch`) must be among the installed cores; otherwise the board cannot
build and we say exactly that, with an install-core suggestion. Deeper
compatibility (MCU/arch vs library architectures, GPIO/PWM/bus requirements vs
the hardware graph) is a later slice and only ships with a real evidence source.

Update risk is derived from the semver delta between installed and latest:
patch -> low, minor -> medium, major -> high, unparseable -> unknown, each with
the delta as the stated reason.

## 6. Failure handling

Explicit states, never collapsed into "no libraries found": `resolving`,
`resolved`, `conflict`, `missing`, `incompatible`, `unknown`, `install-failed`,
`source-unavailable`, `toolchain-missing`. arduino-cli read failures already
degrade to empty lists in `packageService`; the report marks itself `incomplete`
when the underlying scan was truncated or a source was unreachable, so a partial
picture is never presented as complete.

## 7. UI architecture (Taste-Skill)

One coherent information model surfaced as: a **Project Dependencies** panel
(what the project uses, resolved/missing/update state, click-to-source), the
**Environment Doctor** (the report's findings grouped by severity with
evidence and proposed fixes), a **Library Detail** view, and the **Dependency
Graph** (an extension of `hardwareGraph`, adding core/library/framework node
kinds). Built on the existing `HardwarePanel` read-only-analysis template
(Section / NodeRow / SiteLink -> revealLocation), the ide-* tokens, and the
sidebar rail pattern (SidebarView union + ActivityBar ITEMS + SideBar switch).
No decorative charts; every element answers an engineering question.

## 8. AI integration

The report is structured context for the engineering agent. New read-only agent
tools (`inspect_environment`, `diagnose_environment`) return the report the same
way `get_project_model` does. A dependency *change* (install/pin/update) is a
mutation: it uses the same propose-then-approve gate as file edits, surfaced as a
new approvable "environment change" card (not a file diff). The agent never
invokes arduino-cli install directly; it proposes, the human approves, and the
existing streamed `runPackageOp` path executes it (CLAUDE.md sections 7-8).

## 9. Security

Dependency installation is an execution boundary. We keep the existing
protections (execFile, no shell; `--` before package ids; http(s)-only,
comma-rejecting index-URL validation) and add: routing packageService's
`arduino-cli` invocation through the same command resolver the other services
use (today it calls the bare binary on PATH - injection-safe as a fixed
constant, but it should join the resolver for consistency), and:
the source of anything about to be installed is shown before installing;
AI-initiated changes pass the same approval gate as user ones; we do not run
arbitrary post-install scripts beyond what arduino-cli/pio themselves do, and
that trust boundary is documented for the user.

## 10. Caching

arduino-cli search/list are slow (~13s, daemon-less) and today live in
component state. The gatherer service caches the installed-core/lib lists and
the reconciled report per (workspace, fqbn) and invalidates on the events that
change the inputs: a package mutation, a project-model rebuild (the file
watcher already drives this), or a board change. Invalidation is event-driven,
so no project-model version field is needed. Resolution never runs on a
keystroke; the editor is never blocked (CLAUDE.md section 19).

## 11. Reproducibility

Later slices add a Cortex project manifest and a resolution lock (exact library/
core/framework versions, sources, integrity where supported) so an environment
is reproducible across machines and CI, plus an environment snapshot. The schema
is derived from the real architecture when that slice lands; this document does
not lock it prematurely.

## 12. Testing

- Unit: the pure reconcile engine (this slice) - core install detection, each
  dependency tier, update-risk derivation, truncation/incomplete, edge cases
  (no fqbn, malformed fqbn, empty provider map). Parsing/normalization reuse the
  existing `packageService` parser tests.
- Integration (later): arduino-cli lib list `provides_includes` reality, the
  gatherer composing real inputs.
- Regression (from the audit): ESP32 core install, missing-dependency diagnosis,
  simulator/library mismatch, single-file build, PlatformIO execution, generic
  build error -> structured diagnosis. Each becomes a permanent test as its
  slice lands.

## 13. Extension points (from the subsystem map)

- `packageService` core/lib search+list are the resolve/install primitives to
  compose (never re-shell).
- `projectModelService.buildProjectModel` is the declared+used source; extend
  `parsePlatformioIni` with `lib_deps` and reconcile `libraries` (#include
  headers) against installed libs here.
- `hardwareGraph` gains core/library/framework node kinds for the Dependency
  Graph (a superset, sharing provenance and the DEVICE_MAP header->device link).
- `simService.start` compileArgs is where per-library shims/include paths make
  "the sim can actually run this library" real; a declared sim-capability
  surface drives the graph<->simulator consistency check.
- Sidebar rail, `runPackageOp`, the agent tool/approval pattern, and the
  ipc->preload->main bridge are the wiring seams for every new surface.

## 14. Implementation order (slices)

1. **Foundation (this slice):** the pure environment model + `reconcileEnvironment`
   engine + unit tests. No wiring; the brain first.
2. Gatherer service + IPC + a Project Dependencies / Environment panel that
   renders the report (Taste-Skill), reusing `runPackageOp` for installs.
3. Missing-dependency -> install and update flows; command-palette entries.
4. Environment Doctor: findings grouped, build-result correlation, hardware-aware
   checks against the graph, proposed fixes.
5. Reproducibility: manifest + lock + snapshot + project import.
6. PlatformIO / arduino-cli / ESP-IDF execution integration.
7. Simulator capability surface + graph<->simulator consistency + per-library
   hardware requirements.
8. Agent tools (inspect/diagnose/propose-change) behind the approval gate.

Each slice: plan -> implement -> test -> adversarial review -> fix -> verify ->
commit -> document -> reassess.
