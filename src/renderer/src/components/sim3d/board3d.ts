/**
 * 3D board registry for the simulator.
 *
 * World units are the 2D design pixels (see shared/simLayout), and every board
 * is centred at the world origin. A part's design (x, y) maps to world (x, z)
 * by subtracting the board centre, so the 2D canvas and the 3D Uno stay
 * spatially in sync and both wire by the same board pin number.
 *
 * Each board declares its own footprint, pin layout (with real labels), and a
 * few landmark features. Dimensions and pinouts are from the datasheets:
 *   Uno R3        68.6 x 53.4 mm, D0-D13 + A0-A5
 *   ESP32 DevKit  ~28 x 55 mm, 2x19 headers, ESP-WROOM-32 module
 *   Raspberry Pi  85.6 x 56.5 mm, 40-pin 2x20 GPIO header
 *
 * The sim engine (the shim) is Arduino-core: it drives any pin NUMBER, so
 * digitalWrite/Read/analogRead on an ESP32 GPIO or a Pi BCM pin work, but
 * chip-specific APIs (ledc, WiFi) are Uno-core only. So ESP32 and Pi are
 * accurate models you can wire and drive at the digital-pin level; the Uno is
 * the fully-supported target.
 */

import type { Sim3dBoardId } from '../../store/useStore'

export type PinKind = 'gpio' | 'analog' | 'power' | 'gnd'

export interface Pin3D {
  /** Sim-engine pin number. Negative = not wire-driven (power/gnd/reset). */
  pin: number
  label: string
  x: number
  z: number
  kind: PinKind
}

export interface Feature {
  kind: 'box' | 'cyl'
  pos: [number, number, number]
  /** box: [w, h, d]; cyl: [radius, height, radialSegments] */
  size: [number, number, number]
  color: string
  metal?: number
  rough?: number
}

export interface BoardDef {
  id: Sim3dBoardId
  name: string
  size: { w: number; d: number; h: number }
  pcb: string
  pins: Pin3D[]
  features: Feature[]
  /** Silkscreen wordmark position. */
  labelPos: [number, number, number]
  /** An onboard LED that mirrors this pin (Uno's "L" on D13). */
  ledPin?: number
  ledPos?: [number, number, number]
  /** Initial camera position that frames this board. */
  camera: [number, number, number]
}

/** Where the 2D design space centres the Uno; used to map parts for every board. */
export const DESIGN_CENTER = { x: 330, y: 347.5 } as const

/** design (x, y) -> world (x, z). */
export function toWorld(x: number, y: number): [number, number] {
  return [x - DESIGN_CENTER.x, y - DESIGN_CENTER.y]
}

/** A wire lands on a pin tip; a part's wire leaves from here. */
export const pinTopY = (def: BoardDef): number => def.size.h + 6
export const PART_TOP_Y = 12

const kindOf = (label: string, gpio: number): PinKind => {
  if (/^(3V3|5V|VIN|VCC)$/.test(label)) return 'power'
  if (label === 'GND') return 'gnd'
  if (/^A\d/.test(label)) return 'analog'
  return gpio >= 0 ? 'gpio' : 'power' // EN/RESET fall here
}

// ---- Arduino Uno --------------------------------------------------------

const UNO = { w: 400, d: 195, h: 8 }

function unoPins(): Pin3D[] {
  const pins: Pin3D[] = []
  const margin = 22
  const usableW = UNO.w - margin * 2
  const left = -UNO.w / 2 + margin
  const zBack = -UNO.d / 2 + 16
  const zFront = UNO.d / 2 - 16
  for (let i = 0; i < 14; i++) {
    pins.push({ pin: i, label: `D${i}`, x: left + (usableW * i) / 13, z: zBack, kind: 'gpio' })
  }
  const analogW = usableW * 0.6
  for (let i = 0; i < 6; i++) {
    pins.push({ pin: 14 + i, label: `A${i}`, x: left + (analogW * i) / 5, z: zFront, kind: 'analog' })
  }
  return pins
}

const unoBoard: BoardDef = {
  id: 'uno',
  name: 'ARDUINO UNO',
  size: UNO,
  pcb: '#11734d',
  pins: unoPins(),
  labelPos: [-UNO.w / 2 + 44, UNO.h + 0.5, 40],
  ledPin: 13,
  ledPos: [UNO.w / 2 - 46, UNO.h + 2, -6],
  camera: [60, 300, 360],
  features: [
    { kind: 'box', pos: [0, UNO.h + 1, -UNO.d / 2 + 16], size: [UNO.w * 0.86, 4, 9], color: '#0a0c10', rough: 0.8 },
    {
      kind: 'box',
      pos: [-UNO.w / 2 + 22 + (UNO.w - 44) * 0.3, UNO.h + 1, UNO.d / 2 - 16],
      size: [(UNO.w - 44) * 0.62, 4, 9],
      color: '#0a0c10',
      rough: 0.8
    },
    { kind: 'box', pos: [-UNO.w / 2 - 6, 9, -30], size: [28, 14, 32], color: '#9aa4b2', metal: 0.85, rough: 0.35 },
    { kind: 'box', pos: [-UNO.w / 2 - 4, 8, 45], size: [24, 15, 22], color: '#0a0c10', rough: 0.6 },
    { kind: 'box', pos: [36, UNO.h + 3, 12], size: [74, 6, 30], color: '#14181f', rough: 0.7 }
  ]
}

// ---- ESP32 DevKit (38-pin) ----------------------------------------------

const ESP = { w: 150, d: 330, h: 7 }

const ESP_LEFT = [
  '3V3', 'EN', 'IO36', 'IO39', 'IO34', 'IO35', 'IO32', 'IO33', 'IO25', 'IO26',
  'IO27', 'IO14', 'IO12', 'GND', 'IO13', 'IO9', 'IO10', 'IO11', 'VIN'
]
const ESP_RIGHT = [
  'GND', 'IO6', 'IO7', 'IO8', 'IO15', 'IO2', 'IO0', 'IO4', 'IO16', 'IO17',
  'IO5', 'IO18', 'IO19', 'GND', 'IO21', 'RX0', 'TX0', 'IO22', 'IO23'
]

function espGpio(label: string): number {
  const m = label.match(/^IO(\d+)$/)
  if (m) return Number(m[1])
  if (label === 'RX0') return 3
  if (label === 'TX0') return 1
  return -1
}

function espColumn(labels: string[], x: number): Pin3D[] {
  const margin = 20
  const usable = ESP.d - margin * 2
  const top = -ESP.d / 2 + margin
  return labels.map((label, i) => {
    const gpio = espGpio(label)
    return { pin: gpio, label, x, z: top + (usable * i) / (labels.length - 1), kind: kindOf(label, gpio) }
  })
}

const espBoard: BoardDef = {
  id: 'esp32',
  name: 'ESP32',
  size: ESP,
  pcb: '#13171e',
  pins: [...espColumn(ESP_LEFT, -ESP.w / 2 + 16), ...espColumn(ESP_RIGHT, ESP.w / 2 - 16)],
  labelPos: [0, ESP.h + 0.5, 96],
  camera: [70, 350, 400],
  features: [
    // ESP-WROOM-32 shield can
    { kind: 'box', pos: [0, ESP.h + 5, -ESP.d / 2 + 58], size: [118, 9, 78], color: '#c9ccd1', metal: 0.9, rough: 0.3 },
    // micro-USB
    { kind: 'box', pos: [0, 8, ESP.d / 2 - 4], size: [40, 10, 22], color: '#c9ccd1', metal: 0.85, rough: 0.35 },
    // EN + BOOT buttons
    { kind: 'box', pos: [-40, ESP.h + 2, ESP.d / 2 - 40], size: [16, 6, 12], color: '#1b2230', rough: 0.6 },
    { kind: 'box', pos: [40, ESP.h + 2, ESP.d / 2 - 40], size: [16, 6, 12], color: '#1b2230', rough: 0.6 }
  ]
}

// ---- Raspberry Pi 4 (40-pin) --------------------------------------------

const PI = { w: 480, d: 320, h: 8 }

const PI_ODD = [
  '3V3', 'GPIO2', 'GPIO3', 'GPIO4', 'GND', 'GPIO17', 'GPIO27', 'GPIO22', '3V3', 'GPIO10',
  'GPIO9', 'GPIO11', 'GND', 'GPIO0', 'GPIO5', 'GPIO6', 'GPIO13', 'GPIO19', 'GPIO26', 'GND'
]
const PI_EVEN = [
  '5V', '5V', 'GND', 'GPIO14', 'GPIO15', 'GPIO18', 'GND', 'GPIO23', 'GPIO24', 'GND',
  'GPIO25', 'GPIO8', 'GPIO7', 'GPIO1', 'GND', 'GPIO12', 'GND', 'GPIO16', 'GPIO20', 'GPIO21'
]

function piGpio(label: string): number {
  const m = label.match(/^GPIO(\d+)$/)
  return m ? Number(m[1]) : -1
}

function piRow(labels: string[], z: number): Pin3D[] {
  const margin = 40
  const usable = PI.w - margin * 2
  const left = -PI.w / 2 + margin
  return labels.map((label, i) => {
    const gpio = piGpio(label)
    return { pin: gpio, label, x: left + (usable * i) / (labels.length - 1), z, kind: kindOf(label, gpio) }
  })
}

const piBoard: BoardDef = {
  id: 'pi',
  name: 'RASPBERRY PI',
  size: PI,
  pcb: '#13603f',
  // Physical pin 1 at the left corner; odd row nearer the edge, even row inboard.
  pins: [...piRow(PI_ODD, -PI.d / 2 + 26), ...piRow(PI_EVEN, -PI.d / 2 + 48)],
  labelPos: [-40, PI.h + 0.5, 70],
  camera: [90, 420, 500],
  features: [
    // BCM2711 SoC
    { kind: 'box', pos: [-20, PI.h + 5, 20], size: [82, 10, 82], color: '#1a1f27', metal: 0.3, rough: 0.5 },
    // USB 3.0 + 2.0 stacks on the right edge
    { kind: 'box', pos: [PI.w / 2 - 8, 13, -30], size: [62, 26, 44], color: '#2a4d8f', metal: 0.5, rough: 0.4 },
    { kind: 'box', pos: [PI.w / 2 - 8, 13, 40], size: [62, 26, 44], color: '#1b1f27', metal: 0.6, rough: 0.4 },
    // Ethernet
    { kind: 'box', pos: [PI.w / 2 - 8, 15, 110], size: [58, 30, 46], color: '#9aa4b2', metal: 0.85, rough: 0.3 },
    // USB-C power + micro-HDMI on the front long edge
    { kind: 'box', pos: [-150, 8, PI.d / 2 - 4], size: [22, 10, 18], color: '#c9ccd1', metal: 0.8, rough: 0.35 },
    { kind: 'box', pos: [-100, 8, PI.d / 2 - 4], size: [22, 10, 18], color: '#1b2230', rough: 0.5 },
    { kind: 'box', pos: [-58, 8, PI.d / 2 - 4], size: [22, 10, 18], color: '#1b2230', rough: 0.5 }
  ]
}

export const BOARDS: Record<Sim3dBoardId, BoardDef> = {
  uno: unoBoard,
  esp32: espBoard,
  pi: piBoard
}
