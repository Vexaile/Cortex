import type { ProjectModel, BusKind, PinUsage, BusUsage } from './ipc'

/**
 * The hardware relationship graph: a pure derivation from the ProjectModel
 * that connects files, pins, buses, and recognized devices, with file/line
 * provenance on every edge. This is what lets Cortex answer "what hardware
 * does this file control" and "what device is on this bus" rather than only
 * "what text is in this file". No fs, no Electron - buildable in the main
 * process, the renderer, or a test with equal ease. See docs/PROJECT-MODEL.md.
 */

export type HwNodeKind = 'board' | 'pin' | 'bus' | 'device' | 'file'

export interface HwNode {
  /** Stable, unique: "board", "pin:13", "bus:i2c:Wire", "device:mpu6050", "file:src/main.cpp" */
  id: string
  kind: HwNodeKind
  label: string
  detail?: string
}

export type HwRelation = 'uses-pin' | 'opens-bus' | 'includes-driver' | 'likely-on-bus'

export interface HwEdge {
  from: string
  to: string
  relation: HwRelation
  /** Source provenance, absent on inferred edges (likely-on-bus). */
  file?: string
  line?: number
  /** Honest qualifier for inferred edges: why we think so, or what doesn't add up. */
  note?: string
}

export interface HardwareGraph {
  nodes: HwNode[]
  edges: HwEdge[]
  /** True when any underlying scan hit its cap - the graph is a sample, not the whole story. */
  incomplete: boolean
}

export interface KnownDevice {
  /** Node id suffix and dedupe key. */
  key: string
  label: string
  /** What it is, in one engineer-useful phrase. */
  detail: string
  /** Buses this part can sit on. Only a single-entry list allows bus attachment inference. */
  busKinds: Array<BusKind | 'gpio' | 'pwm' | 'sdio'>
  /** The part's full documented 7-bit I2C address range ("0x.." strings) - not
   *  just a breakout's defaults. Used for consistency notes, never as proof.
   *  Omitted when the range is so wide the note would be meaningless. */
  i2cAddresses?: string[]
}

/**
 * Well-known Arduino driver headers mapped to the hardware they drive. Keys
 * are lowercased header basenames. Curated under the same rules as the
 * stdlib dictionary (docs/STDLIB-DICTIONARY-WORKFLOW.md): only entries
 * verifiable against the part's own documentation, grown in small checked
 * batches rather than guessed at in bulk. An include is evidence the driver
 * is compiled in, not proof the part is wired up - which is why the edge
 * relation is "includes-driver".
 */
export const DEVICE_MAP: Record<string, KnownDevice> = {
  'adafruit_mpu6050.h': { key: 'mpu6050', label: 'MPU6050', detail: '6-axis accelerometer + gyroscope', busKinds: ['i2c'], i2cAddresses: ['0x68', '0x69'] },
  'mpu6050.h': { key: 'mpu6050', label: 'MPU6050', detail: '6-axis accelerometer + gyroscope', busKinds: ['i2c'], i2cAddresses: ['0x68', '0x69'] },
  'adafruit_bme280.h': { key: 'bme280', label: 'BME280', detail: 'temperature / humidity / pressure sensor', busKinds: ['i2c', 'spi'], i2cAddresses: ['0x76', '0x77'] },
  'adafruit_bmp280.h': { key: 'bmp280', label: 'BMP280', detail: 'temperature / pressure sensor', busKinds: ['i2c', 'spi'], i2cAddresses: ['0x76', '0x77'] },
  'adafruit_ssd1306.h': { key: 'ssd1306', label: 'SSD1306', detail: 'monochrome OLED display', busKinds: ['i2c', 'spi'], i2cAddresses: ['0x3C', '0x3D'] },
  'adafruit_ads1x15.h': { key: 'ads1x15', label: 'ADS1015/ADS1115', detail: 'external ADC', busKinds: ['i2c'], i2cAddresses: ['0x48', '0x49', '0x4A', '0x4B'] },
  // INA219: the full documented range is 0x40-0x4F (A0/A1 each strap to GND/VS+/SDA/SCL, TI datasheet Table 1), not just the Adafruit breakout's jumper combos.
  'adafruit_ina219.h': { key: 'ina219', label: 'INA219', detail: 'current / power monitor', busKinds: ['i2c'], i2cAddresses: ['0x40', '0x41', '0x42', '0x43', '0x44', '0x45', '0x46', '0x47', '0x48', '0x49', '0x4A', '0x4B', '0x4C', '0x4D', '0x4E', '0x4F'] },
  'adafruit_sht31.h': { key: 'sht31', label: 'SHT31', detail: 'temperature / humidity sensor', busKinds: ['i2c'], i2cAddresses: ['0x44', '0x45'] },
  'adafruit_vl53l0x.h': { key: 'vl53l0x', label: 'VL53L0X', detail: 'time-of-flight distance sensor', busKinds: ['i2c'], i2cAddresses: ['0x29'] },
  // PCA9685: six address pins give it 0x40-0x7F - most of the upper address
  // space - so an address consistency claim is close to meaningless. No list.
  'adafruit_pwmservodriver.h': { key: 'pca9685', label: 'PCA9685', detail: '16-channel PWM / servo driver', busKinds: ['i2c'] },
  // PCF8574 is 0x20-0x27 and the PCF8574A variant 0x38-0x3F; 0x27/0x3F are just the all-high defaults backpacks ship with.
  'liquidcrystal_i2c.h': { key: 'lcd-i2c', label: 'Character LCD (I2C)', detail: 'HD44780 LCD behind a PCF8574 I2C backpack', busKinds: ['i2c'], i2cAddresses: ['0x20', '0x21', '0x22', '0x23', '0x24', '0x25', '0x26', '0x27', '0x38', '0x39', '0x3A', '0x3B', '0x3C', '0x3D', '0x3E', '0x3F'] },
  'liquidcrystal.h': { key: 'lcd-parallel', label: 'Character LCD', detail: 'HD44780 LCD, parallel interface', busKinds: ['gpio'] },
  'rtclib.h': { key: 'rtc', label: 'RTC', detail: 'real-time clock (DS1307 / DS3231 / PCF8523)', busKinds: ['i2c'], i2cAddresses: ['0x68'] },
  'u8g2lib.h': { key: 'u8g2-display', label: 'Monochrome display', detail: 'OLED / LCD via u8g2', busKinds: ['i2c', 'spi'] },
  'adafruit_neopixel.h': { key: 'neopixel', label: 'NeoPixel strip', detail: 'WS2812-class addressable LEDs, single-wire', busKinds: ['gpio'] },
  'fastled.h': { key: 'fastled', label: 'Addressable LED strip', detail: 'WS2812 / APA102-class LEDs via FastLED', busKinds: ['gpio', 'spi'] },
  'servo.h': { key: 'servo', label: 'RC servo', detail: 'hobby servo, PWM position control', busKinds: ['pwm'] },
  'esp32servo.h': { key: 'servo', label: 'RC servo', detail: 'hobby servo, PWM position control', busKinds: ['pwm'] },
  'stepper.h': { key: 'stepper', label: 'Stepper motor', detail: 'stepper via the Arduino Stepper library', busKinds: ['gpio'] },
  'accelstepper.h': { key: 'stepper', label: 'Stepper motor', detail: 'stepper via AccelStepper', busKinds: ['gpio'] },
  'dht.h': { key: 'dht', label: 'DHT11/DHT22', detail: 'temperature / humidity sensor, single-wire', busKinds: ['gpio'] },
  'onewire.h': { key: 'onewire', label: '1-Wire bus', detail: 'Dallas 1-Wire master on a GPIO', busKinds: ['gpio'] },
  'dallastemperature.h': { key: 'ds18b20', label: 'DS18B20', detail: '1-Wire temperature sensor', busKinds: ['gpio'] },
  'sd.h': { key: 'sd-card', label: 'SD card', detail: 'SD card (SPI on most boards; SDIO on boards with a native slot)', busKinds: ['spi', 'sdio'] },
  'mfrc522.h': { key: 'mfrc522', label: 'MFRC522', detail: 'RFID reader', busKinds: ['spi'] },
  'max6675.h': { key: 'max6675', label: 'MAX6675', detail: 'K-type thermocouple amplifier', busKinds: ['spi'] },
  'tinygps++.h': { key: 'gps', label: 'GPS module', detail: 'NMEA GPS over serial', busKinds: ['uart'] },
  'tinygpsplus.h': { key: 'gps', label: 'GPS module', detail: 'NMEA GPS over serial', busKinds: ['uart'] },
  'hx711.h': { key: 'hx711', label: 'HX711', detail: 'load-cell amplifier, two-wire', busKinds: ['gpio'] },
  'irremote.h': { key: 'ir', label: 'IR receiver/emitter', detail: 'infrared remote control', busKinds: ['gpio'] },
  'keypad.h': { key: 'keypad', label: 'Matrix keypad', detail: 'row/column scanned keypad', busKinds: ['gpio'] }
}

const norm = (p: string): string => p.replace(/\\/g, '/')

const BUS_LABEL: Record<BusKind, string> = { i2c: 'I2C', spi: 'SPI', uart: 'UART' }

function pinDetail(usages: PinUsage[]): string | undefined {
  const modes = [...new Set(usages.filter((u) => u.mode).map((u) => u.mode!))]
  const roles = [...new Set(usages.map((u) => u.role))]
  const bits = [modes.length ? `mode: ${modes.join('/')}` : '', roles.join(', ')].filter(Boolean)
  return bits.length ? bits.join(' · ') : undefined
}

function busDetail(usages: BusUsage[]): string | undefined {
  const addrs = [...new Set(usages.filter((u) => u.address).map((u) => u.address!))]
  const bauds = [...new Set(usages.filter((u) => u.baud).map((u) => u.baud!))]
  const bits = [
    addrs.length ? `addresses seen: ${addrs.join(', ')}` : '',
    bauds.length ? `baud: ${bauds.join(', ')}` : ''
  ].filter(Boolean)
  return bits.length ? bits.join(' · ') : undefined
}

export function buildHardwareGraph(model: ProjectModel): HardwareGraph {
  const nodes = new Map<string, HwNode>()
  const edges: HwEdge[] = []
  const edgeSeen = new Set<string>()
  const addEdge = (e: HwEdge): void => {
    // One edge per (from, relation, to) pair; first-seen line wins as the
    // representative call site rather than flooding the graph with every loop
    // iteration that touches the same pin.
    const k = `${e.from}|${e.relation}|${e.to}`
    if (edgeSeen.has(k)) return
    edgeSeen.add(k)
    edges.push(e)
  }
  const fileNode = (file: string): string => {
    const id = `file:${norm(file)}`
    if (!nodes.has(id)) nodes.set(id, { id, kind: 'file', label: norm(file) })
    return id
  }

  const board = model.boards[0]
  if (board) {
    const bits = [board.platform, board.framework].filter(Boolean).join(', ')
    nodes.set('board', { id: 'board', kind: 'board', label: board.name, detail: bits || undefined })
  }

  // Pins: one node per distinct pin token, edges from each file that touches it.
  const byPin = new Map<string, PinUsage[]>()
  for (const p of model.pins) {
    if (!byPin.has(p.pin)) byPin.set(p.pin, [])
    byPin.get(p.pin)!.push(p)
  }
  for (const [pin, usages] of byPin) {
    const id = `pin:${pin}`
    nodes.set(id, { id, kind: 'pin', label: pin, detail: pinDetail(usages) })
    for (const u of usages) addEdge({ from: fileNode(u.file), to: id, relation: 'uses-pin', file: norm(u.file), line: u.line })
  }

  // Buses: one node per (kind, instance) - Wire and Wire1 are different physical buses.
  const byBus = new Map<string, BusUsage[]>()
  for (const b of model.buses) {
    const key = `${b.bus}:${b.instance}`
    if (!byBus.has(key)) byBus.set(key, [])
    byBus.get(key)!.push(b)
  }
  for (const [key, usages] of byBus) {
    const id = `bus:${key}`
    const { bus, instance } = usages[0]
    nodes.set(id, { id, kind: 'bus', label: `${BUS_LABEL[bus]} (${instance})`, detail: busDetail(usages) })
    for (const u of usages) addEdge({ from: fileNode(u.file), to: id, relation: 'opens-bus', file: norm(u.file), line: u.line })
  }

  // Devices: recognized from driver includes. The include is the evidence.
  const deviceUsages = new Map<string, { device: KnownDevice; sites: Array<{ file: string; line: number }> }>()
  for (const lib of model.libraries) {
    const base = norm(lib.header).split('/').pop()!.toLowerCase()
    const device = DEVICE_MAP[base]
    if (!device) continue
    if (!deviceUsages.has(device.key)) deviceUsages.set(device.key, { device, sites: [] })
    deviceUsages.get(device.key)!.sites.push({ file: lib.file, line: lib.line })
  }
  for (const [key, { device, sites }] of deviceUsages) {
    const id = `device:${key}`
    nodes.set(id, { id, kind: 'device', label: device.label, detail: device.detail })
    for (const s of sites) addEdge({ from: fileNode(s.file), to: id, relation: 'includes-driver', file: norm(s.file), line: s.line })

    // Bus attachment is inference, so it's held to a stricter bar: only when
    // the device can live on exactly one bus kind AND the project opens
    // exactly one instance of that kind is the edge drawn at all. A BME280
    // (I2C or SPI) or a project with Wire and Wire1 both open stays honest
    // and unattached rather than guessed. UART never qualifies: `Serial`
    // doubles as the USB debug console on most boards, so "only one UART
    // open" is usually the console, not the device's port. And when the bus
    // scan was truncated, "only bus opened in this project" is a claim the
    // scan can't back - no inference at all in that case.
    const realBusKinds = device.busKinds.filter((k): k is BusKind => k === 'i2c' || k === 'spi')
    if (realBusKinds.length === 1 && device.busKinds.length === 1 && !model.busesTruncated) {
      const kind = realBusKinds[0]
      const candidates = [...byBus.entries()].filter(([k]) => k.startsWith(`${kind}:`))
      if (candidates.length === 1) {
        const [busKey, busUsages] = candidates[0]
        let note = `only ${BUS_LABEL[kind]} bus opened in this project`
        if (kind === 'i2c' && device.i2cAddresses) {
          // Compare numerically: 104, 0x68, and 0x068 are the same address in
          // C source, and a string compare called 104 "not documented" - an
          // affirmatively false claim. Number() handles both 0x-hex and decimal.
          const seen = [...new Set(busUsages.filter((u) => u.address).map((u) => u.address!))]
          const known = device.i2cAddresses.map((a) => Number(a))
          if (seen.length) {
            const hit = seen.filter((a) => known.includes(Number(a)))
            note += hit.length
              ? `; address ${hit.join(', ')} on the bus matches this part's documented range`
              : `; note: addresses seen on the bus (${seen.join(', ')}) are outside this part's documented ${device.i2cAddresses.join('/')}`
          }
        }
        addEdge({ from: id, to: `bus:${busKey}`, relation: 'likely-on-bus', note })
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges,
    incomplete: model.pinsTruncated || model.busesTruncated || model.librariesTruncated
  }
}

/** Everything a given source file touches: its outgoing edges, resolved. */
export function hardwareForFile(graph: HardwareGraph, file: string): Array<{ edge: HwEdge; node: HwNode }> {
  const id = `file:${norm(file)}`
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  return graph.edges.filter((e) => e.from === id && byId.has(e.to)).map((e) => ({ edge: e, node: byId.get(e.to)! }))
}
