# Cortex IDE UI/UX Rework  -  Plan of Record

A staged rework toward a professional embedded-engineering IDE (CLion / VS Code /
Arduino-grade information architecture) while keeping Cortex's own identity
(hardware-first, AI-native). Driven as an autonomous `/loop`: one shipped slice
per iteration  -  plan → implement → typecheck + test + build → live-verify (CDP on
:9222) → adversarial review workflow → fix → commit + push → tick this doc → next.

This is the living checklist. Each phase lists the concrete audit findings it
closes (from the `cortex-ui-audit` workflow, 2026-09-01).

## Current-state facts (audit)

- Shell (App.tsx): `TitleBar → [ActivityBar | SideBar? | main(EditorArea + BottomPanel) | AiPanel?] → StatusBar`. Panels are flush (no framed islands). No right-edge rail; the AI panel is a left-rail-toggled right panel. Splitters resize sidebar/ai/bottom.
- Theme: a real semantic token set exists (`ide-*` in tailwind.config.js, documented in docs/THEME.md) and is used consistently (audit found ZERO raw non-ide color classes). Only ONE theme (Cortex Dark); a persisted `theme: 'dark'|'light'` field is dead.
- Dialogs: destructive confirms use native `window.confirm` (FileExplorer delete, close-tab discard) and `dialog.showMessageBox` (main). The About modal (MenuBar) is fully themed and is the template.
- Build config (compiler / std / optimization / rust edition) lives crammed in the 36px `TitleBar`, next to Run/Verify/Upload/Debug/board/serial  -  NOT in Settings. It is per-project (ProjectConfig) but has no home in a settings surface.
- Settings (SettingsPanel) is a flat single scroll boxed in the ~256px sidebar; no scope separation, no search; mixes editable settings with a read-only tool-detection report; omits `theme` and `serial.baudRate`.
- Renderer is clean of dead affordances except: a permanently-disabled "coming soon" on-chip Debug button in the sketch toolbar; a static `<span>UTF-8</span>` in the status bar; DebugPanel transport controls shown disabled (no reason) when idle.

## Design principles

- Honesty: every control works, is honestly disabled with a reason, or is absent. No blueprint/implementation-leak strings; no fake capability.
- One concept, one home. Context over chrome (surfaces adapt to the task).
- Progressive disclosure: beginner-clear by default, advanced available.
- Build on the existing `ide-*` token system; add a Light theme and a small set of elevation/surface tokens rather than scattering literals.
- Keep Cortex identity: Hardware / Simulator / Datasheets / Environment / Agent are first-class, not bolted on.

## Central terminology (product language, not implementation)

`arduino-cli` → "board tools" / "board support". `N toolchains` → "C++ · ESP32"
(language · board). `platformio.ini` → (do not surface; Cortex is FQBN-based).
raw `-O0/-Os` → Debug / Balanced / Release / Size. raw `g++/clang++` → GCC / Clang
(binary as tooltip). `gdb` → "the debugger" / "Debug". `provider` → "AI model".
`safeStorage` / `main process` → "your OS secure storage" / "your machine".
`toolchains` (menu/palette/settings) → "Build" / "Compilers". `.cortex/diagram.json`
→ "saved with the sketch". `stdin` → "Input". A central `src/shared/strings.ts`
(or renderer strings module) holds shared labels so they do not drift.

## Phases

### Phase 1  -  Audit + plan  ✅ (this doc)

### Phase 2  -  Design-system foundation
- Themed `Dialog` + `ConfirmDialog` primitive (ide-* tokens, focus trap, Esc/Enter, danger variant). Replace `window.confirm` at FileExplorer delete + close-tab discard [audit HIGH]. ✅ (56bcf74). Routing the main-process close/exit confirm through it too is still open.
- Cortex **Light** theme ✅: `ide-*` tokens are now CSS variables (styles/index.css `:root` = Dark, `:root[data-theme='light']` = Cortex Light) consumed via `rgb(var(--ide-x) / <alpha-value>)` in tailwind.config.js, so opacity utilities still work. App stamps `<html data-theme>` from `settings.theme` (dark = no attribute); `setTheme` action persists it; SettingsPanel has an Appearance Dark/Light toggle; a `cortex-light` Monaco theme tracks it. contrast.test.ts now pins WCAG AA for BOTH palettes (parsed from index.css). Live-verified via CDP.
- Framed rounded "island" panels ✅: the middle row (after the flush ActivityBar) is a padded `gap-2 p-2` field on the ide-bg ground; SideBar / EditorArea / BottomPanel / AiPanel / SimulatorView / Welcome each render as a `rounded-lg border border-ide-border` island; splitters live in the gutters and still resize; both themes correct. Monaco needed a container `ResizeObserver` (its `automaticLayout` locked onto a collapsed mount size inside the new flex nesting and never recovered, rendering the editor ~5x5) plus `fixedOverflowWidgets` so suggest/hover are not clipped by the card's `overflow-hidden`. Live-verified via CDP.
- Phase 2 is complete except routing the **main-process** close/exit confirm (`dialog.showMessageBox`) through the themed dialog, which is tracked for a later slice.

### Phase 3  -  Shell chrome (split into 3a / 3b / 3c)
- **3a** ✅ Split the top bar into two tiers. TitleBar is now slim (app mark, MenuBar, project/file breadcrumb) with a right-side icon cluster: Search (opens the command palette), Settings (opens the settings sidebar, highlights when open), Cortex Agent (toggles the AI panel, highlights when open). Notifications is intentionally omitted until Phase 8 (no feature to back it). All run/build/board/serial controls moved verbatim into a new dedicated `Toolbar` row (`components/Toolbar.tsx`) rendered by App below the title bar [audit HIGH: overloaded title bar]. Live-verified via CDP.
- **3b** ✅ Build config moved out of the raw toolbar selects into a **Target/Environment selector** (`components/TargetSelect.tsx`): a button summarizing the target (`GCC / c++23 / Debug`, `GCC / c17 / Debug`, `Rust 2021 / Debug`) that opens a themed popover (Esc/backdrop close, role=menu). Host C/C++ groups: Compiler (GCC/Clang label + binary subtitle, probed host drivers, cDriver/cppDriver mapping for .c), Language standard, Optimization as Debug/Balanced/Release/Size mapped to real -O0/-O2/-O3/-Os (raw flag shown on each row). Rust groups: Edition + Profile (Debug -O0 / Release -O2, preserving prior behavior). Honesty: a project pinned to a non-preset level (-O1/-Og/-Ofast) is preserved and shown as a read-only `Custom <flag>` row rather than mislabeled; those advanced levels are no longer selectable from the popover by design (project config / a later Settings surface). Per-project ProjectConfig wiring preserved. Live-verified via CDP for cpp/c/rust.
- **3c** ✅ Run-toolbar polish. The Toolbar now renders only for the editor working on a project (`workspaceRoot && mainView !== 'simulator'`) - hidden on Welcome and in the Simulator (own Run/Stop), closing the earlier inert/duplicate-Run notes. A Problems chip counts errors/warnings from the real diagnostics feed (solid red/amber on the bar, not a tinted badge, so AA holds) and opens the Problems panel; it disappears when clean. A build-phase indicator (spinner + Compiling/Uploading/Running from runAction+runPhase) narrates the in-progress build beside Stop. Double-fire was already prevented (the action group is only Stop while running). Live-verified via CDP. **Phase 3 complete.**

### Phase 4  -  Tool rails + tool-window model (split into 4a / 4b / 4c)
- **4a** ✅ Left ActivityBar declutter. The flat 12-icon rail is now: primary pinned tools (Explorer, Search, Hardware, Environment, Datasheets, Serial), a **More tools** overflow popover (Boards Manager, Library Manager, Debug), the mode toggles (Simulator, Cortex Agent), then a workspace-gated bottom group (Terminal, Problems) for one-click dock access, then Settings. Version Control is intentionally omitted (no Git surface exists yet; it arrives in Phase 10). Live-verified via CDP. (Naming: the rail's AI toggle is labelled "Cortex Agent" to match the title-bar cluster; the AiPanel header / palette / settings still say "AI Assistant" - unifying that is the Phase 7 terminology purge.)
- **4b** ✅ New **right dock + right-edge rail**. The boolean `aiVisible` became `rightView: 'agent' | 'datasheets' | null`: the right region (App.tsx) now hosts the Agent (AiPanel) OR the Datasheets (new DatasheetsDock framing the existing DatasheetsPanel), and a new `RightRail` (components/RightRail.tsx, flush right, mirroring the ActivityBar) toggles between them. Datasheets and the Agent moved OFF the left ActivityBar to the right (where reference/assist tools belong, next to the editor - the user's "datasheets on the right" ask). toggleAi/title-bar/palette all drive rightView consistently; localStorage migrates the old aiVisible flag. Notifications omitted until Phase 8. Live-verified via CDP (mutually-exclusive dock, consistent Agent toggles, left rail decluttered).
- **4c** Dockable tool-window model: let bottom/right host any tool window; allow two visible at once; persist location [audit MEDIUM]. **Deferred:** the left sidebar + right dock + bottom panel now cover the core docking needs; a general drag-dock system is a large architectural investment with lower marginal value than Phases 5-9, so it is parked until those land (or a concrete need arises).

### Phase 5  -  Status bar ✅
- Product-concept segments: project, build/run state, device/serial, board, LSP, language, line-endings, cursor position, unsaved. KILLED the raw `N toolchains` string (audit HIGH; Settings stays reachable via the title-bar cluster / left rail / Ctrl+,) and the static `UTF-8` (audit low). Line-endings are REAL (CRLF/LF from the file's own content, via the tested pure `src/shared/textInfo.ts`); cursor position (Ln/Col) is wired from Monaco through a new `cursorPos` store field, cleared when no editor is focused. git omitted (no Git surface). Target + Problems are intentionally NOT duplicated here - they live in the Toolbar (3b/3c). Encoding omitted rather than faked. Live-verified via CDP.

### Phase 6  -  Settings redesign (split into 6a / 6b)
- **6a** ✅ Promoted Settings to a full editor-area surface (`components/SettingsView.tsx`, a framed island rendered on the new `mainView === 'settings'`) with a left category nav (Appearance / Build / AI / Board Manager / read-only Diagnostics) + a wide `max-w-2xl` content pane [audit HIGH: boxed in sidebar]. The old sidebar 'settings' view is retired (removed from SidebarView; SettingsPanel deleted); every entry point (rail, title bar, Ctrl+comma, palette, MenuBar x2, AI configure buttons) routes to `setMainView('settings')`; opening/focusing a file returns to the editor; the run toolbar hides in settings. All wiring preserved (theme, build defaults, AI incl. the main-process API key, board URLs, tool-detection rescan). Live-verified via CDP.
- **6b** ✅ Settings search + `serial.baudRate`. SettingsView's per-category content became a searchable **field registry** ({cat, label, keywords, el}); a nav search box filters the real fields across categories (label/keywords/category match, grouped results + a "No settings match" empty state, dimmed non-matching categories, category click clears the query). A new **Serial** category surfaces `serial.baudRate` (9600-921600 select) wired to `setSerialBaud` (persists + applies to an open port; the serial monitor reads the same value). Live-verified via CDP. **Progressive disclosure of the advanced `-O` levels is deferred to a small 6c.** (Scope separation into User/Project/System folded away - the categories already separate concerns; theme wired in 2b/6a.)

### Phase 7  -  Terminology + dead-affordance purge (split into 7a / 7b)
- **7a** ✅ AI naming unified + dead affordances removed. **Naming decision: the AI feature is "Cortex Agent" everywhere** (it was already the chrome name; the agent + chat/ask modes live inside it). Applied to the AiPanel header, the palette "Toggle Cortex Agent" command, and the SettingsView category (was "AI Assistant" / "AI"); no "AI Assistant" string remains in the renderer. Dead affordances removed: the permanently-disabled on-chip Debug "coming soon" button in the sketch toolbar is deleted (host C/C++ Debug stays, it is real), and the DebugPanel transport controls (Continue/Step/Stop) now render only during an active session (idle shows the honest "Start Debugging" state). Live-verified via CDP. (Static `UTF-8` was already killed in Phase 5.)
- **7b** Broad terminology sweep: apply the central map to the remaining ~audit strings (Devices, Boards/Library search + empty states, Hardware, tooltips, OutputConsole, TerminalPanel, menus) where copy is still raw/implementation-flavoured. Surgical - only user-facing copy that is genuinely unclear.

### Phase 8  -  States + notifications
- **8a** ✅ (found already done) Real terminal first-run: the terminal is a live pty-backed xterm (TerminalPanel + terminalController) with honest exited/unavailable states + Restart, and Output/Serial/Problems already carry honest empty states; no "Press F5"-style blueprint strings remain (fixed in earlier work). Static `UTF-8` was killed in Phase 5.
- **8b** ✅ Themed notifications/toast center [audit MEDIUM]. A store slice (`notifications` newest-first capped 50 + `notifUnread`; `notify`/`markNotifsRead`/`clearNotifications`), a `Toasts` host (bottom-right cards; success/info auto-dismiss, errors sticky; aria-live), and a status-bar **bell** with the unread count + a history popover (Clear all). `handleRunExit` emits real notifications for verify/upload/build/run success+failure, so an async result no longer needs the Output panel open to be seen. Live-verified via CDP.
- **8c** Coherent empty / loading / error / disconnected / needs-setup / unsupported states across the remaining surfaces, each answering what happened + what to do next (most are already honest; sweep for the gaps).

### Phase 9  -  Debugger first-class
- **Audit finding** The coherent sectioned layout was already built and honest: `DebugPanel` has the transport row (Continue/Pause, Step Over/Into/Out, Stop, gated to an active session in 7a), a **Call Stack** (clickable frames selecting the frame), **Variables** (locals + args of the selected frame), **Watches** (persistent expressions re-evaluated on each stop via the real `debugEvaluate`), and **Breakpoints** (list, reveal, remove), each with an honest empty state and a per-language idle explanation ("Arduino sketches cannot be debugged with host gdb...", "A header is not a program..."). The editor already decorates the current execution line (`cortex-debug-line` + arrow glyph) and breakpoint gutter dots. The debugged program's own stdout plus gdb/system messages already stream to the **Output** panel (`appendDebugOutput`).
- **9a** ✅ Expandable variable / value inspection. Variables and Watches showed a whole struct or array as one flat gdb string (`{id = 7, calib = {ax = 1, ay = 2}}`), unreadable and un-drillable. New pure `src/shared/gdbValue.ts` parses the string gdb ALREADY returned into a tree (`parseGdbValue`), and a recursive `VarNode` in `DebugPanel` renders Variables + Watches as collapsible trees (scalars stay inline exactly as before; structs/arrays get a chevron; array elements label as `[i]`; a bounded `MAX_CHILDREN` window with an honest "N more not shown"). This is presentation-only: every node's text is exactly what gdb printed - nothing is inferred or fabricated. Unit-tested (`test/gdbValue.test.ts`, 15 cases: nested structs, arrays of structs, repeat-elision, quoted commas/equals, `<optimized out>`, empty aggregates, pathological nesting). Live-verified via CDP: a nested `Sensor` struct drills `sensor -> {id, temp, calib} -> {ax, ay, az}`, chevrons appear only on aggregates.
- **9b** ✅ Debug **Console** REPL. A console input in the active-session view evaluates an arbitrary gdb expression in the selected frame (backed by the EXISTING `debugEvaluate` - no new privileged capability), echoing each entry and rendering the result as an expandable `VarNode` tree (a struct answer is as inspectable as a variable). Distinct from Watch: one-shot, non-persistent, with shell-style command history (ArrowUp/Down via the pure `src/shared/replHistory.ts`, unit-tested). Honest state gating: the input is inert unless paused, with a "Pause execution to evaluate" placeholder; a `pending` flag keeps "evaluating..." distinct from a genuinely empty result. Review (13 agents) found + fixed two real MEDIUM defects: (1) the console log survived a session boundary, so a dead process's frozen results could masquerade as the current stop - now cleared when a new session starts (`status -> 'starting'`); (2) `parseGdbValue` re-ran for every variable/watch/console value on every keystroke (CLAUDE.md section 19) - now memoized so a parse happens once per data change, off the keystroke path. Live-verified via CDP: enabled-when-paused / disabled-when-running, expression echo, history recall, and the new-session clear.
- **Backend-limited (honestly omitted, not faked)** The gdb MI2 integration (`debugService.ts`) exposes only: call stack, selected frame, that frame's variables, arbitrary expression `evaluate`, and program/gdb/system output. It does NOT provide **Registers**, **Memory**, or **Threads/Tasks** (it hardcodes `--thread 1`), so those sections are omitted rather than shown as empty fake panels. Future backend-backed increments (each needs new IPC + MI plumbing): expandable struct/array *children fetched lazily* via gdb variable objects (`-var-create` / `-var-list-children`) for values too large to print inline; a Registers view via `-data-list-register-values`; a Memory view via `-data-read-memory-bytes`. Tracked debt from 9b: console/watch state is React-mount-local, so a sidebar view toggle wipes it mid-session (consistent with every panel); lifting it to the store is a separate slice.

### Phase 10+  -  Simulator as a dockable tool window (stop it consuming the editor) · Git surface (status/commit/push) · multi-project + recent projects + project templates · hardware graph contextual actions · datasheet contextual actions · agent context indicator · View menu + keymap · accessibility · performance · responsive (1366→2560) · final first-run regression pass.

## Known engineering debt (tracked)

- Switching the main view (to the Simulator or, since 6a, to Settings) unmounts
  and remounts the editor, so Monaco loses in-file undo history / scroll / cursor
  (pre-existing for the Simulator; 6a adds Settings as a second trigger). Fix in
  a later slice: keep EditorArea mounted and toggle visibility (`hidden`) instead
  of swapping it out, so editor state survives a view switch.

## Known a11y debt (tracked, from the slice-2b review)

A dedicated accessibility slice (folds into Phase 10+ a11y) closes contrast
misses that the token-pair test does not yet catch:
- Tinted status/severity badges render `text-ide-{hue}` on `bg-ide-{hue}/15` (a
  15% tint of the same hue over panel/bg) in EnvironmentPanel and AgentView. The
  composited pair is lower than the solid pair the test pins: the red badge is
  below AA in BOTH themes (pre-existing in dark, ~4.2:1), amber/moss also dip in
  light. Fix: decouple the label hue from the tint (per-hue on-tint token, or a
  solid darker badge with near-white/near-black text) and add composite-contrast
  coverage to contrast.test.ts for both themes.
- Red action buttons/badges using `bg-ide-red/80` + `text-white` (BottomPanel
  Problems count, SerialMonitor + DevicesPanel Disconnect) measure ~4.0-4.2:1 in
  light. The `/90` sites already clear AA; do NOT switch to solid red (regresses
  dark to 3.72:1). Fix: a per-theme solid AA-guaranteed button-red token, plus a
  white-on-red composite check in the test.

## Discipline

Turbo loop per slice (plan → implement → test → review → fix → finalize) and
Taste discipline for every visual/UX decision. Adversarial find→verify review
workflow on each slice's diff before commit. No user-facing copy exposes
implementation details. Do not regress performance. Update this doc's checkboxes
as phases land.
