# Simulator (Wokwi / Tinkercad-style) - plan

**Goal:** let people without physical hardware *simulate* boards and *play with circuits* - write
code, wire up components on a virtual breadboard, press Run, and watch it behave. Should feel like
**Tinkercad Circuits** and **Wokwi**.

## Why it matters
- Removes the hardware barrier: learn/prototype embedded on any laptop.
- Instant feedback loop: no flashing, no wiring mistakes frying parts.
- Pairs perfectly with the AI assistant ("why isn't my LED blinking?") and the serial plotter.

## Two execution engines (ship native-sim first, add cycle-accurate later)

### Engine A - Native host simulation (MVP, uses the g++ we already have) ✅ chosen first
Compile the user's real `setup()`/`loop()` on the host with a **mock Arduino runtime**:
- Provide a `sim/Arduino.h` shim implementing `pinMode`, `digitalWrite`, `digitalRead`,
  `analogWrite`, `analogRead`, `delay`, `delayMicroseconds`, `millis`, `micros`, `Serial.*`.
- The shim emits a line-based **pin-event protocol** on stdout, e.g. `@pin 13 1`, `@pwm 9 128`,
  `@serial hello`, and reads `@in <pin> <value>` on stdin for button/pot interaction.
- Wrap the sketch in a generated `main()` that runs `setup()` then loops `loop()` against a
  simulated clock, so `delay()` advances virtual time.
- Cortex compiles with `g++`/`clang++`, runs the process, parses the event stream, and drives the
  virtual components on the canvas in real time. Interaction (button press, pot turn) is written
  back to the process stdin.
- **Pros:** runs the user's *actual code*, works with the toolchain already installed, fast.
- **Cons:** not cycle-accurate; timing is approximate; not the real AVR/ESP binary.

### Engine B - Cycle-accurate MCU simulation (later, Wokwi-parity)
- **AVR (Arduino Uno/Nano/Mega):** [`avr8js`](https://github.com/wokwi/avr8js) - pure-JS AVR core.
  Feed it the compiled `.hex` (from arduino-cli/avr-gcc), tick the CPU, read `AVRIOPort`
  listeners for pin states. This is exactly how Wokwi began.
- **ESP32 / RP2040:** QEMU-based or Renode integration (heavier; separate process).
- Requires a compile-to-hex pipeline (arduino-cli), so it depends on board support.

## UI (the Wokwi/Tinkercad feel)
- A **Simulator** view (activity-bar entry + full-canvas mode).
- **Component palette:** LED, RGB LED, pushbutton, resistor, potentiometer, buzzer, servo,
  photoresistor, 7-segment, OLED (SSD1306), HC-SR04, DHT22, NeoPixel strip...
- **Virtual board** with an accurate pinout (Arduino Uno first, then ESP32 DevKit, RP2040 Pico).
- **Drag to place**, **click-drag pin→pin to wire**, color-coded nets.
- Live component state: LEDs light, servos sweep, buzzer icon animates, OLED renders pixels.
- **Run / Stop / Reset**, adjustable sim speed, and a scrubbable timeline (stretch).
- Diagram persistence: save the circuit as `<sketch>.sim.json` (Wokwi uses `diagram.json`).

## Data model
```ts
interface SimComponent { id; type; x; y; rotation; props }   // e.g. LED { color }
interface SimWire { from: {compId, pin}; to: {compId|'board', pin}; color }
interface SimDiagram { board: 'uno'|'esp32'|'pico'; components: SimComponent[]; wires: SimWire[] }
```

## Rollout
1. **MVP (native-sim):** Arduino.h shim + pin protocol + runner; canvas with board + LED + button;
   run a blink/button sketch end-to-end.
2. Add more components + wiring editor + diagram persistence.
3. Engine B: avr8js for cycle-accurate Uno; then ESP32/RP2040.
4. Sensor models (ADC curves, I²C/SPI device stubs).

## Related future work - ROS2 for robotics
Add a **ROS2** integration so Cortex can drive/inspect robotics stacks: node graph view, topic echo/
plot (reuse the serial plotter), `ros2 bag` playback, and bridging simulated firmware ↔ ROS2 topics
(e.g. Gazebo/Ignition co-simulation). Tracked here + in ROADMAP Phase 6.
