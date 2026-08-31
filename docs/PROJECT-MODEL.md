# Project model

The first piece of Cortex's project-intelligence layer: a derived, read-only
picture of what a workspace actually is, built by inspecting the project
rather than asking the engineer to describe it.

```ts
interface ProjectModel {
  languages: LanguageBreakdown[]   // what's in the tree, from shared/languages.ts
  boards: BoardInfo[]              // from platformio.ini, only when one exists
  toolchains: ToolchainInfo[]      // whatever's actually installed (toolchainService)
  pins: PinUsage[]                 // pinMode/digitalWrite/digitalRead/analogWrite/analogRead call sites
  pinsTruncated: boolean           // true when the pin list is a sample, not exhaustive
}
```

## Where it lives

- `src/main/services/projectModelService.ts` builds it: `buildProjectModel(root)`.
- `src/shared/ipc.ts` has the types (`ProjectModel`, `BoardInfo`, `PinUsage`, `LanguageBreakdown`)
  and the `IPC.PROJECT_MODEL_BUILD` channel.
- The renderer calls it once per workspace open (`useStore.refreshProjectModel`,
  fired from `openWorkspace` the same way `refreshBoardStatus` already is),
  and holds the result in `projectModel` state.
- `StatusBar.tsx` shows the board name when one was found.
- `AiPanel.tsx` folds a compact summary (board/platform/framework, language
  mix, and the active file's own pin usage) into every AI request's context,
  ahead of the file content. This is the actual point of building it: the
  product's stated differentiator is that Cortex understands the system the
  firmware controls, not just the text in the editor, and this is the first
  real instance of that rather than a slogan.

## What it deliberately does NOT do

- **No board guessing.** `boards` is populated only by parsing a real
  `platformio.ini`'s `[env:NAME]` sections. An `.ino`/`.cpp` file that
  `#include`s `<Arduino.h>` does NOT get a heuristic "this is probably an
  Uno" guess - a wrong board is worse than an honestly empty list, and
  `docs/LSP.md`'s clangd bridge already had to learn that lesson once
  (Arduino.h resolution) for a related reason.
- **No exhaustive claim on pins.** The scan caps at 400 source files and 200
  pin-usage entries (`MAX_SCAN_FILES` / `MAX_PIN_ENTRIES` in
  `projectModelService.ts`) so it stays cheap enough to run on every
  workspace open without becoming the thing that makes opening a project feel
  slow. `pinsTruncated` says so when the cap was hit, so a caller (the AI
  context builder especially) never implies a complete picture from a partial
  scan.
- **No execution.** Everything here is `fs.readFile`/`fs.stat` against files
  already inside the open workspace (the same confinement `fsService` uses
  elsewhere) plus regex matching. No compiler is invoked to build this model;
  `toolchains` is just whatever `toolchainService.detectToolchains()` already
  found installed, not a fresh probe.

## Why regex instead of a real parse

There's no compile database in a bare Cortex workspace to drive a real AST
walk (the same gap `docs/LSP.md` describes for clangd - see "the toolchain
bridge"), so `pinMode`/`digitalWrite`/`digitalRead`/`analogWrite`/`analogRead`
call sites are found with a line-based regex scan
(`PIN_PATTERNS` in `projectModelService.ts`), not a real parser. This is a
real signal read from the actual source - not invented - it's just not as
precise as a proper AST would be (a call inside a `//` comment or a string
literal would still match). Tightening this to skip comments/strings is a
reasonable next increment; it wasn't done in the first pass because the
false-positive rate in practice (real firmware, not adversarial input) is low
and the added parsing complexity wasn't worth it yet.

## Extending this

The hardware graph the product vision describes (`.claude/claude.md` section
6) is the natural next layer on top of this: `pins` here is already the raw
material for "what GPIOs does this file touch," it just doesn't yet connect a
pin to a named peripheral/sensor or trace bus wiring (I2C/SPI device
addresses, which pins are SCL/SDA on a given board). `boards[].platform`
gives a starting point for board-specific pin-name resolution (mapping
`LED_BUILTIN` to an actual pin number per board) that doesn't exist yet either.
