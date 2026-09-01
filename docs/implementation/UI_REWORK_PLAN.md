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

### Phase 4  -  Tool rails + tool-window model
- Left rail: primary tools + a "More tools" overflow (declutter), plus a bottom group (Terminal / Problems / Version Control) so the terminal etc. are one click away.
- New **right-edge rail** hosting Cortex Agent, Notifications, Datasheets [audit MEDIUM].
- Dockable tool-window model: let bottom/right host any tool window; allow two visible at once; persist location [audit MEDIUM: single mutually-exclusive column].

### Phase 5  -  Status bar
- Product-concept segments: project · git · target (`ESP32 · Arduino`) · build state · device/serial · language · encoding · line-endings · cursor. Grouped, clickable, information-dense but quiet. Kill the raw `N toolchains` and static `UTF-8` [audit HIGH/low].

### Phase 6  -  Settings redesign
- Promote Settings to a full editor-area surface with a category nav + wide pane [audit HIGH: boxed in sidebar].
- Scope separation: User (Appearance, Editor, Keymap, AI, board-manager URLs, defaults) · Project (the ProjectConfig build+board settings, read/write) · a read-only System/Diagnostics area (tool detection) [audit HIGH].
- Settings search; surface `serial.baudRate`; wire theme; progressive disclosure of advanced build flags [audit MEDIUM].

### Phase 7  -  Terminology + dead-affordance purge
- Apply the central terminology to all ~24 audit strings (StatusBar, Devices, TitleBar badge, Boards/Library search + empty states, Hardware, Debug panel/tooltips, Agent/AI copy, Settings, OutputConsole, TerminalPanel, palette/menu).
- Remove the 3 dead affordances: hide the on-chip Debug "coming soon" button; remove/replace static `UTF-8`; render Debug transport controls only during a session.

### Phase 8  -  States + notifications
- Real terminal first-run (no blueprint hints; a live prompt). Coherent empty / loading / error / disconnected / needs-setup / unsupported states across every surface, each answering what happened + what to do next.
- Themed notifications/toast center with a small history (status-bar bell), so async success/failure stops hijacking the bottom panel [audit MEDIUM].

### Phase 9  -  Debugger first-class
- Coherent layout: controls · Call Stack · Variables · Watches · Breakpoints · Threads/Tasks · Registers · Memory · Console. Honest empty state when idle; clear explanation when unavailable for a target.

### Phase 10+  -  Simulator as a dockable tool window (stop it consuming the editor) · Git surface (status/commit/push) · multi-project + recent projects + project templates · hardware graph contextual actions · datasheet contextual actions · agent context indicator · View menu + keymap · accessibility · performance · responsive (1366→2560) · final first-run regression pass.

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
