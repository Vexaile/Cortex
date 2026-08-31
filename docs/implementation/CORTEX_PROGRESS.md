# Cortex Progress Log

Newest first. One entry per completed slice: what shipped, how it was verified,
and what it unblocks. See `CORTEX_IMPLEMENTATION_PLAN.md` for the full plan.

## Library member/class autocomplete + clangd include config (Phase 2)

The reported gap: with ESP32Servo.h included, `Servo myservo; myservo.` offered
nothing and `Serv` did not suggest the `Servo` class. Root cause: clangd, run
under the host toolchain, cannot find the library's headers, so it cannot
resolve library types (the same reason find-references and go-to-definition
returned nothing in ESP32 projects). Two complementary fixes:

1. clangd include configuration (`clangdConfig.ts`): `discoverIncludeDirs`
   finds the project's own include/src and every library under lib/ and
   .pio/libdeps, and feeds them to clangd (project dirs as -I, vendored
   libraries as -isystem so their internal warnings stay quiet). PlatformIO
   deps are added first and all loops are capped.
2. A curated hardware-library dictionary (`src/shared/stdlib/cpp-libraries.json`,
   seeded with the full ESP32Servo `Servo` API from the real header) plus
   scope-aware completion (`src/shared/libraryComplete.ts`): infers a variable's
   type from its declaration in the same file (value, reference, and pointer
   styles) and offers that class's members with signatures, descriptions, and
   documentation links (the Roblox-style popup). It defers to real clangd
   members when clangd resolved the class (dedup on the bare name), so it
   supplements and never duplicates.

Verified live against EdgeInspect: `servo.` and `Servo *sp; sp->` both list all
13 Servo members with descriptions and no duplicates; `.clangd` now carries the
project and ESP32Servo include dirs. 41 targeted tests; full suite green.
A 4-dimension adversarial review ran on the diff; its confirmed findings (dedup
keyed on the signature-bearing label, the pointer-sigil regex gap, per-request
full-document scans, comment/string-unaware scanning, and hover over-broadening)
were all fixed before commit.

Unblocks: the same include config makes clangd resolve more library symbols
(better real completion/references/definition over time); the dictionary is
grown by the recurring agent for more libraries.

## Close Folder / switch workspace (Phase 1)

Added a `closeWorkspace` store action and File-menu + command-palette entries.
Closing saves all dirty tabs first, then runs the same teardown as a project
switch (stop run/sim/debug, stop the file watcher, dispose the root's language
servers), applies the full workspace reset, returns the main view to the editor
so Welcome shows, and forgets the last workspace so it is not reopened on next
launch.

Verified live: open project, Close Folder returns to the Welcome screen with
tabs/tree cleared and the last-workspace key removed; reopening restores the
project. Typecheck clean; workspaceReset suite extended to 47 tests (a new
closeWorkspace block asserting save-before-teardown, full reset, process/watcher/
server teardown, and return-to-Welcome).

Unblocks: a user can move between projects without restarting the app (explicit
request); the teardown path is shared groundwork for multi-root later.

## Editor actions + trust cleanup (Phase 0 / Phase 1 start)

Wired real LSP rename, find-references, and document-formatting providers over
the existing LSP bridge; the previously-dead Auto Format menu item now formats
C/C++ and Rust. Made the advertised menu accelerators real global shortcuts
(Ctrl+O, Ctrl+comma, Ctrl+Shift+M, Ctrl+Shift+I, Ctrl+T). Added the four editor
actions to the command palette. Replaced the decoy status-bar git-branch icon
with a folder icon. Rename applies correctly across files (active file undoable
via Monaco, other clean files rewritten on disk with open tabs synced, dirty
cross-file targets refused with a clear message). Extracted the edit-application
into a pure, unit-tested shared helper (`src/shared/textEdit.ts`) reusable by the
future agent file-edit tool.

Verified: formatting reflowed a real file live through clangd (Monaco has no
built-in C++ formatter, proving the new provider + bridge path). Typecheck clean,
full suite green (507 passed), textEdit helper unit-tested (7 cases).

Unblocks: the file-edit-with-diff step of the AI agent (Phase 3) reuses the
edit helper; the references/goto gap it exposed points directly at the clangd
include-config work (Phase 2).

## Hardware graph + Hardware panel

Bus and include scanning added to the project model; `src/shared/hardwareGraph.ts`
derives a board/pin/bus/device/file graph with provenance edges and a strictly
gated bus-attachment inference. New Hardware sidebar panel with click-to-jump.
Verified live against a real ESP32 project; 18 graph tests plus adversarial
multi-agent review of the diff.

## Project model

`buildProjectModel` derives languages, board (from platformio.ini only), and
GPIO pin usage, excluding vendored dirs. Feeds the AI context and a status-bar
board indicator. Tested.
