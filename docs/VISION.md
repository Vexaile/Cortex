# Vision - Cursor for Embedded Systems

Cortex is not "another Arduino IDE." It is an **embedded development platform** that combines
firmware, hardware, AI, testing, visualization, debugging, and multiple languages into one workspace.

The biggest opportunity is not chasing JetBrains or Arduino feature-for-feature - it's making
embedded development a **first-class, AI-native workflow**.

## The problem

Today, embedded engineers constantly switch between:

- VS Code or CLion
- Arduino IDE or PlatformIO
- Python scripts for testing
- Serial terminals
- Logic analyzers
- Datasheet PDFs
- Browser tabs
- Oscilloscope software
- Git

Cortex makes those feel like one integrated environment. Imagine opening a project and seeing:

- **Firmware** (C++23 with modern tooling)
- **Python** (hardware tests, automation, data analysis)
- **Live serial console** with automatic plotting
- **Memory / register inspector**
- **Integrated datasheet search and AI Q&A**
- **Hardware-aware AI agents** that understand interrupts, DMA, RTOS tasks, and peripheral
  registers - not just generic C++.

That vision is far more compelling than "Arduino IDE with C++23." It's a platform designed around
how embedded engineers actually work.

## Concrete differentiators

### 1. Any toolchain, any C++ standard
Forget the bundled Arduino compiler. Let the user choose: GCC 15, Clang 20, ARM-GCC, ESP-IDF,
PlatformIO, STM32Cube, AVR-GCC, Zephyr, or a custom compiler. The IDE simply invokes
`clang++` / `g++` / `arm-none-eabi-g++` / `avr-g++`. Suddenly **C++17, C++20, and C++23 all work.**

### 2. Multi-language projects
One workspace, one Run button:

```
Robot Project
  Firmware/    main.cpp       (C++ - the low-level embedded stuff)
  Vision/      detector.py    (Python - CV, data, visualization)
  Dashboard/   ui.tsx         (TypeScript/React - telemetry UI)
  Simulation/  robot.rs       (Rust - systems simulation)
  Docs/
```

Supported (current + planned): C, C++, Python, Rust, Zig, Lua, JavaScript, TypeScript, MATLAB.

### 3. Embedded-aware AI (the Cursor inspiration)
Agents built specifically for embedded. Examples of what they should answer:

- *"Analyze my STM32 firmware."* → Stack-overflow risk, race conditions, ISR too long, heap
  fragmentation, DMA misuse, missing `volatile`, potential watchdog reset.
- *"Optimize power consumption."* → CPU sleeps only 8%, SPI clock always enabled, GPIO pull-ups
  drawing 3 mA, ADC sampling continuously → estimated battery life 18 h → 46 h optimized.
- *"Find timing bottlenecks."*
- *"Generate a driver for MPU6050."*
- *"Explain why UART isn't receiving."*
- Upload an STM32 schematic → *"PB6 connected incorrectly, no pull-up on I²C, wrong crystal
  capacitor, UART RX floating."*

These are things a generic code assistant cannot do well.

### 4. A serial monitor that isn't awful
Arduino's serial monitor is primitive. Cortex's:

- Port + baud selection, filter, regex, hex/ASCII/CSV views, timestamps, colorize, pause, export.
- **Automatic live plotting** - detect numbers in the stream and graph them (temperature, voltage,
  RPM) in real time.

### 5. Hardware inspectors (planned)
- **GPIO inspector** - live pin states (PA0 HIGH, PB4 PWM, ...).
- **Memory viewer** - Heap / Stack / Flash / EEPROM with visual bars.
- **Register viewer** - TIM2 CNT/PSC/ARR/CCR1, edit values live.
- **RTOS viewer** - FreeRTOS tasks: priority, CPU %, stack, blocked/ready.

### 6. Board manager & plugins (planned)
- One-click board install: ESP32, STM32, RP2040, AVR, nRF52, Teensy, MSP430, PIC.
- VSCode-style extensions: Zephyr, ESP-IDF, STM32Cube, PlatformIO, ROS2, FreeRTOS, LVGL, OpenCV.

### 7. Real debugger (planned)
Breakpoints, watch, registers, memory, disassembly, call stack, threads - via GDB/LLDB + OpenOCD /
J-Link / ST-Link.

## Design language

CLion (JetBrains) structure and polish + Arduino IDE's approachability. Dark, "Darcula"-inspired
theme; a left activity bar; a main editor with tabs; a bottom panel for output/serial/problems; a
right AI panel - familiar to anyone coming from VS Code / Cursor / CLion.

## North star

> Make embedded development a first-class, AI-native workflow - so the firmware, the tests, the
> telemetry, the datasheets, and the AI all live in one place.
