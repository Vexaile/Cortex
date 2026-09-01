import { describe, it, expect } from 'vitest'
import { buildLock, parseLock, diffLock, LOCK_SCHEMA, type LockInput } from '../src/shared/lockfile'

function input(over: Partial<LockInput> = {}): LockInput {
  return {
    fqbn: 'esp32:esp32:esp32da',
    mcu: 'esp32',
    cores: [{ id: 'esp32:esp32', installedVersion: '3.3.11' }],
    libraries: [
      { name: 'ESP32Servo', installedVersion: '3.2.1' },
      { name: 'DHT sensor library', installedVersion: '1.4.7' }
    ],
    ...over
  }
}

describe('buildLock', () => {
  it('captures the board, mcu, cores and libraries', () => {
    const lock = buildLock(input())
    expect(lock.schema).toBe(LOCK_SCHEMA)
    expect(lock.board).toEqual({ fqbn: 'esp32:esp32:esp32da', mcu: 'esp32' })
    expect(lock.cores).toEqual([{ id: 'esp32:esp32', version: '3.3.11' }])
    expect(lock.libraries.map((l) => l.name)).toEqual(['DHT sensor library', 'ESP32Servo'])
  })

  it('is deterministic: sorts and dedups so the same environment serializes identically', () => {
    const a = buildLock(
      input({
        libraries: [
          { name: 'ESP32Servo', installedVersion: '3.2.1' },
          { name: 'DHT sensor library', installedVersion: '1.4.7' }
        ]
      })
    )
    const b = buildLock(
      input({
        libraries: [
          { name: 'DHT sensor library', installedVersion: '1.4.7' },
          { name: 'ESP32Servo', installedVersion: '3.2.1' },
          // A duplicate (first wins) must not change the bytes.
          { name: 'esp32servo', installedVersion: '9.9.9' }
        ]
      })
    )
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('excludes entries with no installed version (the not-installed sentinel)', () => {
    const lock = buildLock(
      input({
        cores: [
          { id: 'esp32:esp32', installedVersion: '3.3.11' },
          { id: 'arduino:avr', installedVersion: '' } // a search-result row, not installed
        ]
      })
    )
    expect(lock.cores).toEqual([{ id: 'esp32:esp32', version: '3.3.11' }])
  })

  it('dedups cores by id (first wins), like libraries', () => {
    const lock = buildLock(
      input({
        cores: [
          { id: 'esp32:esp32', installedVersion: '3.3.11' },
          { id: 'esp32:esp32', installedVersion: '9.9.9' }
        ]
      })
    )
    expect(lock.cores).toEqual([{ id: 'esp32:esp32', version: '3.3.11' }])
  })

  it('sorts by code unit, not by locale (punctuation is not folded away)', () => {
    // Locks in the machine-independent ordering: a locale collation would ignore
    // the space/dash/underscore and order these alphabetically (gfx, sensor,
    // unified); code-unit order puts space (0x20) < dash (0x2D) < underscore.
    const lock = buildLock(
      input({
        libraries: [
          { name: 'Adafruit_Sensor', installedVersion: '1.0.0' },
          { name: 'adafruit-gfx', installedVersion: '1.0.0' },
          { name: 'Adafruit Unified Sensor', installedVersion: '1.1.15' }
        ]
      })
    )
    expect(lock.libraries.map((l) => l.name)).toEqual(['Adafruit Unified Sensor', 'adafruit-gfx', 'Adafruit_Sensor'])
  })

  it('never carries a timestamp it was not given (stays clock-free)', () => {
    expect(buildLock(input()).generatedAt).toBeUndefined()
    expect(buildLock(input({ generatedAt: '2026-01-01T00:00:00Z' })).generatedAt).toBe('2026-01-01T00:00:00Z')
  })
})

describe('parseLock', () => {
  it('round-trips a lock it wrote', () => {
    const lock = buildLock(input({ generatedAt: '2026-01-02T03:04:05Z' }))
    const parsed = parseLock(JSON.parse(JSON.stringify(lock)))
    expect(parsed).toEqual(lock)
  })

  it('re-normalizes a hand-reordered file so it still compares deterministically', () => {
    const parsed = parseLock({
      schema: LOCK_SCHEMA,
      board: { fqbn: 'esp32:esp32:esp32da', mcu: 'esp32' },
      cores: [{ id: 'esp32:esp32', version: '3.3.11' }],
      libraries: [
        { name: 'ESP32Servo', version: '3.2.1' },
        { name: 'DHT sensor library', version: '1.4.7' }
      ]
    })
    expect(parsed?.libraries.map((l) => l.name)).toEqual(['DHT sensor library', 'ESP32Servo'])
  })

  it('rejects a wrong or missing schema', () => {
    expect(parseLock({ schema: 2, board: { fqbn: null }, cores: [], libraries: [] })).toBeNull()
    expect(parseLock({ board: { fqbn: null }, cores: [], libraries: [] })).toBeNull()
  })

  it('rejects malformed shapes rather than guessing', () => {
    expect(parseLock(null)).toBeNull()
    expect(parseLock('a string')).toBeNull()
    expect(parseLock({ schema: LOCK_SCHEMA, cores: [], libraries: [] })).toBeNull() // no board
    expect(parseLock({ schema: LOCK_SCHEMA, board: {}, cores: [], libraries: [] })).toBeNull() // no fqbn key
    expect(
      parseLock({ schema: LOCK_SCHEMA, board: { fqbn: null }, cores: [{ id: 'x' }], libraries: [] })
    ).toBeNull() // core missing version
    expect(
      parseLock({ schema: LOCK_SCHEMA, board: { fqbn: null }, cores: [], libraries: [{ name: 'x' }] })
    ).toBeNull() // lib missing version
  })

  it('rejects empty-string fields rather than silently dropping them', () => {
    // An empty version would be filtered out by buildLock, so accepting it here
    // would make parseLock return a lock that differs from the file (an entry
    // vanishing with no signal). Reject the shape instead.
    expect(
      parseLock({ schema: LOCK_SCHEMA, board: { fqbn: null }, cores: [{ id: 'esp32:esp32', version: '' }], libraries: [] })
    ).toBeNull()
    expect(
      parseLock({ schema: LOCK_SCHEMA, board: { fqbn: null }, cores: [], libraries: [{ name: '', version: '1.0.0' }] })
    ).toBeNull()
  })

  it('accepts an explicit null board fqbn (no board selected)', () => {
    const parsed = parseLock({ schema: LOCK_SCHEMA, board: { fqbn: null }, cores: [], libraries: [] })
    expect(parsed).toEqual({ schema: LOCK_SCHEMA, board: { fqbn: null }, cores: [], libraries: [] })
  })
})

describe('diffLock', () => {
  it('reports in-sync when the environment matches the lock', () => {
    const lock = buildLock(input())
    const drift = diffLock(lock, input())
    expect(drift.inSync).toBe(true)
    expect(drift.breakingCount).toBe(0)
  })

  it('detects a library version drift (a silent update)', () => {
    const lock = buildLock(input())
    const drift = diffLock(
      lock,
      input({
        libraries: [
          { name: 'ESP32Servo', installedVersion: '3.3.0' }, // was 3.2.1
          { name: 'DHT sensor library', installedVersion: '1.4.7' }
        ]
      })
    )
    expect(drift.inSync).toBe(false)
    expect(drift.librariesChanged).toEqual([{ name: 'ESP32Servo', locked: '3.2.1', installed: '3.3.0' }])
    expect(drift.breakingCount).toBe(1)
  })

  it('detects a missing library and a missing core', () => {
    const lock = buildLock(input())
    const drift = diffLock(
      lock,
      input({
        cores: [],
        libraries: [{ name: 'ESP32Servo', installedVersion: '3.2.1' }]
      })
    )
    expect(drift.coresMissing).toEqual([{ id: 'esp32:esp32', version: '3.3.11' }])
    expect(drift.librariesMissing).toEqual([{ name: 'DHT sensor library', version: '1.4.7' }])
    expect(drift.breakingCount).toBe(2)
  })

  it('reports an extra installed library as info, not as breaking', () => {
    const lock = buildLock(input())
    const drift = diffLock(
      lock,
      input({
        libraries: [
          { name: 'ESP32Servo', installedVersion: '3.2.1' },
          { name: 'DHT sensor library', installedVersion: '1.4.7' },
          { name: 'Adafruit Unified Sensor', installedVersion: '1.1.15' }
        ]
      })
    )
    expect(drift.extraLibraries).toEqual([{ name: 'Adafruit Unified Sensor', version: '1.1.15' }])
    expect(drift.inSync).toBe(true)
    expect(drift.breakingCount).toBe(0)
  })

  it('detects a board target change', () => {
    const lock = buildLock(input())
    const drift = diffLock(lock, input({ fqbn: 'esp32:esp32:esp32s3' }))
    expect(drift.boardChanged).toEqual({ from: 'esp32:esp32:esp32da', to: 'esp32:esp32:esp32s3' })
    expect(drift.inSync).toBe(false)
  })

  it('detects a board change to/from no board selected', () => {
    const lock = buildLock(input({ fqbn: null }))
    const drift = diffLock(lock, input({ fqbn: 'esp32:esp32:esp32da' }))
    expect(drift.boardChanged).toEqual({ from: null, to: 'esp32:esp32:esp32da' })
    expect(drift.inSync).toBe(false)
  })

  it('detects a core version drift', () => {
    const lock = buildLock(input())
    const drift = diffLock(lock, input({ cores: [{ id: 'esp32:esp32', installedVersion: '3.0.0' }] }))
    expect(drift.coresChanged).toEqual([{ id: 'esp32:esp32', locked: '3.3.11', installed: '3.0.0' }])
    expect(drift.coresMissing).toEqual([])
    expect(drift.breakingCount).toBe(1)
    expect(drift.inSync).toBe(false)
  })

  it('reports an extra installed core as info, not as breaking', () => {
    const lock = buildLock(input())
    const drift = diffLock(
      lock,
      input({
        cores: [
          { id: 'esp32:esp32', installedVersion: '3.3.11' },
          { id: 'arduino:avr', installedVersion: '1.8.6' }
        ]
      })
    )
    expect(drift.extraCores).toEqual([{ id: 'arduino:avr', version: '1.8.6' }])
    expect(drift.inSync).toBe(true)
    expect(drift.breakingCount).toBe(0)
  })

  it('compares library names case-insensitively (arduino-cli install identity)', () => {
    const lock = buildLock(input())
    const drift = diffLock(
      lock,
      input({
        libraries: [
          { name: 'esp32servo', installedVersion: '3.2.1' },
          { name: 'DHT Sensor Library', installedVersion: '1.4.7' }
        ]
      })
    )
    expect(drift.librariesMissing).toEqual([])
    expect(drift.librariesChanged).toEqual([])
    expect(drift.inSync).toBe(true)
  })
})
