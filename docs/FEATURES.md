# Features - current & planned

Legend: ✅ implemented (v0.1) · 🟡 partial · ⬜ planned

## Editor & workspace
- ✅ Open folder as workspace; lazy file tree
- ✅ Live filesystem watching (external changes refresh the tree)
- ✅ Monaco editor: tabs, dirty indicators, close guard, syntax highlighting, minimap, bracket colorization
- ✅ Custom "Cortex Dark" JetBrains-style theme (navy/amber/moss)
- ✅ Language detection by extension (C, C++, Python, Rust, Zig, Lua, JS, TS) plus the
  ancillary files an embedded repo carries (Markdown, YAML, JSON, INI, XML, Shell)
- ✅ **Binary/oversized files are refused**, not opened as mojibake: a NUL sniff on the
  first 8 KB, a placeholder instead of an editor, and therefore no way to save over the
  artifact. See `docs/LANGUAGES.md`
- ✅ Save (Ctrl+S), Save all
- ✅ **Command palette** (Ctrl+Shift+P) and **quick-open** file search (Ctrl+P), fuzzy-matched
- ✅ **File-tree context menu**: New File, New Folder, Rename, Delete, Copy Path (with input dialog)
- ✅ **Workspace search**: filename + in-file content, case/word/regex toggles, results grouped
  by file, click-to-open at the match
- ✅ **LSP integration** (clangd, plus Pyright / rust-analyzer when installed): completion,
  hover docs, go-to-definition, signature help, live diagnostics. clangd is auto-configured
  from your own compiler so the stdlib resolves - see `docs/LSP.md`
- ⬜ Multi-root workspaces / split editors
- ⬜ Search *and replace*; go-to-symbol across the workspace

## Build & run
- ✅ **Toolchain auto-detection** (GCC, Clang, ARM/AVR-GCC, Python, Node, CMake, Ninja, GDB, PlatformIO, Arduino-CLI, OpenOCD)
- ✅ **Compile & run C/C++** with a **selectable compiler, standard (C++11 → C++23/2c), and optimization level**
- ✅ Run Python and JavaScript
- ✅ Streamed build + program output with stdout/stderr coloring and exit codes
- ✅ Stop a running program
- ✅ **stdin to running programs** (input box in the Output console)
- ✅ **Per-project run configuration** persisted to `.cortex/config.json` (compiler/std/opt/board)
- ✅ **Compiler diagnostics** parsed into a **Problems panel** (click to jump) + **inline Monaco squiggles**
- ⬜ CMake / PlatformIO project builds (multi-file)

## Boards & embedded (ESP32 / RP2040 / Arduino)
- ✅ **arduino-cli integration**: detect availability, list connected boards, list installable targets
- ✅ **Verify (compile)** and **Upload** a `.ino` sketch to a real board, with board (FQBN) selector
- ✅ Arduino APIs (`pinMode`, `digitalWrite`, `Serial`, ...) are valid - compiled against the Arduino core
- ✅ Common board presets (Uno, Nano, Mega, ESP32, ESP8266, Pico) even before cores are installed
- ✅ Graceful degradation with an install hint when arduino-cli is absent
- ✅ **Boards Manager**: search the core index, install / update / remove a platform, pin a
  version, with progress streamed to Output
- ✅ **Library Manager**: search, install and remove Arduino libraries, with version pinning
- ✅ Arduino-style **combined board + port selector** in the toolbar, listing boards detected
  on connected ports, plus a "select other board and port" picker.
  See `docs/BOARDS-AND-LIBRARIES.md`
- ⬜ PlatformIO projects, on-device debug

## Simulator (Wokwi / Tinkercad-style) - no hardware needed
- ✅ **Native simulation**: your real `setup()`/`loop()` compiled with g++ against a mock Arduino
  runtime, so `digitalWrite`/`digitalRead`/`analogWrite`/`millis`/`Serial`/`tone`/`map` all run
- ✅ **2D SVG canvas** editor (the research-backed Wokwi/Tinkercad approach) with a virtual Arduino
  Uno, a grid workspace, and live pin states
- ✅ **Drag-to-place parts** from a palette: LED (color-pickable), **RGB LED (3-pin)**, button,
  buzzer, resistor, potentiometer, servo, photoresistor, temperature sensor, **7-segment display**
- ✅ **Multi-pin components** with per-pin connectors and wiring (RGB LED mixes its R/G/B channels
  live; the 7-segment lights individual segments); model generalizes to OLED/NeoPixel next
- ✅ Demo sketches in `examples/sim/` (RGB fade, 7-segment 0-9 counter)
- ✅ **Click-to-wire** per pin: click a part connector, then a board pin; wires drawn as SVG paths
- ✅ **Live + interactive**: LEDs glow (PWM brightness), buttons drive inputs (correct INPUT_PULLUP),
  potentiometer/photoresistor/temp sliders feed `analogRead`, buzzer/servo animate; per-part
  rotate/detach/delete
- ✅ **Diagram save/load** to `.cortex/diagram.json` (Save layout button + auto-load on open)
- ✅ Live **serial output** panel; Run / Stop
- ⬜ Cycle-accurate engine (avr8js for Uno; rp2040js for Pico), more parts (7-seg, OLED, NeoPixel,
  sensors), diagram save/load, optional 3D showcase view, ROS2. See [`SIMULATOR.md`](SIMULATOR.md).

## Serial & devices
- ✅ Serial port discovery with manufacturer/VID:PID
- ✅ Connect/disconnect, baud selection, send line
- ✅ Serial monitor: timestamps, autoscroll toggle
- ✅ **Live plotter** - auto-detects `key: value` pairs and CSV numeric streams and graphs them
- ⬜ Hex/ASCII/CSV view modes, regex filter, colorize rules, export to file
- ⬜ Multiple simultaneous ports
- ⬜ Logic-analyzer / I²C / SPI decoding (via plugins)

## AI assistant
- ✅ Right-side chat panel, streamed responses
- ✅ Embedded-tuned system prompt (ISRs, DMA, RTOS, registers, `volatile`, watchdog)
- ✅ Sends the active file as context
- ✅ Quick actions: Analyze firmware · Optimize power · Explain file
- ✅ Provider-agnostic: Anthropic, OpenAI, or local OpenAI-compatible (Ollama/LM Studio)
- ⬜ Agentic edits (apply diffs to files), multi-file context
- ⬜ Datasheet ingestion & Q&A; schematic image analysis
- ⬜ MCP tool integrations (flash, read registers, run tests)

## Hardware inspectors (planned)
- ⬜ GPIO inspector (live pin states)
- ⬜ Memory viewer (Heap/Stack/Flash/EEPROM bars)
- ⬜ Register viewer (edit peripheral registers live)
- ⬜ RTOS viewer (FreeRTOS task table)

## Debugging
- ✅ **Host C/C++ source debugger** driven by **gdb** (MI2): gutter breakpoints, continue,
  pause, step over/into/out, stop
- ✅ **Live variables** for the selected frame, **call stack** (click a frame to inspect it),
  **watch** expressions, and a raw **gdb console**
- ✅ Current-line highlight + reveal on every stop; breakpoints editable mid-session
- ✅ Confined like the filesystem: allowlisted bare compiler, workspace-only paths, and a
  Stop that actually cancels an in-flight debug build. See `docs/DEBUGGING.md`
- ⬜ Multi-file / CMake debug targets (tracks the general multi-file build work)
- ⬜ Registers, memory and disassembly views
- ⬜ On-chip debug via OpenOCD / J-Link / ST-Link (needs a hardware probe)

## Platform & packaging
- ✅ Cross-platform Electron shell
- ✅ Persistent settings (compiler defaults, Python path, AI provider) in user data dir
- ✅ **Security**: contextIsolation, production CSP, single-instance lock, AI key encrypted with OS
  keychain (safeStorage) and never sent to the renderer, spawn allowlist (only known compilers/
  interpreters), destructive filesystem ops confined to the open workspace
- ✅ Unit tests (Vitest) + CI (GitHub Actions: typecheck, test, build on Ubuntu and Windows)
- ✅ electron-builder config for Windows (NSIS), macOS (DMG), Linux (AppImage/deb)
- ⬜ Auto-update
- ⬜ Board manager (one-click ESP32/STM32/RP2040/AVR/nRF52/Teensy...)
- ⬜ Plugin/extension system

## Keyboard shortcuts (current)
| Shortcut | Action |
|---|---|
| Ctrl/Cmd + Shift + P | Command palette |
| Ctrl/Cmd + P | Quick-open file |
| Ctrl/Cmd + S | Save active file |
| Ctrl/Cmd + B | Toggle sidebar |
| Ctrl/Cmd + ` | Toggle bottom panel |
| F5 | Run active file |
