# Cortex Progress Log

Newest first. One entry per completed slice: what shipped, how it was verified,
and what it unblocks. See `CORTEX_IMPLEMENTATION_PLAN.md` for the full plan.

## Senior-engineer operating manual as the AI system prompt (Phase 3)

The agent and the chat assistant had short, generic system prompts. Both now run
on a real operating manual, `src/main/prompts/embedded-engineer.md`, that gives
them the discipline of a senior embedded engineer rather than a code vending
machine. It distills the workflows the human engineering process here follows:
the investigation loop (characterize, isolate, hypothesize with falsifiable
hypotheses, test one at a time, fix causes not symptoms), the code-writing
discipline (establish the code needs to exist, reuse, follow the local pattern,
mirror the surrounding code, keep symmetry, default to no comment), the review
lenses applied before proposing (correctness, concurrency/interrupts, timing,
memory, hardware, consistency/simplicity/coverage, each with a failure
scenario), plan-proportionally, verify-before-claiming-done, real embedded-domain
judgment (register/prescaler/ISR/DMA/RTOS reasoning), and two rules above all:
be honest (never fabricate a pin, register, API, or file) and ground every claim
in evidence.

The manual is the single source of truth for both surfaces: the agent's system
prompt is the manual followed by the tool contract, and the chat assistant's is
the manual followed by a no-tools note. It is authored as markdown and inlined
at build with a Vite `?raw` import (ambient-typed in
`src/main/prompts/raw-md.d.ts`), so editing the .md changes both assistants and
there is no runtime file read.

Verified: `?raw` inlines the guide into the built main bundle; a live agent run
(mock provider, user settings preserved) shows the full manual plus the tool
contract reach the model as the system prompt (9705 chars, all sections
present). Typecheck clean, style rules pass. Reviewed for embedded accuracy and
wiring before commit.

## AI engineering agent: the first real tool-loop step (Phase 3 keystone)

The AI panel was a single-shot chat: it answered questions but could not act.
This turns it into a task-oriented agent. The user chose the engine (a
provider-native tool loop with a structured fallback) and the approval
granularity (per-file approve/reject) via AskUserQuestion.

The agent runs a real tool-calling loop in the main process (Anthropic tool use
and the OpenAI tool-calls format; Gemini and unconfigured providers fall back to
a single structured-proposal request). Its scoped tools follow CLAUDE.md's trust
tiers: read_file, search_project, get_diagnostics, and get_project_model are SAFE
and auto-run behind the workspace boundary; propose_edit is REVIEW-REQUIRED and
NEVER writes to disk. It stages a whole-file replacement that the panel renders
as a unified diff; only when the engineer approves it per file does the renderer
apply it, through the same workspace-confined write path a user edit uses
(window.api.writeFile + applyExternalEdit to sync an open tab, undoable via
Monaco's controlled value). Every tool call is surfaced in the transcript, so a
run is auditable.

Security: tool paths resolve against the trusted main-process workspace root
(never a renderer-supplied path) and are confined with fsService.withinWorkspace;
no model output ever reaches a shell; the API key stays in main; the loop caps
at MAX_AGENT_STEPS; cancel stops it between steps; a workspace switch cancels the
run and clears the transcript, staged edits, and conversation (dropped by run id
if any events arrive late).

Pure logic is unit-tested and shared: agentTools.ts (tool schema, provider
adapters, the fallback JSON parser that tolerates fences/prose and ignores braces
in strings) and diff.ts (LCS line diff + collapsing hunks + a too-large guard).
The renderer view (AgentView + DiffView) lives beside the existing chat behind an
Agent/Chat toggle.

Verified live end-to-end via CDP against a mock OpenAI-compatible server (so no
real provider was needed and the user's settings were preserved, key untouched):
the loop ran read_file then propose_edit, staged exactly one PENDING edit with
nothing written to disk, and only after approve did the file on disk change to
the proposed content; the transcript rendered the tool chips and a themed unified
diff with Approve/Reject. Unit tests for agentTools and diff; workspaceReset guard
extended to the agent state.

A 3-dimension adversarial review (17 agents) ran on the diff; all eleven
confirmed findings were fixed. The critical one: approve blindly wrote the
propose-time snapshot, silently discarding unsaved editor edits or a change made
since the proposal, now approve first re-reads the file and refuses (marking the
edit "stale") if the on-disk content changed or the tab is dirty, rather than
clobbering (verified live: an out-of-band change is kept and the agent edit is
refused). The majors: string-only workspace confinement let a symlink escape via
the un-gated read_file, now the path is verified with realpath (physical
confinement) before any read or staged write; a CRLF file diffed as fully changed
and was rewritten to LF on approve, now the diff is line-ending tolerant and the
write preserves the file's existing EOL (verified live: a CRLF file stays CRLF);
plain cancel left the in-flight run streaming into the transcript, now it clears
the run id (and the loops check cancellation after each request) so late events
are dropped; the large-file path told the user to approve before reviewing, now
it warns, and a rewrite that drops most of a file shows a truncation warning; and
the O(n*m) line diff, recomputed twice per render on every streamed event, is now
memoized and single-pass. The minors (tool-chip ok flag, fallback conversation
history, a refreshTree failure mislabeling an applied edit, double-click writing
twice, and a trailing-newline-only change) were all fixed too. Re-verified: full
suite green, targeted diff/agentTools tests extended.

## Integrated terminal: a real pty-backed shell (Phase 1)

The audit's most-cited P0 (nine users, "back to VS Code within the hour"):
Cortex had no shell, so esptool, idf.py, pip, git, and custom scripts were
impossible in-app. Added a real pty-backed terminal (node-pty + xterm.js), the
execution model the user chose over a command-allowlist runner. A user-typed
terminal is user-authorized: it spawns the user's own shell (PowerShell on
Windows, $SHELL/bash on posix) at the user's own privileges, with the open
workspace as the cwd. The security boundary is explicit and preserved: the shell
is spawned as file + argv (never a shell string), the cwd is chosen in the main
process from the trusted workspace root (never a renderer-supplied path), IPC
inputs are validated, sessions are capped, and every shell is killed on window
close and before quit. AI-initiated commands do not flow through this terminal;
they stay behind the allowlist / approval gate for the agent slice.

Architecture: the pure shell/dimension logic is a unit-tested shared module
(`src/shared/terminalConfig.ts`). The pty sessions live in a main-process
service (`terminalService.ts`), loaded lazily as an optional native dependency
so a machine without the prebuilt binary still starts (the terminal reports
unavailable). The xterm view and its session live in a module-level controller
(`terminalController.ts`) outside React, so a running `pio run` survives every
way the bottom dock unmounts (tab switch, panel close, simulator switch); the
controller re-parents a persistent wrapper into whatever host mounts. node-pty
is a native module: `externalizeDepsPlugin` does not externalize
optionalDependencies, so it was being bundled and its loader could not find its
binary; the vite config now externalizes it (and serialport) explicitly.

Reachable from Tools > Terminal, the command palette, and Ctrl+` (which now
toggles the terminal, VS Code style). On a workspace switch the shell is
disposed after the root switch commits and respawns in the new project's cwd;
on Close Folder it is disposed with no stray shell. xterm.js is lazy-loaded so
it stays out of the startup bundle.

Verified live via CDP against a real workspace: the terminal spawns PowerShell
in the workspace cwd; a typed `echo` round-trips renderer -> main -> pty ->
xterm; exactly one shell survives a tab round-trip and a panel close/reopen with
scrollback intact; switching projects respawns a fresh shell in the new cwd with
no stale prompt; closing spawns no stray shell. Unit tests cover the pure
config, the service security invariants, and the controller supersession logic;
the workspaceReset guard was extended to assert terminal teardown.

A 3-dimension adversarial review (12 agents) ran on the diff; all confirmed
findings were fixed and re-verified, and four false positives were rejected
(single-window session-id ownership, output coalescing, a create-reject stuck
state, and electron-builder packaging). The findings: (1) a race, `start()` had
no supersession check across its async `create()`, so a workspace switch or
close mid-spawn could orphan a shell or double-spawn one, fixed with an epoch
captured before the await and re-checked after (the superseded start kills its
just-spawned pty and bails; dispose bumps the epoch); (2) the terminal entry
points (Ctrl+`, Tools, palette) silently no-opped from the simulator view and
with no workspace open, fixed with an `openTerminal()` action that leaves the
simulator and requires a workspace (the menu item is disabled without one); (3)
the Output tab wore the ">_" shell glyph while the real Terminal tab got the
boxed one, now swapped. A related robustness gap found during verification (a
renderer reload leaks the old ptys, since a reload never runs killAll) was also
closed by reaping terminal sessions on the renderer's next top-level load.

## First-run compiler wall: a friendly, actionable state (Phase 2)

Audit P0: New Sketch opens the Simulator, which compiles the sketch on the host,
so on a machine with no g++/clang++ it dead-ended with five cryptic lines (a raw
winget command among them) in the serial pane. Now startSim sets a structured
`simBlock` and the simulator stage shows a friendly SimBlockedPanel: a headline,
a per-OS install command with a Copy button, a follow-up note, a Recheck button
(re-scans the toolchains and runs if a compiler is now found), and a
documentation link. The OS/command mapping is a pure, unit-tested module
(`src/shared/compilerHelp.ts`). The not-a-sketch case uses the same friendly
panel instead of serial text.

Verified live: forcing the compiler-missing state shows the panel with the
Windows winget command, Recheck, and MSYS2 link; Recheck (with g++ present)
clears the block and runs the sim. 6 compilerHelp unit tests; workspaceReset
guard extended to 52; full suite green. Designed with the Taste-Skill honoring
the existing dense IDE tokens.

A 2-dimension adversarial review ran on the diff; all confirmed findings were
fixed and re-verified. The main one was a real regression: the block was cleared
only on a run or a workspace switch, so switching files left the full-height
panel plastered over a now-valid sketch, with a message that could even name a
file you had already closed. The fix ties the block to the file that raised it
(`SimBlock.path`) and renders the panel only while that file is active, so
switching tabs reveals the canvas and switching back shows the same accurate
message (verified live: the not-sketch panel appears over its file, disappears
on switching to another, and reappears on switching back). The follow-ons: the
"Add a part" wiring hint no longer overlays the blocked panel and the part
palette is disabled while blocked (parts would land on a hidden canvas); and
`detectOS` now tests mac/darwin before windows (the substring "win" inside
"darwin" had made the darwin branch dead code, so a Darwin user agent was
misread as Windows). Both the block-follows-its-file behavior and the Darwin
case are now guarded by unit tests.

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
