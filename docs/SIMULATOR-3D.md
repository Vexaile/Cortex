# 3D simulator view

A 3D board view sits alongside the 2D schematic canvas, toggled by the `2D | 3D`
control in the Simulator toolbar. Both are drop-in siblings that read and mutate
the **same** store (`simParts`, `simWiring`, the pin-state maps), so add/delete,
wiring, running and live pin values stay in sync between them. Only the
rendering differs.

## Why it is built this way

- **One source of truth.** The store already held everything view-agnostic
  (parts, wiring, pin state, persistence). The Explore of the codebase confirmed
  SimCanvas holds almost no local state, so a second view subscribing to the
  same store is automatically synchronised. The 3D view added no store fields
  and no change to the protocol, the shim, or `.cortex/diagram.json`.
- **Lazy-loaded.** three.js + drei are ~1.5MB. `SimCanvas3D` is loaded with
  `React.lazy`, so it becomes its own chunk and never enters the editor's
  initial bundle. The editor stays fast; the 3D cost is paid only when the user
  opens it.
- **CSP-safe.** No `drei` helper that fetches an external asset is used (no
  `Environment` HDR, no troika `Text` font). Labels are `drei/Html` (DOM over
  the canvas), so the strict production CSP is never violated and the app works
  offline.

## Geometry

`components/sim3d/board3d.ts` maps the 2D design space to the 3D world: world
units are design pixels and the Uno is centred at the origin, so a part's design
`(x, y)` becomes world `(x, z)` by subtracting the board centre. Design `y`
becomes world `z`. Pin numbers are identical to the sim engine (D0-D13 = 0-13,
A0-A5 = 14-19), so wiring by pin number is the same in both views.

## Boards

`components/sim3d/board3d.ts` is a registry of three boards, each with its real
footprint (mm-derived), pin layout with real labels, and landmark features:

- **Arduino Uno** (`uno`) - 68.6x53.4mm, D0-D13 + A0-A5, ATmega328P, USB-B,
  barrel jack, the onboard "L" LED that mirrors D13.
- **ESP32 DevKit** (`esp32`) - ~28x55mm, the ESP-WROOM-32 shield can, 2x19
  headers labelled by GPIO, micro-USB, EN/BOOT buttons.
- **Raspberry Pi** (`pi`) - 85.6x56.5mm, the 40-pin 2x20 GPIO header, BCM2711
  SoC, USB/Ethernet/HDMI/USB-C ports.

The 3D toolbar's board selector sets `sim3dBoard` in the store; the Canvas
remounts on a switch so the camera reframes for the new footprint. A wire routes
to whichever pin on the current board matches the part's stored pin number, and
is simply not drawn if that board does not expose it.

## Interaction

- **Wiring.** Single-pin parts (LED, button, buzzer, pot, servo, LDR, thermistor)
  arm from the body; multi-pin parts (RGB, 7-seg) show a row of per-pin
  connector nubs, so each pin wires independently. Click a part/nub to arm, click
  a board pin to attach. Same `beginWire`/`attachWire` store actions as 2D.
- **Dragging.** On the Uno, drag a part on the workbench plane (pointer capture +
  a ray/plane intersection) and it feeds `movePart` in design coordinates, so the
  2D canvas stays in sync. ESP32/Pi keep their auto-row layout (no 2D coords to
  map to).
- **Part layout.** The Uno maps parts 1:1 from the 2D canvas; ESP32 and Pi lay
  parts out in a tidy row in front of the board.

## What the engine actually drives

The shim is an Arduino-core mock, but it drives any pin NUMBER, so
`digitalWrite`/`digitalRead`/`analogRead`/`analogWrite` on an ESP32 GPIO or a Pi
BCM pin work. It also carries the ESP32 LEDC PWM API (`ledcSetup`/`ledcAttachPin`
/`ledcAttach`/`ledcWrite`), scaled to the canvas's 8-bit range, so a typical
ESP32 fade sketch (see `examples/sim/esp32_fade.ino`) compiles and drives a pin.
WiFi/BLE and Pi Linux GPIO are not modelled. In short: all three boards are
accurate models you can wire and drive at the pin level; the Uno is the
fully-supported target.

The pinouts and the drag coordinate math are covered by `test/board3d.test.ts`;
the LEDC behaviour by `test/arduinoShim.test.ts`.
