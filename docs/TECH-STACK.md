# Technology Stack & Decisions

## Current stack (v0.1)

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | **Electron 33** | Runs today on the target machine with zero extra toolchains; it's what Cursor itself uses ("a wrapper around VS Code"). Reliable native-module support (`serialport`). |
| Build tooling | **electron-vite** + **Vite 5** | One config builds main/preload/renderer; fast HMR; first-class TS. |
| UI | **React 18 + TypeScript** | Component model the whole team knows; strict typing across the IPC boundary. |
| Styling | **Tailwind CSS 3** | Rapid, consistent theming; a JetBrains-"Darcula" palette in `tailwind.config.js`. |
| Editor | **Monaco** (`@monaco-editor/react`) | Literally VS Code's editor - syntax highlighting, minimap, IntelliSense, folding, multi-cursor for free. Bundled locally (no CDN) for CSP. |
| State | **Zustand** | One small store, no boilerplate, easy to subscribe to streamed IPC. |
| Icons | **lucide-react** | Clean, consistent line icons. |
| Serial | **serialport** (native) | Cross-platform serial I/O; lazy-loaded so a failed native build never blocks startup. |
| File watching | **chokidar** | Robust cross-platform FS events. |
| AI | **fetch** → Anthropic Messages API / OpenAI-compatible | Streaming completions; provider-agnostic (Anthropic, OpenAI, Ollama, LM Studio). |
| Packaging | **electron-builder** | NSIS (Windows), DMG (macOS), AppImage/deb (Linux). |

## The Electron vs. Tauri decision

The original design leaned toward **Tauri** (Rust backend, tiny binary, low RAM). That is a strong
long-term choice. For v0.1 we chose **Electron** deliberately:

**Why Electron now**
- **It builds on the current machine today.** Rust/Cargo is not installed here; Tauri needs it.
- **Cursor is Electron.** The user's north star ("like Cursor, a wrapper around VS Code") maps
  directly onto Electron + Monaco.
- **Native modules just work.** `serialport` ships prebuilt binaries for Electron; the Rust
  equivalent would be reimplemented backend-side.
- **The value is in the features, not the shell.** Multi-language builds, C++23, serial plotting,
  and embedded AI are identical regardless of shell.

**Why Tauri later** - tracked in [`ROADMAP.md`](ROADMAP.md) as a future migration:
- Much smaller installer and lower memory footprint.
- Rust backend is attractive to the embedded audience and has excellent serial/USB/process crates.
- The clean IPC contract in `src/shared/ipc.ts` is designed so the **backend can be swapped** - 
  a Tauri (Rust) backend can implement the same channels the Electron main process does today.

## Toolchains the IDE *invokes* (not bundles)

The IDE detects and drives whatever is installed. Verified present on the dev machine:

- **g++ 14.2** and **clang++ 22** - both compile **C++23** (`__cplusplus == 202302`).
- **Python 3.14**, **Node 24**, **CMake 4.1**.

Also probed for: `gcc`, `clang`, `arm-none-eabi-g++`, `avr-g++`, `rustc`, `cargo`, `ninja`,
`arduino-cli`, `pio` (PlatformIO), `openocd`, `gdb`.

## Languages (`src/shared/languages.ts`)

| Language | Runnable now | Category |
|---|---|---|
| C++ | ✅ (g++/clang++, C++11 to C++23) | embedded |
| C | ✅ | embedded |
| Python | ✅ | scripting |
| JavaScript | ✅ (node) | web |
| TypeScript | editing only | web |
| Rust | editing only (run planned via cargo) | systems |
| Zig | editing only | systems |
| Lua | editing only | scripting |

## Why local Monaco (CSP note)

`@monaco-editor/react` defaults to loading Monaco from a CDN. Under our production Content-Security-
Policy (`connect-src 'self'`), that would be blocked. `CodeEditor.tsx` therefore imports
`monaco-editor` directly and wires its web workers through Vite's `?worker` imports, so everything is
bundled and same-origin. `worker-src 'self' blob:` is allowed in the CSP for the workers.
