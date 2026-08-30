# Cortex

Cortex is a desktop IDE built for embedded development: C and C++ (up to C++23), Python, Rust, and JavaScript, all in one workspace, with real compiling, real debugging, and a 3D simulator you can run without any hardware plugged in.

## The problem

If you've written firmware for an Arduino, ESP32, or a similar board, you've probably felt the friction. The official Arduino IDE caps you at C++11, treats every project as a single .ino file, and gives you a serial monitor that can barely timestamp a line of text. The moment a project grows past one sketch, or you need to also run a Python test script, plot some sensor data, or check a register value, you're out of the IDE and juggling a handful of other windows: a terminal, a logic analyzer, a datasheet PDF, maybe oscilloscope software, and whatever editor you actually like typing in.

None of those tools talk to each other. You end up being the integration layer yourself.

## What it's for

Cortex is an attempt to be that integration layer instead of you. It's one workspace where:

- You write and compile modern C++ (up to C++23) using whatever compiler you already have installed (GCC, Clang, ARM-GCC, AVR-GCC), not something bundled and outdated.
- You can drop Python, Rust, or JavaScript files into the same project for tests, data analysis, or a small dashboard, and run them the same way you run your firmware.
- The editor is Monaco, the same engine behind VS Code, wired up to clangd for real completion, hover docs, and go-to-definition when clangd is available on your machine.
- You can set breakpoints and step through C/C++ code with gdb, right inside the app.
- You can flash and monitor real boards (ESP32, RP2040, Arduino) through arduino-cli, with a live serial plotter instead of a wall of scrolling text.
- Or you can skip the hardware entirely and run your actual sketch against a 3D simulated board, to check the logic before you touch a soldering iron.

There's also an AI assistant panel you can point at Anthropic, OpenAI, or Gemini, or at a local model through Ollama or LM Studio, tuned to talk about interrupts, DMA, RTOS tasks, and peripheral registers instead of generic web dev advice.

## How it's different

Cortex isn't trying to be a prettier version of the Arduino IDE. It's closer to combining a JetBrains-style development experience with the idea that a single embedded project is rarely just C++, so the IDE shouldn't pretend otherwise.

The other real difference is that nothing is bundled or hidden. Cortex doesn't ship its own compiler; it invokes whatever toolchain is already on your machine, so C++17, C++20, and C++23 just work instead of being locked out. Every integration, the debugger, the simulator, the board uploader, is built to degrade cleanly if the underlying tool isn't installed, and the Settings panel tells you exactly what it found on your system rather than failing silently.

## Where it's at right now

This is an early, actively developed project, not a finished product. C++23 compiling, the simulator, and the Arduino compatibility shim are the parts that have actually been run and verified end to end. Code intelligence, the AI assistant, and the simulator's accuracy are all real but limited in scope right now, and the packaged build isn't signed or auto-updating yet. The `docs/` folder, especially `PRODUCTION-READINESS.md`, is deliberately upfront about what's solid and what still needs work.

## Download

Prebuilt installers for Windows, macOS, and Linux are published on the [Releases page](https://github.com/Vexaile/Cortex/releases).

One honest caveat: the build isn't code-signed yet, so on Windows you'll hit a SmartScreen "unrecognized app" prompt on first launch. Click "More info" then "Run anyway." A signed, notarized build is on the list, just not there yet.

## Getting started

```bash
npm install
npm run dev
```

That launches the IDE in development mode with hot reload. To build a distributable app yourself instead of downloading one:

```bash
npm run build
npm run dist:win
```

Cortex doesn't bundle any compilers or toolchains, it looks for what's already on your machine:

| To do this | You need |
|---|---|
| Compile/run C or C++ | g++ / clang++ (anything recent supports C++23) |
| C/C++ code intelligence | clangd |
| Debug C/C++ | gdb |
| Run Python | python |
| Run Rust | rustc |
| Run JavaScript | node |
| Flash boards, manage libraries | arduino-cli |

Open Settings → Toolchains inside the app and it will scan your machine and show you exactly what it found.

## Documentation

More detail lives in `docs/`, including the architecture, the per-language support matrix, the debugger, the 3D simulator, and a roadmap of what's planned next.

## License

MIT
