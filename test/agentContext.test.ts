import { describe, it, expect } from 'vitest'
import { formatEnvironmentReport, formatHardwareGraph } from '../src/shared/agentContext'
import { reconcileEnvironment, type EnvInput } from '../src/shared/environment'
import { buildHardwareGraph } from '../src/shared/hardwareGraph'
import type { ProjectModel } from '../src/shared/ipc'

function envInput(over: Partial<EnvInput> = {}): EnvInput {
  return {
    fqbn: 'esp32:esp32:esp32da',
    installedCores: [{ id: 'esp32:esp32', installedVersion: '3.3.11', latestVersion: '3.3.11' }],
    installedLibraries: [
      { name: 'ESP32Servo', installedVersion: '3.2.1', latestVersion: '3.2.1', providesIncludes: ['ESP32Servo.h'] }
    ],
    usedIncludes: [
      { header: 'ESP32Servo.h', file: 'main.ino', line: 2 },
      { header: 'Wire.h', file: 'main.ino', line: 3 },
      { header: 'Mystery.h', file: 'main.ino', line: 4 }
    ],
    ...over
  }
}

describe('formatEnvironmentReport', () => {
  it('shows the board/core, each dependency state, and never upgrades unverified to present', () => {
    const text = formatEnvironmentReport(reconcileEnvironment(envInput()))
    expect(text).toContain('esp32:esp32:esp32da')
    expect(text).toContain('core installed 3.3.11')
    // resolved via the named library, toolchain header labelled, unknown stays unverified
    expect(text).toMatch(/esp32servo\.h: resolved via ESP32Servo 3\.2\.1/i)
    expect(text).toMatch(/wire\.h: toolchain/i)
    expect(text).toMatch(/mystery\.h: unverified/i)
    // The honesty line: an unverified header is never called present/installed.
    expect(text).not.toMatch(/mystery\.h: resolved/i)
  })

  it('reports a not-installed core plainly', () => {
    const text = formatEnvironmentReport(
      reconcileEnvironment(envInput({ installedCores: [], arduinoCliAvailable: true }))
    )
    expect(text).toContain('core NOT installed')
  })

  it('says when no board is selected', () => {
    const text = formatEnvironmentReport(reconcileEnvironment(envInput({ fqbn: null })))
    expect(text).toContain('Board: none selected')
  })

  it('surfaces a build-confirmed missing header as a finding', () => {
    const text = formatEnvironmentReport(
      reconcileEnvironment(envInput({ buildMissingHeaders: ['Mystery.h'] }))
    )
    expect(text).toMatch(/mystery\.h: MISSING/i)
    expect(text).toMatch(/\[error\]/i)
  })
})

function model(over: Partial<ProjectModel> = {}): ProjectModel {
  return {
    languages: [],
    boards: [{ name: 'ESP32 Dev', platform: 'esp32', framework: 'arduino' }],
    toolchains: [],
    pins: [{ file: 'main.ino', line: 5, pin: '5', role: 'digitalWrite' }],
    pinsTruncated: false,
    buses: [{ file: 'main.ino', line: 6, bus: 'i2c', instance: 'Wire', role: 'begin', address: '0x68' }],
    busesTruncated: false,
    libraries: [{ file: 'main.ino', line: 1, header: 'Adafruit_MPU6050.h' }],
    librariesTruncated: false,
    ...over
  }
}

describe('formatHardwareGraph', () => {
  it('lists the board, devices, buses and pins', () => {
    const text = formatHardwareGraph(buildHardwareGraph(model()))
    expect(text).toContain('ESP32 Dev')
    expect(text).toContain('MPU6050')
    expect(text).toMatch(/I2C \(Wire\)/)
    expect(text).toMatch(/\b5\b/)
  })

  it('keeps an inferred bus attachment hedged ("likely", with a note)', () => {
    // MPU6050 is I2C-only and there is exactly one I2C bus, so the graph infers
    // attachment; the text must present it as inference, not fact.
    const text = formatHardwareGraph(buildHardwareGraph(model()))
    expect(text).toMatch(/likely on/i)
    expect(text.toLowerCase()).not.toMatch(/mpu6050 is on/i) // never asserted as certain
  })
})
