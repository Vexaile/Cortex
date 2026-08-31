# Cortex Progress Log

Newest first. One entry per completed slice: what shipped, how it was verified,
and what it unblocks. See `CORTEX_IMPLEMENTATION_PLAN.md` for the full plan.

## Board Manager URLs: install the ESP32 core in-app (Phase 2)

Audit P0: an ESP32-focused IDE could not install the ESP32 core because there
was no way to register arduino-cli board-index URLs, so only Arduino-maintained
cores appeared. Added a persisted `boards.additionalUrls` setting, pre-seeded
with the Espressif ESP32 and ESP8266 index URLs, threaded into every core
command (search, list, install, update-index) as a single joined
`--additional-urls` argument (a hostile entry can never be read as a separate
flag; only http/https URLs pass). A Settings section lists the URLs with add/
remove. The pure URL logic lives in `src/shared/boardUrls.ts` and is unit-tested.

Verified live: `arduino-cli core search esp32 --additional-urls <esp32>` and the
app's own `coreSearch('esp32')` now return `esp32:esp32` (the real Espressif
core), which was absent before; the seeded URLs show in Settings. 7 boardUrls
unit tests; full suite green (565).

A 3-dimension adversarial review ran on the diff; all confirmed findings were
fixed and re-verified: URL validation now rejects commas/whitespace (a comma is
arduino-cli's own --additional-urls separator, so a comma inside one entry could
have smuggled a non-http index of any scheme past the http/https check);
coreSearch falls back to a search without the extra URLs when an added or
uncached index is unreachable, so a bad or offline URL no longer empties the
whole Boards Manager (verified: with an unreachable URL, `avr` still lists 7
built-in cores); the add/remove handlers read the current URL array from the
store to avoid a stale-closure race; and the settings hint no longer overstates
a manual Update Index step (a new URL takes effect on the next search/install).

## Split / draggable editor tabs (Phase 1)

The requested feature: with two files open, drag a tab to the side to view both
side by side (like VS Code / JetBrains / Visual Studio), and drag tabs to
reorder. Implemented as two editor groups (panes). The layout logic is a pure,
unit-tested module (`src/shared/editorGroups.ts`): each tab carries a group (0
or 1); `resolve()` keeps the invariants (collapse the split when a group
empties, cluster, repair each group's active tab, keep the active group
non-empty), and open/focus/close/move/reorder are pure transitions. The store
delegates to it; `openFile`, `setActive`, and `closeTab` are unchanged in
behavior for the single-pane case. `EditorArea` renders one or two panes with a
Splitter between them, HTML5 drag-and-drop (draggable tabs, an accent-tinted
drop overlay, drag-to-edge to split), and a focus indicator on the active
pane's tab. `CodeEditor` tracks editor focus so the format/rename actions target
the focused pane.

Verified live against EdgeInspect: opening main.cpp and main.py and moving one
to the second group renders two Monaco editors side by side, each 480x327 with
its own content; collapsing returns to a single editor. 18 editorGroups unit
tests, workspaceReset guard extended, full suite green. Designed with the
Taste-Skill (redesign-skill) honoring the existing dense IDE tokens, not a
generic redesign.

A 4-dimension adversarial review ran on the diff; all confirmed findings were
fixed and re-verified live: renameEntry/deleteEntry now route through the group
resolver (a renamed open file no longer blanks its pane; a deleted file no
longer strands the active group or re-splits on the next open); dropping a tab
onto an editor no longer injects the file path into the document (custom drag
mime + Monaco drop-into-editor disabled); the unsaved-changes tab dot that the
user had removed is not re-added; the focused editor now follows the active
file so Format/Rename and Save target the same pane; the single-tab split
affordance is gated so it is never a no-op; and reorder honors the pointer
(before/after the target).

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
