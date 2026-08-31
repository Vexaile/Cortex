import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parsePlatformioIni, scanPins, buildProjectModel } from '../src/main/services/projectModelService'
import type { PinUsage } from '../src/shared/ipc'

describe('parsePlatformioIni', () => {
  it('reads board/platform/framework from a single env', () => {
    const boards = parsePlatformioIni(
      ['[env:esp32dev]', 'board = esp32dev', 'platform = espressif32', 'framework = arduino'].join('\n')
    )
    expect(boards).toEqual([{ name: 'esp32dev', platform: 'espressif32', framework: 'arduino', source: 'platformio.ini', env: 'esp32dev' }])
  })

  it('reads multiple [env:] sections independently', () => {
    const boards = parsePlatformioIni(
      [
        '[env:uno]',
        'board = uno',
        'platform = atmelavr',
        '',
        '[env:esp32dev]',
        'board = esp32dev',
        'platform = espressif32'
      ].join('\n')
    )
    expect(boards.map((b) => b.name)).toEqual(['uno', 'esp32dev'])
    expect(boards[1].framework).toBeUndefined()
  })

  it('ignores non-env sections and stray keys outside any [env:] block', () => {
    const boards = parsePlatformioIni(['board = should_not_count', '[platformio]', 'default_envs = uno', '[env:uno]', 'board = uno'].join('\n'))
    expect(boards).toEqual([{ name: 'uno', platform: undefined, framework: undefined, source: 'platformio.ini', env: 'uno' }])
  })

  it('strips ; comments', () => {
    const boards = parsePlatformioIni(['[env:uno] ; the classic', 'board = uno ; Arduino Uno'].join('\n'))
    expect(boards[0].name).toBe('uno')
  })

  it('drops an [env:] with no board key rather than emitting a half-populated entry', () => {
    const boards = parsePlatformioIni(['[env:uno]', 'platform = atmelavr'].join('\n'))
    expect(boards).toEqual([])
  })

  it('returns nothing for an empty or unrelated file', () => {
    expect(parsePlatformioIni('')).toEqual([])
    expect(parsePlatformioIni('# just a comment\nkey=value')).toEqual([])
  })
})

describe('scanPins', () => {
  it('finds pinMode with its mode argument', () => {
    const out: PinUsage[] = []
    scanPins('main.cpp', 'pinMode(13, OUTPUT);', out, 100)
    expect(out).toEqual([{ file: 'main.cpp', line: 1, pin: '13', role: 'pinMode', mode: 'OUTPUT' }])
  })

  it('finds digitalWrite/digitalRead/analogWrite/analogRead without a mode field', () => {
    const out: PinUsage[] = []
    scanPins('m.cpp', 'digitalWrite(LED_BUILTIN, HIGH);\nanalogRead(A0);', out, 100)
    expect(out.map((p) => ({ pin: p.pin, role: p.role, mode: p.mode }))).toEqual([
      { pin: 'LED_BUILTIN', role: 'digitalWrite', mode: undefined },
      { pin: 'A0', role: 'analogRead', mode: undefined }
    ])
  })

  it('records the correct 1-indexed line number for each match', () => {
    const out: PinUsage[] = []
    scanPins('m.cpp', 'int x = 1;\nint y = 2;\npinMode(5, INPUT);', out, 100)
    expect(out[0].line).toBe(3)
  })

  it('stops at the cap mid-scan without throwing', () => {
    const out: PinUsage[] = []
    const lines = Array.from({ length: 10 }, (_, i) => `digitalWrite(${i}, HIGH);`).join('\n')
    scanPins('m.cpp', lines, out, 3)
    expect(out).toHaveLength(3)
  })

  it('does not match a similarly-named identifier that is not actually the call', () => {
    const out: PinUsage[] = []
    scanPins('m.cpp', 'int notPinMode = 5;\nmyDigitalWriteWrapper(1);', out, 100)
    expect(out).toEqual([])
  })
})

describe('buildProjectModel', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cortex-model-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('combines language breakdown, board (from platformio.ini), and a pin scan of real source files', async () => {
    writeFileSync(join(root, 'platformio.ini'), ['[env:uno]', 'board = uno', 'platform = atmelavr', 'framework = arduino'].join('\n'), 'utf8')
    mkdirSync(join(root, 'src'))
    writeFileSync(
      join(root, 'src', 'main.cpp'),
      ['void setup() {', '  pinMode(13, OUTPUT);', '  digitalWrite(13, HIGH);', '}', 'void loop() {}'].join('\n'),
      'utf8'
    )
    writeFileSync(join(root, 'src', 'helper.py'), 'print("hi")\n', 'utf8')

    const model = await buildProjectModel(root)

    expect(model.boards).toEqual([{ name: 'uno', platform: 'atmelavr', framework: 'arduino', source: 'platformio.ini', env: 'uno' }])
    expect(model.languages.find((l) => l.id === 'cpp')?.fileCount).toBe(1)
    expect(model.languages.find((l) => l.id === 'python')?.fileCount).toBe(1)
    expect(model.pins.map((p) => p.role).sort()).toEqual(['digitalWrite', 'pinMode'])
    expect(model.pinsTruncated).toBe(false)
    // Real toolchain probing (whatever's actually installed on this machine) -
    // just assert the shape, not specific contents, so this isn't tied to CI's toolset.
    expect(Array.isArray(model.toolchains)).toBe(true)
  })

  it('excludes .pio and build directories from language breakdown and pin scan, so a vendored library is not counted as project code', async () => {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'main.cpp'), 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() {}\n', 'utf8')
    mkdirSync(join(root, '.pio', 'libdeps', 'esp32dev', 'ESP32Servo', 'examples', 'AnalogWrite'), { recursive: true })
    writeFileSync(
      join(root, '.pio', 'libdeps', 'esp32dev', 'ESP32Servo', 'examples', 'AnalogWrite', 'AnalogWrite.ino'),
      'void setup() { pinMode(5, OUTPUT); analogWrite(5, 128); }\n',
      'utf8'
    )
    writeFileSync(join(root, '.pio', 'libdeps', 'esp32dev', 'ESP32Servo', 'examples', 'AnalogWrite', 'notes.py'), 'print("vendored")\n', 'utf8')
    mkdirSync(join(root, 'build'), { recursive: true })
    writeFileSync(join(root, 'build', 'generated.cpp'), 'void setup() { digitalWrite(2, HIGH); }\n', 'utf8')

    const model = await buildProjectModel(root)

    expect(model.languages.find((l) => l.id === 'cpp')?.fileCount).toBe(1)
    expect(model.languages.find((l) => l.id === 'python')).toBeUndefined()
    expect(model.pins).toEqual([{ file: join('src', 'main.cpp'), line: 1, pin: '13', role: 'pinMode', mode: 'OUTPUT' }])
  })

  it('reports no boards when there is no platformio.ini, rather than guessing one', async () => {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'main.cpp'), '#include <Arduino.h>\nvoid setup() {}\nvoid loop() {}\n', 'utf8')

    const model = await buildProjectModel(root)
    expect(model.boards).toEqual([])
  })

  it('returns an empty, well-formed model for an empty workspace', async () => {
    const model = await buildProjectModel(root)
    expect(model).toEqual({
      languages: [],
      boards: [],
      pins: [],
      pinsTruncated: false,
      toolchains: model.toolchains // shape-only, see above
    })
  })
})
