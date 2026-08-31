# Cortex Progress Log

Newest first. One entry per completed slice: what shipped, how it was verified,
and what it unblocks. See `CORTEX_IMPLEMENTATION_PLAN.md` for the full plan.

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
