# Cortex Implementation Plan

This is the master, dependency-aware plan for evolving Cortex from its current
audited state into a hardware-aware, AI-native embedded engineering platform.

It is driven by two pieces of research:

- The **20-user first-time-user product audit** (0 of 20 would adopt Cortex as
  their primary tool today; average overall 3.6/10; 21 P0 blockers). The full
  audit is a separate artifact; its findings are cited inline below as evidence.
- A **12-subsystem ground-truth code audit** that established what actually
  works vs. what is partial, stubbed, missing, or a paper feature.

It is executed with a disciplined loop (plan, implement, test, review, polish,
verify, repeat), using the Turbo skill set for the engineering process and the
Taste-Skill set for UI work. Code review runs every phase.

House rules that apply to every change: no fake functionality, no paper
features, no em dashes anywhere in the repo (enforced by `test/style.test.ts`),
preserve Electron security boundaries, keep the renderer responsive, and never
mark a feature done until the underlying behavior works and is tested.

## North star

> A first-time ESP32 user can reasonably say: "this actually understands what
> I'm building."

The product's two genuine differentiators, confirmed by nearly every audited
user, are the **real compiled simulator** and the **derived hardware graph**.
Every phase should either protect and deepen those, remove a wall that stops a
user from reaching them, or connect them into a loop the AI can act on.

---

## Priority matrix

### NOW (unblock basic adoption; without these users leave in the first session)

- Integrated terminal (pty-backed) so CLI workflows (esptool, idf.py, pip, git,
  custom scripts) are possible at all.
- Fix the first-run compiler wall: detect a missing host compiler before New
  Sketch, one-click install or bundle, and never dead-end on raw CLI text.
- Add board-index URLs so the ESP32 core installs from inside Cortex.
- Close Folder / switch workspace (explicit user request; today a folder cannot
  be closed to open another).
- clangd include configuration so member completion works on library types
  (the reported `Servo myServo; myServo.` gap; also fixes cross-file
  references and go-to-definition in Arduino/ESP32 projects).
- Make the AI project-aware: multi-file read, the Problems/diagnostics feed, and
  file edits with a reviewable diff behind an approval gate (first agent step).
- Retire the remaining paper features surfaced by the audit.

### NEXT (earn the switch; the real differentiators)

- The full AI Engineering Agent tool loop (compile, run, simulate, iterate,
  approval-gated) grounded in the hardware graph.
- On-chip debugging (OpenOCD + GDB over SWD/JTAG) for ESP32, with register and
  RTOS-task views, reusing the working host MI2 layer.
- Simulator parts and library shims (Servo, Wire, SPI, plus a few modeled
  I2C/SPI devices), starting with the parts the hardware graph already names.
- Git / source-control panel (status, diff, stage, commit, push, gutter markers).
- Real project build: multi-file linking and a PlatformIO passthrough that runs.
- Split editor / draggable tabs (explicit user request; drag a tab left/right to
  open a second editor group, like VS Code / JetBrains / Visual Studio).

### LATER (depth and reliability once the core loop holds)

- Reproducible builds: a project manifest with pinned dependency versions.
- Board bring-up wizard (detect, install core, build, flash).
- Embedded static analysis (ISR misuse, memory, timing, GPIO conflicts, RTOS).
- Logic-analyzer / protocol decode (I2C/SPI/UART); hardware replay.
- Datasheet / schematic intelligence.
- Hardware-aware git diffs; Cortex Doctor health analyzer.
- Editor preferences (font, tab size, minimap, word wrap), themes, configurable
  keybindings, embedded education explainers.

### DO NOT BUILD (now): complexity without enough payoff yet

- A cycle-accurate MCU emulator (the host logic simulator is the right bet;
  deepen it with parts and shims instead).
- A full CubeMX-scale peripheral configurator.
- A from-scratch package registry (lean on arduino-cli / pio).
- Broad multi-language expansion beyond C/C++/Python.
- More dashboards or decorative panels.

---

## Already shipped (baseline this plan builds on)

- **Project model** (`src/main/services/projectModelService.ts`): derived
  languages, board (from platformio.ini, never guessed), GPIO pin usage, bus
  usage, and library includes; vendored dirs excluded. Tested.
- **Hardware graph** (`src/shared/hardwareGraph.ts`): board / pin / bus / device
  / file nodes with provenance edges and a strictly-gated `likely-on-bus`
  inference; a curated `DEVICE_MAP` of Arduino driver headers. Rendered in the
  Hardware panel. Tested.
- **Editor actions + trust cleanup** (this program's first slice): real LSP
  rename / find-references / document-formatting providers, the previously-dead
  Auto Format menu item wired, the advertised menu accelerators made real, the
  decoy status-bar git icon replaced with a folder icon. Pure edit-application
  helper (`src/shared/textEdit.ts`) unit-tested and reusable by the agent.
- Supplemental stdlib dictionary + a recurring cloud agent that expands it.

---

## Phase 0: Stabilization

**Goal:** a trustworthy foundation. No advanced work lands on broken basics.

- **Retire paper features.** *Problem:* the audit found several UI surfaces that
  imply capabilities that do not exist, and multiple users called this
  "bait-and-switch." *Evidence:* dead theme setting (persists, nothing applies
  it); decoy git icon (done); disabled Debug button; unbacked Rename/Format
  (done); PlatformIO/CMake detected but never invoked. *Desired:* every visible
  control is either real or honestly absent. *Slices:* (a) editor actions +
  git icon [done]; (b) either implement a light theme + a Settings control or
  remove the theme field; (c) either wire a PlatformIO/CMake build or stop
  presenting them as usable toolchains; (d) keep the Debug button but make its
  disabled reason unmistakable until on-chip debug lands. *DoD:* no control in
  the UI does nothing when clicked.
- **Guard fragile subsystems with tests.** The build runner, LSP bridge, serial,
  and simulator protocol are the load-bearing pieces; keep their coverage strong
  as they change. *DoD:* full suite green before and after every phase.

## Phase 1: Modern IDE foundations

**Goal:** the table-stakes an IDE user assumes exists. Reference the user's
installed IDEs (Arduino, JetBrains, Visual Studio 2022) for interaction models.

- **Close Folder / switch workspace.** *Problem:* "when I open a folder in
  Cortex I cannot close it and open a different one." *Evidence:* user report;
  no workspace-close path exists. *Current:* `openWorkspace` swaps the root but
  there is no "close" that returns to the Welcome screen, and opening a second
  folder silently replaces the first with no clear affordance. *Desired:* a File
  menu item and command-palette entry "Close Folder" that returns to Welcome,
  saving dirty tabs first; "Open Folder" from an open workspace switches cleanly.
  *Dependencies:* none. *Slices:* (1) store `closeWorkspace()` action that saves
  all, clears workspace-scoped state, and returns to Welcome; (2) File menu +
  palette entries; (3) Ctrl+K Ctrl+F or similar. *Testing:* store unit tests for
  the close/switch transitions; verify no stale LSP docs or watchers linger.
  *DoD:* a user can go project A to Welcome to project B with no leftover state.
- **Editor tabs: drag to reorder and drag to split.** *Problem:* "I have
  main.cpp and main.py open, I want to drag one to the right or left" to view two
  files side by side. *Evidence:* user request; reference VS Code / JetBrains /
  VS 2022 split groups. *Current:* single editor group, tabs cannot be
  reordered or split. *Desired:* draggable tabs that reorder within a group and,
  when dragged to an edge, open a second editor group (horizontal split).
  *Dependencies:* editor group state in the store; `CodeEditor` already keys by
  path so multiple instances are feasible. *Slices:* (1) tab drag-to-reorder;
  (2) a two-group split layout with an independent active tab per group; (3)
  drag-to-edge to move a tab into the other group; (4) close-group and
  focus-follows behavior. *UI/UX:* run the redesign taste skill on the tab strip
  and group chrome; keep it dense and precise, not decorative. *Testing:* store
  tests for group/active-tab transitions. *DoD:* two files visible side by side,
  each independently scrollable and editable.
- **Integrated terminal.** *Problem:* no shell to run any command; the single
  most-cited P0 (9 users). *Evidence:* audit; users go back to VS Code "within
  the hour." *Current:* only an internal build/run process executor; no
  node-pty/xterm. *Desired:* a pty-backed terminal panel scoped to the workspace,
  with the workspace as cwd and the detected toolchains on PATH. *Dependencies:*
  add node-pty (native, prebuild concerns) and xterm; a new IPC surface with
  strict lifecycle. *Security:* a real shell conflicts with the current
  command-allowlist model; decide and document the boundary (a user-driven
  terminal is user-authorized; AI-driven commands still pass the allowlist /
  approval gate). *Slices:* (1) main-process pty service + IPC; (2) xterm panel
  in the bottom dock; (3) multiple terminals + lifecycle cleanup. *Testing:*
  pty spawn/kill lifecycle tests; verify no orphaned processes on close.
  *DoD:* a user can run `git status`, `pio run`, `esptool.py` in the app.
- **Git / source control.** *Problem:* no version control; blocks OSS, teams,
  production (5 users). *Evidence:* audit; the branch icon was decoy (fixed).
  *Desired:* a Source Control panel: status, diff, stage/unstage, commit, push,
  and editor gutter change markers. *Dependencies:* a git service in the main
  process (shell to the git binary, or a library); the terminal (Phase 1) gives
  an immediate partial workaround. *Slices:* (1) git status + diff read; (2)
  stage/commit/push; (3) gutter decorations from the working-tree diff.
  *Security:* read/write confined to the workspace; never expose credentials.
  *DoD:* a user can stage, diff, and commit a change without leaving Cortex.
  *Note:* this is the base layer the hardware-aware-git vision (Phase 11) sits on.
- **Workspace and tab persistence.** *Problem:* open tabs are not restored on
  relaunch; the editor comes back empty. *Evidence:* audit; VS Code restores
  sessions. *Desired:* persist open tabs, active file, and expanded-tree state
  per workspace. *Slices:* persist tab list to per-workspace state; restore on
  open. *DoD:* reopening a project restores the editor exactly.

## Phase 2: ESP32-first workflow

**Goal:** make ESP32 the best-supported platform, end to end.

- **clangd include configuration for library member completion.** *Problem:*
  "I have ESP32Servo.h included; `Servo myServo;` then `myServo.` did not
  suggest `writeMicroseconds`; and typing `Serv` should suggest the `Servo`
  class with an explanation and a documentation link." *Evidence:* user report;
  and the same root cause makes find-references / go-to-definition return
  nothing in ESP32 projects (clangd cannot resolve library types because it
  cannot find their headers). *Current:* `clangdConfig.ts` writes a `.clangd`
  with `-Wall -Wextra` and target/isystem flags, but Arduino/PlatformIO library
  include paths (`.pio/libdeps/**`, core headers) are not on clangd's search
  path, so library symbols do not resolve. *Desired:* Cortex discovers the
  project's library and core include directories (from `.pio/libdeps`, the
  Arduino core, `platformio.ini` `lib_deps`) and feeds them to clangd, so member
  completion, hover, references, and definition all work on library types.
  For symbols the LSP still cannot describe well, fall back to the curated
  dictionary (the same mechanism already used for the stdlib), so a class like
  `Servo` shows a description plus a documentation link (the Roblox-Studio-style
  popup the user asked for). *Dependencies:* the project model already locates
  libraries; extend `clangdConfig` to emit `CompileFlags.Add: [-I...]`.
  *Slices:* (1) discover include dirs from the project model; (2) write them
  into `.clangd`; (3) restart clangd on config change; (4) seed a hardware
  library dictionary (Servo and a few common classes) with per-method
  descriptions and arg docs, grown by the recurring dictionary agent.
  *Testing:* unit-test the include-dir discovery; live-verify member completion
  on a real ESP32Servo project. *DoD:* `myServo.` lists the `Servo` methods with
  descriptions, and `Serv` suggests the class with a doc link.
- **Board-index URLs + board-aware New Sketch.** *Problem:* the ESP32 core
  cannot be installed from inside Cortex; New Sketch never asks which board.
  *Desired:* an "Additional board URLs" setting (pre-seed ESP32/ESP8266/STM32),
  and a board picker folded into New Sketch that templates pin constants per
  board. *DoD:* a new user installs the ESP32 core and creates a board-correct
  sketch without leaving the app.
- **First-run compiler handling.** *Problem:* the "no hardware needed" blink
  silently needs a host C++ compiler and dead-ends on install text. *Desired:*
  detect the missing compiler up front and offer a one-click install with
  progress, or bundle a minimal toolchain. *DoD:* New Sketch reaches a blinking
  LED or a clear guided install, never a raw CLI wall.

## Phase 3: Cortex engineering agent (keystone)

**Goal:** turn the AI from a single-file chatbot into a project-aware embedded
engineering agent. This is the differentiator no general coding agent has,
because it can be grounded in the hardware graph.

- *Problem:* the AI sees only the active file, has no tools, cannot edit,
  compile, run, or iterate (the audit's single biggest strategic gap; the
  product's own vision section 7). *Evidence:* `aiService.ts` is a plain
  streaming completion with a fixed context string.
- *Desired:* a controlled tool loop. Safe tools (read file, search, inspect
  hardware graph, inspect diagnostics, compile, simulate, run tests) run freely;
  review-required tools (edit/create file with a reviewable diff, change config,
  install a dependency) go through an approval gate; explicitly-authorized tools
  (flash, erase) require a deliberate confirmation. Every action is auditable.
- *Dependencies:* file-edit-with-diff reuses `src/shared/textEdit.ts`; the
  diagnostics feed, project model, and hardware graph already exist; the build
  runner and simulator already exist. The main missing piece is a tool-dispatch
  layer and a UI that shows the plan, tool calls, diffs, and results.
- *Slices:* (1) project-wide read + diagnostics context (a NOW step); (2)
  file-edit-with-diff behind an approval gate; (3) compile/run/simulate tools
  with results fed back; (4) the iterate loop (read compiler errors, fix, repeat)
  until green; (5) the safety-tier UI. *Security:* AI-generated commands pass the
  same boundaries as user-triggered ones; flashing is always gated.
- *DoD:* "add MPU6050 support" or "fix the compile errors" results in a proposed
  diff the user can review and apply, after the agent read the relevant files and
  the diagnostics itself.

## Phase 4: Debugger (on-chip)

- *Problem:* GDB is real but host-only; no ESP32 on-chip debug, no registers /
  memory / threads. *Desired:* OpenOCD + GDB over SWD/JTAG for ESP32, reusing the
  MI2 translation layer, plus register/memory/RTOS-task views. *DoD:* a user sets
  a breakpoint in firmware running on a real ESP32 and inspects a register.
  *Note:* needs real hardware to fully verify; build behind honest capability
  detection.

## Phase 5: Library / dependency management

- *Problem:* no dependency resolution, no lockfile, failures collapse to "No
  libraries found." *Desired:* dependency resolution, a lockfile/manifest for
  reproducible builds, and honest failure diagnostics. *DoD:* a project's exact
  library set can be reconstructed by a teammate or CI.

## Phase 6: Project intelligence (deepen)

- Extend the model/graph: board-specific pin-name resolution (`LED_BUILTIN` to a
  real pin per board), physical bus pinout (which pins are SDA/SCL), and address
  resolution through `#define`. Persist a real project manifest as the source of
  truth connecting build, hardware, simulation, tests, and AI.

## Phase 7: Embedded static analysis

- Cortex-specific diagnostics beyond the compiler: ISR misuse, blocking calls in
  interrupt context, heap use in inappropriate contexts, GPIO/peripheral
  conflicts (cross-checked against the hardware graph), RTOS stack/priority
  risks. Each finding explains what is wrong, why it matters, the impact, and a
  fix. Built as a plugin-friendly rule system.

## Phase 8: Simulation + testing

- Add library shims (Servo, Wire, SPI) and a few modeled I2C/SPI devices so
  library sketches compile and the simulator can represent real circuits;
  fix the servo/ADC fidelity gaps. Add a Given/When/Expect test format that runs
  real firmware in the simulator. This closes the loop between the two pillars
  (the graph recognizes a device the simulator can then actually run).

## Phase 9: Datasheet / schematic intelligence

- Import datasheets/schematics and correlate them with source, the hardware
  graph, and telemetry, with citations back to the document. Grounded retrieval,
  not superficial PDF chat.

## Phase 10: Hardware replay / observability

- Capture serial/GPIO/I2C/SPI/PWM/ADC/reset/watchdog events into a replayable
  session format; replay into the simulator/analysis for reproducing
  intermittent failures.

## Phase 11: Cross-cutting

- **Hardware-aware git:** layer embedded semantics onto normal git diffs (for
  example, "I2C SCL moved PB6 to PB7", "PWM 20 kHz to 10 kHz"), using the
  hardware graph. Needs Phase 1 git first.
- **Cortex Doctor:** a project-health analyzer whose scores come only from real
  diagnostics and measurable signals, with an "analyze" and eventually a
  "fix safe issues" action.
- **User-workflow regression suite:** convert the 20-user journeys into permanent
  automated coverage (first ESP32 project, library install, simulator servo,
  debugger, git, terminal, AI, serial, flashing).

---

## Sequencing rationale

Trust and access come first (Phase 0-1): a user who cannot open a terminal,
switch folders, or trust the UI never reaches the differentiators. ESP32-first
(Phase 2) removes the platform-specific walls and delivers the member-completion
win the user asked for. The agent (Phase 3) is the keystone that turns the
existing capabilities into a reason to switch. Debugger, dependencies, and
deeper intelligence (Phase 4-8) follow as the core loop stabilizes. The
document, replay, and cross-cutting layers (Phase 9-11) are where Cortex stops
resembling any other IDE.

Progress is tracked in `CORTEX_PROGRESS.md`. Significant architectural decisions
are recorded in `CORTEX_DECISIONS.md`.
