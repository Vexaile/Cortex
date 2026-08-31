import { describe, it, expect } from 'vitest'
import { buildHardwareGraph, hardwareForFile, DEVICE_MAP } from '../src/shared/hardwareGraph'
import type { ProjectModel } from '../src/shared/ipc'

const empty: ProjectModel = {
  languages: [],
  boards: [],
  toolchains: [],
  pins: [],
  pinsTruncated: false,
  buses: [],
  busesTruncated: false,
  libraries: [],
  librariesTruncated: false
}

const model = (over: Partial<ProjectModel>): ProjectModel => ({ ...empty, ...over })

describe('buildHardwareGraph', () => {
  it('returns an empty graph for an empty model', () => {
    const g = buildHardwareGraph(empty)
    expect(g.nodes).toEqual([])
    expect(g.edges).toEqual([])
    expect(g.incomplete).toBe(false)
  })

  it('creates a board node from the first board', () => {
    const g = buildHardwareGraph(model({ boards: [{ name: 'esp32dev', platform: 'espressif32', framework: 'arduino', source: 'platformio.ini', env: 'esp32dev' }] }))
    const board = g.nodes.find((n) => n.kind === 'board')
    expect(board?.label).toBe('esp32dev')
    expect(board?.detail).toBe('espressif32, arduino')
  })

  it('creates one pin node per distinct pin with file edges carrying provenance', () => {
    const g = buildHardwareGraph(
      model({
        pins: [
          { file: 'src/main.cpp', line: 3, pin: '13', role: 'pinMode', mode: 'OUTPUT' },
          { file: 'src/main.cpp', line: 8, pin: '13', role: 'digitalWrite' },
          { file: 'src/other.cpp', line: 2, pin: 'A0', role: 'analogRead' }
        ]
      })
    )
    const pins = g.nodes.filter((n) => n.kind === 'pin')
    expect(pins.map((p) => p.label).sort()).toEqual(['13', 'A0'])
    expect(pins.find((p) => p.label === '13')?.detail).toBe('mode: OUTPUT · pinMode, digitalWrite')
    const edges = g.edges.filter((e) => e.relation === 'uses-pin')
    expect(edges).toHaveLength(2) // deduped per (file, pin): two roles on pin 13 from one file collapse to one edge
    expect(edges[0]).toMatchObject({ from: 'file:src/main.cpp', to: 'pin:13', file: 'src/main.cpp', line: 3 })
  })

  it('keeps Wire and Wire1 as separate bus nodes and lists observed addresses', () => {
    const g = buildHardwareGraph(
      model({
        buses: [
          { file: 'src/a.cpp', line: 1, bus: 'i2c', instance: 'Wire', role: 'begin' },
          { file: 'src/a.cpp', line: 2, bus: 'i2c', instance: 'Wire', role: 'beginTransmission', address: '0x68' },
          { file: 'src/a.cpp', line: 3, bus: 'i2c', instance: 'Wire1', role: 'begin' }
        ]
      })
    )
    const buses = g.nodes.filter((n) => n.kind === 'bus')
    expect(buses.map((b) => b.label).sort()).toEqual(['I2C (Wire)', 'I2C (Wire1)'])
    expect(buses.find((b) => b.id === 'bus:i2c:Wire')?.detail).toBe('addresses seen: 0x68')
  })

  it('recognizes a device from its driver include and dedupes across headers of the same part', () => {
    const g = buildHardwareGraph(
      model({
        libraries: [
          { file: 'src/imu.cpp', line: 1, header: 'Adafruit_MPU6050.h' },
          { file: 'src/imu2.cpp', line: 1, header: 'MPU6050.h' },
          { file: 'src/main.cpp', line: 1, header: 'Wire.h' }
        ]
      })
    )
    const devices = g.nodes.filter((n) => n.kind === 'device')
    expect(devices).toHaveLength(1)
    expect(devices[0].label).toBe('MPU6050')
    expect(g.edges.filter((e) => e.relation === 'includes-driver')).toHaveLength(2)
  })

  it('matches driver headers case-insensitively and by basename', () => {
    const g = buildHardwareGraph(model({ libraries: [{ file: 'src/t.cpp', line: 1, header: 'MAX6675.h' }] }))
    expect(g.nodes.find((n) => n.kind === 'device')?.label).toBe('MAX6675')
  })

  it('attaches a single-bus-kind device to the only bus of that kind, with a reason', () => {
    const g = buildHardwareGraph(
      model({
        buses: [{ file: 'src/m.cpp', line: 2, bus: 'i2c', instance: 'Wire', role: 'beginTransmission', address: '0x68' }],
        libraries: [{ file: 'src/m.cpp', line: 1, header: 'Adafruit_MPU6050.h' }]
      })
    )
    const edge = g.edges.find((e) => e.relation === 'likely-on-bus')
    expect(edge).toMatchObject({ from: 'device:mpu6050', to: 'bus:i2c:Wire' })
    expect(edge?.note).toContain('only I2C bus opened')
    expect(edge?.note).toContain('0x68')
    expect(edge?.note).toContain('matches')
  })

  it('flags an address mismatch instead of pretending it fits', () => {
    const g = buildHardwareGraph(
      model({
        buses: [{ file: 'src/m.cpp', line: 2, bus: 'i2c', instance: 'Wire', role: 'beginTransmission', address: '0x08' }],
        libraries: [{ file: 'src/m.cpp', line: 1, header: 'Adafruit_MPU6050.h' }]
      })
    )
    const edge = g.edges.find((e) => e.relation === 'likely-on-bus')
    expect(edge?.note).toContain('outside this part')
  })

  it('compares addresses numerically: decimal 104 and 0x068 both match the MPU6050 at 0x68', () => {
    for (const addr of ['104', '0x068']) {
      const g = buildHardwareGraph(
        model({
          buses: [{ file: 'src/m.cpp', line: 2, bus: 'i2c', instance: 'Wire', role: 'beginTransmission', address: addr }],
          libraries: [{ file: 'src/m.cpp', line: 1, header: 'Adafruit_MPU6050.h' }]
        })
      )
      const edge = g.edges.find((e) => e.relation === 'likely-on-bus')
      expect(edge?.note, `address literal ${addr}`).toContain('matches')
    }
  })

  it('draws no likely-on-bus edge at all when the bus scan was truncated', () => {
    const g = buildHardwareGraph(
      model({
        buses: [{ file: 'src/m.cpp', line: 2, bus: 'i2c', instance: 'Wire', role: 'begin' }],
        busesTruncated: true,
        libraries: [{ file: 'src/m.cpp', line: 1, header: 'Adafruit_MPU6050.h' }]
      })
    )
    expect(g.edges.find((e) => e.relation === 'likely-on-bus')).toBeUndefined()
    expect(g.incomplete).toBe(true)
  })

  it('does NOT attach a device that can live on more than one bus kind', () => {
    const g = buildHardwareGraph(
      model({
        buses: [{ file: 'src/m.cpp', line: 2, bus: 'i2c', instance: 'Wire', role: 'begin' }],
        libraries: [{ file: 'src/m.cpp', line: 1, header: 'Adafruit_BME280.h' }] // i2c OR spi
      })
    )
    expect(g.edges.find((e) => e.relation === 'likely-on-bus')).toBeUndefined()
  })

  it('does NOT attach when two buses of the kind are open', () => {
    const g = buildHardwareGraph(
      model({
        buses: [
          { file: 'src/m.cpp', line: 2, bus: 'i2c', instance: 'Wire', role: 'begin' },
          { file: 'src/m.cpp', line: 3, bus: 'i2c', instance: 'Wire1', role: 'begin' }
        ],
        libraries: [{ file: 'src/m.cpp', line: 1, header: 'Adafruit_MPU6050.h' }]
      })
    )
    expect(g.edges.find((e) => e.relation === 'likely-on-bus')).toBeUndefined()
  })

  it('never attaches a UART device: Serial doubles as the debug console', () => {
    const g = buildHardwareGraph(
      model({
        buses: [{ file: 'src/m.cpp', line: 2, bus: 'uart', instance: 'Serial', role: 'begin', baud: 115200 }],
        libraries: [{ file: 'src/m.cpp', line: 1, header: 'TinyGPSPlus.h' }]
      })
    )
    expect(g.nodes.find((n) => n.kind === 'device')?.label).toBe('GPS module')
    expect(g.edges.find((e) => e.relation === 'likely-on-bus')).toBeUndefined()
  })

  it('normalizes Windows paths in file node ids', () => {
    const g = buildHardwareGraph(model({ pins: [{ file: 'src\\main.cpp', line: 1, pin: '5', role: 'pinMode', mode: 'INPUT' }] }))
    expect(g.nodes.find((n) => n.kind === 'file')?.id).toBe('file:src/main.cpp')
  })

  it('propagates truncation from any underlying scan', () => {
    expect(buildHardwareGraph(model({ pinsTruncated: true })).incomplete).toBe(true)
    expect(buildHardwareGraph(model({ busesTruncated: true })).incomplete).toBe(true)
    expect(buildHardwareGraph(model({ librariesTruncated: true })).incomplete).toBe(true)
  })
})

describe('hardwareForFile', () => {
  it('answers "what hardware does this file control"', () => {
    const g = buildHardwareGraph(
      model({
        pins: [
          { file: 'src/main.cpp', line: 3, pin: '13', role: 'pinMode', mode: 'OUTPUT' },
          { file: 'src/other.cpp', line: 2, pin: 'A0', role: 'analogRead' }
        ],
        buses: [{ file: 'src/main.cpp', line: 5, bus: 'i2c', instance: 'Wire', role: 'begin' }]
      })
    )
    const hw = hardwareForFile(g, 'src\\main.cpp') // Windows-style input resolves too
    expect(hw.map((h) => h.node.id).sort()).toEqual(['bus:i2c:Wire', 'pin:13'])
  })
})

describe('DEVICE_MAP integrity', () => {
  it('uses lowercase keys ending in .h so basename matching works', () => {
    for (const key of Object.keys(DEVICE_MAP)) {
      expect(key).toBe(key.toLowerCase())
      expect(key.endsWith('.h')).toBe(true)
    }
  })

  it('declares i2c addresses only for parts that can sit on i2c', () => {
    for (const dev of Object.values(DEVICE_MAP)) {
      if (dev.i2cAddresses) expect(dev.busKinds).toContain('i2c')
      for (const a of dev.i2cAddresses ?? []) expect(a).toMatch(/^0x[0-9A-Fa-f]{2}$/)
    }
  })
})
