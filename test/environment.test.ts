import { describe, it, expect } from 'vitest'
import {
  reconcileEnvironment,
  normalizeHeader,
  platformIdFromFqbn,
  updateRisk,
  extractMissingHeaders,
  type EnvInput
} from '../src/shared/environment'

function base(over: Partial<EnvInput> = {}): EnvInput {
  return {
    fqbn: null,
    installedCores: [],
    installedLibraries: [],
    usedIncludes: [],
    ...over
  }
}

describe('platformIdFromFqbn', () => {
  it('extracts vendor:arch from a full fqbn', () => {
    expect(platformIdFromFqbn('esp32:esp32:esp32devkitv1')).toBe('esp32:esp32')
    expect(platformIdFromFqbn('arduino:avr:uno')).toBe('arduino:avr')
  })
  it('is null for absent or malformed ids', () => {
    expect(platformIdFromFqbn(null)).toBeNull()
    expect(platformIdFromFqbn('')).toBeNull()
    expect(platformIdFromFqbn('esp32')).toBeNull()
    expect(platformIdFromFqbn('esp32:')).toBeNull()
  })
})

describe('normalizeHeader', () => {
  it('strips delimiters, lowercases, keeps subpath', () => {
    expect(normalizeHeader('<Wire.h>')).toBe('wire.h')
    expect(normalizeHeader('"Adafruit_MPU6050.h"')).toBe('adafruit_mpu6050.h')
    expect(normalizeHeader(' freertos/task.h ')).toBe('freertos/task.h')
    expect(normalizeHeader('<vector>')).toBe('vector')
  })
})

describe('updateRisk', () => {
  it('scales risk to the semver delta', () => {
    expect(updateRisk('1.0.0', '2.0.0').risk).toBe('high')
    expect(updateRisk('1.0.0', '1.2.0').risk).toBe('medium')
    expect(updateRisk('1.0.0', '1.0.3').risk).toBe('low')
    expect(updateRisk('1.0.0', '1.0.0').risk).toBe('low')
    expect(updateRisk('weird', '1.0.0').risk).toBe('unknown')
  })
})

describe('reconcileEnvironment: board / core', () => {
  it('flags a missing core with an install suggestion', () => {
    const r = reconcileEnvironment(base({ fqbn: 'esp32:esp32:esp32devkitv1', installedCores: [] }))
    expect(r.core.installed).toBe(false)
    expect(r.core.platformId).toBe('esp32:esp32')
    const f = r.findings.find((x) => x.id === 'core-missing')
    expect(f?.severity).toBe('error')
    expect(f?.suggestion).toEqual({ kind: 'install-core', target: 'esp32:esp32' })
  })

  it('reports an installed core as ok', () => {
    const r = reconcileEnvironment(
      base({
        fqbn: 'esp32:esp32:esp32devkitv1',
        installedCores: [{ id: 'esp32:esp32', installedVersion: '3.0.0', latestVersion: '3.0.0' }]
      })
    )
    expect(r.core.installed).toBe(true)
    expect(r.core.installedVersion).toBe('3.0.0')
    expect(r.findings.some((f) => f.id === 'core-ok')).toBe(true)
  })

  it('warns on a malformed fqbn and makes no core claim', () => {
    const r = reconcileEnvironment(base({ fqbn: 'nonsense' }))
    expect(r.core.platformId).toBeNull()
    expect(r.findings.some((f) => f.id === 'fqbn-malformed')).toBe(true)
  })

  it('makes no core finding when no board is selected', () => {
    const r = reconcileEnvironment(base({ fqbn: null }))
    expect(r.findings.some((f) => f.category === 'core' || f.category === 'board')).toBe(false)
  })
})

describe('reconcileEnvironment: dependency tiers', () => {
  it('marks only provably-universal headers as provided-by-toolchain', () => {
    const r = reconcileEnvironment(
      base({
        usedIncludes: [
          { header: 'Arduino.h', file: 'a.ino', line: 1 },
          { header: 'Wire.h', file: 'a.ino', line: 2 },
          { header: 'SPI.h', file: 'a.ino', line: 3 },
          { header: '<stdint.h>', file: 'a.ino', line: 4 }
        ]
      })
    )
    for (const h of ['arduino.h', 'wire.h', 'spi.h', 'stdint.h']) {
      expect(r.dependencies.find((d) => d.header === h)?.state).toBe('provided-by-toolchain')
    }
  })

  it('does NOT claim the C++ STL or EEPROM.h are toolchain-provided (not universal across cores)', () => {
    // AVR ships no hosted libstdc++, and SAMD/SAM have no EEPROM library, so
    // these must never be a false green. A build gives the certain verdict.
    const r = reconcileEnvironment(
      base({
        fqbn: 'arduino:avr:uno',
        installedCores: [{ id: 'arduino:avr', installedVersion: '1.8.6', latestVersion: '1.8.6' }],
        usedIncludes: [
          { header: '<vector>', file: 'a.ino', line: 1 },
          { header: '<string>', file: 'a.ino', line: 2 },
          { header: 'EEPROM.h', file: 'a.ino', line: 3 },
          { header: '<fenv.h>', file: 'a.ino', line: 4 }
        ]
      })
    )
    for (const h of ['vector', 'string', 'eeprom.h', 'fenv.h']) {
      expect(r.dependencies.find((d) => d.header === h)?.state).toBe('unverified')
    }
  })

  it('resolves a header an installed library declares it provides', () => {
    const r = reconcileEnvironment(
      base({
        installedLibraries: [
          { name: 'Adafruit MPU6050', installedVersion: '2.2.6', latestVersion: '2.2.6', providesIncludes: ['Adafruit_MPU6050.h'] }
        ],
        usedIncludes: [{ header: 'Adafruit_MPU6050.h', file: 'imu.cpp', line: 3 }]
      })
    )
    const dep = r.dependencies.find((d) => d.header === 'adafruit_mpu6050.h')
    expect(dep?.state).toBe('resolved')
    expect(dep?.provider).toBe('Adafruit MPU6050')
    expect(dep?.providerVersion).toBe('2.2.6')
  })

  it('leaves an unmatched third-party header unverified, never falsely missing', () => {
    const r = reconcileEnvironment(
      base({
        installedLibraries: [
          { name: 'SomeLib', installedVersion: '1.0.0', latestVersion: '1.0.0', providesIncludes: ['SomeLib.h'] }
        ],
        usedIncludes: [{ header: 'Foo.h', file: 'x.cpp', line: 9 }]
      })
    )
    const dep = r.dependencies.find((d) => d.header === 'foo.h')
    expect(dep?.state).toBe('unverified')
    expect(r.dependencies.some((d) => d.state === 'missing')).toBe(false)
    expect(r.findings.some((f) => f.id === 'deps-unverified')).toBe(true)
  })

  it('is incomplete when there is no provider map to reason from', () => {
    const r = reconcileEnvironment(
      base({
        installedLibraries: [{ name: 'SomeLib', installedVersion: '1.0.0', latestVersion: '1.0.0', providesIncludes: [] }],
        usedIncludes: [{ header: 'Foo.h', file: 'x.cpp', line: 9 }]
      })
    )
    expect(r.incomplete).toBe(true)
  })

  it('aggregates every use site of one header into a single dependency', () => {
    const r = reconcileEnvironment(
      base({
        usedIncludes: [
          { header: 'Foo.h', file: 'a.cpp', line: 1 },
          { header: 'Foo.h', file: 'b.cpp', line: 2 }
        ]
      })
    )
    const foo = r.dependencies.filter((d) => d.header === 'foo.h')
    expect(foo).toHaveLength(1)
    expect(foo[0].usedAt).toHaveLength(2)
  })

  it('is incomplete when the include scan was truncated', () => {
    const r = reconcileEnvironment(base({ librariesTruncated: true }))
    expect(r.incomplete).toBe(true)
  })

  it('does not cross-attribute a basename two libraries both provide', () => {
    const r = reconcileEnvironment(
      base({
        installedLibraries: [
          { name: 'A', installedVersion: '1.0.0', latestVersion: '1.0.0', providesIncludes: ['a/Config.h'] },
          { name: 'B', installedVersion: '1.0.0', latestVersion: '1.0.0', providesIncludes: ['b/Config.h'] }
        ],
        usedIncludes: [{ header: 'Config.h', file: 'x.cpp', line: 1 }]
      })
    )
    // Ambiguous basename -> cannot attribute to A or B -> unverified, not a wrong provider.
    expect(r.dependencies.find((d) => d.header === 'config.h')?.state).toBe('unverified')
  })

  it('resolves a full-path provides_includes match unambiguously', () => {
    const r = reconcileEnvironment(
      base({
        installedLibraries: [
          { name: 'A', installedVersion: '1.0.0', latestVersion: '1.0.0', providesIncludes: ['a/Config.h'] }
        ],
        usedIncludes: [{ header: 'a/Config.h', file: 'x.cpp', line: 1 }]
      })
    )
    expect(r.dependencies.find((d) => d.header === 'a/config.h')?.provider).toBe('A')
  })

  it('dedupes an identical (file,line) use site', () => {
    const r = reconcileEnvironment(
      base({
        usedIncludes: [
          { header: 'Foo.h', file: 'a.cpp', line: 5 },
          { header: 'Foo.h', file: 'a.cpp', line: 5 }
        ]
      })
    )
    expect(r.dependencies.find((d) => d.header === 'foo.h')?.usedAt).toHaveLength(1)
  })
})

describe('extractMissingHeaders', () => {
  it('pulls the not-found header out of a compiler error', () => {
    const diags = [
      { message: 'Foo.h: No such file or directory' },
      { message: "fatal error: Adafruit_MPU6050.h: No such file or directory" },
      { message: 'expected ; before }' }
    ]
    expect(extractMissingHeaders(diags).sort()).toEqual(['adafruit_mpu6050.h', 'foo.h'])
  })
  it('is empty when no missing-file errors are present', () => {
    expect(extractMissingHeaders([{ message: 'unused variable x' }])).toEqual([])
  })
})

describe('reconcileEnvironment: build correlation (certain missing)', () => {
  it('upgrades an unverified header to missing when the build could not find it', () => {
    const r = reconcileEnvironment(
      base({
        usedIncludes: [{ header: 'Foo.h', file: 'x.cpp', line: 1 }],
        buildMissingHeaders: ['Foo.h']
      })
    )
    const dep = r.dependencies.find((d) => d.header === 'foo.h')
    expect(dep?.state).toBe('missing')
    const f = r.findings.find((x) => x.id === 'missing-foo.h')
    expect(f?.severity).toBe('error')
    expect(f?.suggestion).toEqual({ kind: 'search-library', target: 'foo.h' })
    expect(f?.file).toBe('x.cpp')
  })
  it('marks only the exact reported header missing, never a same-basename path include', () => {
    const r = reconcileEnvironment(
      base({
        usedIncludes: [{ header: 'vendor/config.h', file: 'x.cpp', line: 1 }],
        buildMissingHeaders: ['config.h'] // a DIFFERENT, bare header
      })
    )
    // The build reported bare config.h, not vendor/config.h: no false missing.
    expect(r.dependencies.find((d) => d.header === 'vendor/config.h')?.state).not.toBe('missing')
  })

  it('marks a path-qualified header missing when the build reported that exact path', () => {
    const r = reconcileEnvironment(
      base({
        usedIncludes: [{ header: 'vendor/config.h', file: 'x.cpp', line: 1 }],
        buildMissingHeaders: ['vendor/config.h']
      })
    )
    expect(r.dependencies.find((d) => d.header === 'vendor/config.h')?.state).toBe('missing')
  })

  it('does not mark a resolved header missing just because the build mentioned it', () => {
    const r = reconcileEnvironment(
      base({
        installedLibraries: [{ name: 'L', installedVersion: '1.0.0', latestVersion: '1.0.0', providesIncludes: ['Foo.h'] }],
        usedIncludes: [{ header: 'Foo.h', file: 'x.cpp', line: 1 }],
        buildMissingHeaders: ['Foo.h']
      })
    )
    expect(r.dependencies.find((d) => d.header === 'foo.h')?.state).toBe('resolved')
  })
})

describe('reconcileEnvironment: hardware pin checks', () => {
  it('flags an output driven on an input-only ESP32 pad, with the source site', () => {
    const r = reconcileEnvironment(
      base({
        fqbn: 'esp32:esp32:esp32da',
        boardMcu: 'esp32',
        installedCores: [{ id: 'esp32:esp32', installedVersion: '3.0.0', latestVersion: '3.0.0' }],
        pins: [{ pin: '34', role: 'digitalWrite', file: 'm.ino', line: 7 }]
      })
    )
    const f = r.findings.find((x) => x.category === 'hardware')
    expect(f?.severity).toBe('error')
    expect(f?.title).toContain('GPIO34')
    expect(f).toMatchObject({ file: 'm.ino', line: 7 })
  })
  it('makes no hardware claim when the MCU is unknown', () => {
    const r = reconcileEnvironment(
      base({ fqbn: 'arduino:avr:uno', pins: [{ pin: '34', role: 'digitalWrite', file: 'm.ino', line: 7 }] })
    )
    expect(r.findings.some((f) => f.category === 'hardware')).toBe(false)
  })
  it('makes no hardware claim on an esp32:esp32 board that is actually an S3 die', () => {
    // An esp32:esp32 board id (nano_nora) whose real MCU is esp32s3: keying on
    // the MCU, not the fqbn, means GPIO34-as-output is correctly NOT flagged.
    const r = reconcileEnvironment(
      base({
        fqbn: 'esp32:esp32:nano_nora',
        boardMcu: 'esp32s3',
        installedCores: [{ id: 'esp32:esp32', installedVersion: '3.0.0', latestVersion: '3.0.0' }],
        pins: [{ pin: '34', role: 'digitalWrite', file: 'm.ino', line: 7 }]
      })
    )
    expect(r.findings.some((f) => f.category === 'hardware')).toBe(false)
  })
})

describe('reconcileEnvironment: honesty when tooling is unavailable', () => {
  it('does not claim a core is missing (or suggest an install) when arduino-cli is unavailable', () => {
    const r = reconcileEnvironment(
      base({ fqbn: 'esp32:esp32:dev', installedCores: [], arduinoCliAvailable: false })
    )
    expect(r.findings.some((f) => f.id === 'core-missing')).toBe(false)
    expect(r.findings.some((f) => f.id === 'toolchain-missing')).toBe(true)
    expect(r.core.installed).toBe(false)
  })

  it('treats an empty installedVersion as not installed (arduino-cli sentinel)', () => {
    const r = reconcileEnvironment(
      base({
        fqbn: 'esp32:esp32:dev',
        installedCores: [{ id: 'esp32:esp32', installedVersion: '', latestVersion: '3.0.0' }]
      })
    )
    expect(r.core.installed).toBe(false)
    expect(r.findings.some((f) => f.id === 'core-missing')).toBe(true)
  })
})

describe('reconcileEnvironment: updates', () => {
  it('reports an available update with risk and a suggestion', () => {
    const r = reconcileEnvironment(
      base({
        installedLibraries: [
          { name: 'ESP32Servo', installedVersion: '3.0.5', latestVersion: '3.0.7', providesIncludes: ['ESP32Servo.h'] }
        ]
      })
    )
    expect(r.updates).toHaveLength(1)
    expect(r.updates[0]).toMatchObject({ library: 'ESP32Servo', installed: '3.0.5', latest: '3.0.7', risk: 'low' })
    const f = r.findings.find((x) => x.id === 'update-ESP32Servo')
    expect(f?.suggestion).toEqual({ kind: 'update-library', target: 'ESP32Servo', version: '3.0.7' })
  })

  it('reports no update when installed is already latest', () => {
    const r = reconcileEnvironment(
      base({
        installedLibraries: [{ name: 'X', installedVersion: '1.2.3', latestVersion: '1.2.3', providesIncludes: ['X.h'] }]
      })
    )
    expect(r.updates).toHaveLength(0)
  })

  it('flags a major update as a warning', () => {
    const r = reconcileEnvironment(
      base({
        installedLibraries: [{ name: 'AsyncTCP', installedVersion: '1.1.4', latestVersion: '2.0.0', providesIncludes: ['AsyncTCP.h'] }]
      })
    )
    expect(r.updates[0].risk).toBe('high')
    expect(r.findings.find((f) => f.id === 'update-AsyncTCP')?.severity).toBe('warning')
  })
})

describe('reconcileEnvironment: finding order', () => {
  it('sorts errors before warnings before info before ok', () => {
    const r = reconcileEnvironment(
      base({
        fqbn: 'esp32:esp32:dev', // core-missing -> error
        installedLibraries: [
          { name: 'AsyncTCP', installedVersion: '1.0.0', latestVersion: '2.0.0', providesIncludes: ['AsyncTCP.h'] } // high -> warning
        ],
        usedIncludes: [{ header: 'Foo.h', file: 'x.cpp', line: 1 }] // unverified -> info
      })
    )
    const sev = r.findings.map((f) => f.severity)
    const rank = { error: 0, warning: 1, info: 2, ok: 3 } as const
    for (let i = 1; i < sev.length; i++) expect(rank[sev[i]]).toBeGreaterThanOrEqual(rank[sev[i - 1]])
  })
})
