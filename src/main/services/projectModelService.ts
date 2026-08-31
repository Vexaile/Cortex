import { promises as fs } from 'fs'
import { join, extname } from 'path'
import { listAllFiles } from './fsService'
import { detectToolchains } from './toolchainService'
import { LANGUAGES, langFromPath } from '../../shared/languages'
import type { ProjectModel, LanguageBreakdown, BoardInfo, PinUsage, PinRole, BusUsage, LibraryUsage } from '../../shared/ipc'

/**
 * A derived, read-only picture of what a workspace actually is, built by
 * inspecting the project rather than asking the user to describe it: what
 * languages it's written in, what board/platform it targets (only when a real
 * config file says so - never a guess), which GPIO pins the source code
 * touches, which buses (I2C/SPI/UART) it opens, and which headers it
 * includes. This is the raw material src/shared/hardwareGraph.ts turns into a
 * queryable graph. See docs/PROJECT-MODEL.md.
 */

const SOURCE_EXTS = new Set(['.c', '.cc', '.cpp', '.cxx', '.c++', '.h', '.hpp', '.hh', '.hxx', '.ino'])
// fsService's own IGNORE list (node_modules/.git/out/dist/release/.cortex)
// deliberately does NOT include these - the Explorer still browses them, that's
// a real, separate decision. But counting a vendored library's bundled source
// as part of THIS project's language mix, or its example sketches' pinMode
// calls as THIS project's GPIO usage, isn't a project model, it's noise: a
// PlatformIO project's .pio/libdeps alone can outnumber the actual firmware
// by 10x. Segment match, not substring (see startWatch's own ignore for why:
// a substring test on "dist" silently unwatched any file whose path merely
// contained those four letters).
const VENDORED_DIRS = new Set(['.pio', 'build', '.vscode'])
function isVendored(path: string): boolean {
  return path.split(/[\\/]/).some((seg) => VENDORED_DIRS.has(seg))
}

const MAX_SCAN_FILES = 400
const MAX_PIN_ENTRIES = 200
const MAX_BUS_ENTRIES = 200
const MAX_LIBRARY_ENTRIES = 300
// A hand-written firmware file bigger than this is unusual enough that it's
// more likely a vendored/generated blob (an HAL, a bundled library) than
// something worth pin-scanning - skip it rather than spend the read on it.
const MAX_FILE_BYTES = 512 * 1024

/**
 * Minimal platformio.ini reader: just enough to pull board/platform/framework
 * out of each [env:NAME] section. Real INI supports more (multi-line values,
 * interpolation, extends/includes) that this deliberately doesn't handle -
 * PlatformIO projects rarely need that for these three keys, and reporting
 * nothing for a line this can't parse is safer than a wrong guess.
 */
export function parsePlatformioIni(text: string): BoardInfo[] {
  const boards: BoardInfo[] = []
  let currentEnv: string | null = null
  let board: string | undefined
  let platform: string | undefined
  let framework: string | undefined
  const flush = (): void => {
    if (currentEnv && board) boards.push({ name: board, platform, framework, source: 'platformio.ini', env: currentEnv })
    board = platform = framework = undefined
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split(';')[0].trim() // strip ini comments
    if (!line) continue
    const section = line.match(/^\[env:([^\]]+)\]$/)
    if (section) {
      flush()
      currentEnv = section[1]
      continue
    }
    if (line.startsWith('[')) {
      flush()
      currentEnv = null
      continue
    }
    if (!currentEnv) continue
    const kv = line.match(/^([A-Za-z_]+)\s*=\s*(.+)$/)
    if (!kv) continue
    const [, key, value] = kv
    if (key === 'board') board = value.trim()
    else if (key === 'platform') platform = value.trim()
    else if (key === 'framework') framework = value.trim()
  }
  flush()
  return boards
}

const PIN_PATTERNS: Array<{ role: PinRole; re: RegExp }> = [
  { role: 'pinMode', re: /\bpinMode\s*\(\s*([A-Za-z0-9_]+)\s*,\s*([A-Za-z0-9_]+)\s*\)/g },
  { role: 'digitalWrite', re: /\bdigitalWrite\s*\(\s*([A-Za-z0-9_]+)/g },
  { role: 'digitalRead', re: /\bdigitalRead\s*\(\s*([A-Za-z0-9_]+)/g },
  { role: 'analogWrite', re: /\banalogWrite\s*\(\s*([A-Za-z0-9_]+)/g },
  { role: 'analogRead', re: /\banalogRead\s*\(\s*([A-Za-z0-9_]+)/g }
]

/** Split once per file; every scanner shares the array instead of re-splitting. */
const toLines = (text: string | string[]): string[] => (Array.isArray(text) ? text : text.split(/\r?\n/))

/**
 * Blank out double-quoted string bodies and drop // comments so dead code
 * can't fabricate hardware ("// Wire.beginTransmission(0x27);" would
 * otherwise put a phantom device address on the bus and poison the graph's
 * inference notes). Line-based on purpose: block comments and raw strings
 * spanning lines are out of scope for this scan, same as everywhere else here.
 */
export function stripLineNoise(line: string): string {
  return line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\/\/.*$/, '')
}

export function scanPins(relPath: string, text: string | string[], out: PinUsage[], cap: number): void {
  const lines = toLines(text)
  for (let i = 0; i < lines.length && out.length < cap; i++) {
    const line = stripLineNoise(lines[i])
    for (const { role, re } of PIN_PATTERNS) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(line))) {
        if (out.length >= cap) break
        const entry: PinUsage = { file: relPath, line: i + 1, pin: m[1], role }
        if (role === 'pinMode' && m[2]) entry.mode = m[2]
        out.push(entry)
      }
    }
  }
}

// Arduino-core bus APIs: TwoWire (Wire/Wire1 - a second I2C bus exists on
// ESP32/Teensy/etc.), SPIClass (the global SPI object), HardwareSerial
// (Serial/Serial1/Serial2/...). Deliberately does NOT try to resolve which
// physical pins a bus rides on (that's per-board wiring the source text
// doesn't state) or guess which UART is the USB monitor (that varies by
// board and even by build flags - ESP32-S3's Serial can be the native USB
// CDC or UART0 depending on ARDUINO_USB_CDC_ON_BOOT - and the call site
// alone doesn't say).
const HEX_OR_DEC = /^(0x[0-9a-fA-F]+|\d+)$/
const I2C_RE = /\b(Wire\d*)\.(begin|beginTransmission|requestFrom)\s*\(\s*([^,)]*)/g
const SPI_RE = /\b(SPI\d*)\.(begin|beginTransaction|transfer|transfer16)\s*\(/g
// Baud captured like I2C's address: the usage is always recorded, the number
// only when it's a literal. Folding (\d+) into the match itself silently
// dropped every Serial1.begin(GPS_BAUD) - the UART vanished from the model.
const UART_RE = /\b(Serial\d*)\.begin\s*\(\s*([^,)]*)/g

export function scanBuses(relPath: string, text: string | string[], out: BusUsage[], cap: number): void {
  const lines = toLines(text)
  for (let i = 0; i < lines.length && out.length < cap; i++) {
    const line = stripLineNoise(lines[i])

    I2C_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = I2C_RE.exec(line))) {
      if (out.length >= cap) break
      const [, instance, role, arg] = m
      const entry: BusUsage = { file: relPath, line: i + 1, bus: 'i2c', instance, role }
      // begin()'s optional first arg is a slave address on AVR but SDA on
      // ESP32's begin(sda, scl) overload - ambiguous from source text alone,
      // so only beginTransmission/requestFrom (always address-first) get one.
      if ((role === 'beginTransmission' || role === 'requestFrom') && HEX_OR_DEC.test(arg.trim())) {
        entry.address = arg.trim()
      }
      out.push(entry)
    }

    if (out.length < cap) {
      SPI_RE.lastIndex = 0
      while ((m = SPI_RE.exec(line))) {
        if (out.length >= cap) break
        out.push({ file: relPath, line: i + 1, bus: 'spi', instance: m[1], role: m[2] })
      }
    }

    if (out.length < cap) {
      UART_RE.lastIndex = 0
      while ((m = UART_RE.exec(line))) {
        if (out.length >= cap) break
        const entry: BusUsage = { file: relPath, line: i + 1, bus: 'uart', instance: m[1], role: 'begin' }
        if (/^\d+$/.test(m[2].trim())) entry.baud = Number(m[2].trim())
        out.push(entry)
      }
    }
  }
}

// `#  include` (whitespace between # and the directive) is legal preprocessor
// syntax, and some formatters indent nested-conditional includes exactly that way.
const INCLUDE_RE = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/

export function scanIncludes(relPath: string, text: string | string[], out: LibraryUsage[], cap: number): void {
  const lines = toLines(text)
  for (let i = 0; i < lines.length && out.length < cap; i++) {
    const m = INCLUDE_RE.exec(lines[i])
    if (m) out.push({ file: relPath, line: i + 1, header: m[1] })
  }
}

export async function buildProjectModel(workspaceRoot: string): Promise<ProjectModel> {
  const allFiles = await listAllFiles(workspaceRoot)

  // Language breakdown: every file the Explorer already treats as "a
  // language" via shared/languages.ts, not just source files.
  const counts = new Map<string, number>()
  for (const f of allFiles) {
    if (isVendored(f)) continue
    const lang = langFromPath(f)
    if (lang.id === 'plaintext') continue
    counts.set(lang.id, (counts.get(lang.id) ?? 0) + 1)
  }
  const languages: LanguageBreakdown[] = LANGUAGES.filter((l) => counts.has(l.id))
    .map((l) => ({ id: l.id, label: l.label, fileCount: counts.get(l.id) ?? 0 }))
    .sort((a, b) => b.fileCount - a.fileCount)

  // Board/platform: only from a real platformio.ini. Deliberately no
  // .ino/#include heuristic guess here - a wrong board guess is worse than
  // Cortex honestly not knowing.
  let boards: BoardInfo[] = []
  try {
    const ini = await fs.readFile(join(workspaceRoot, 'platformio.ini'), 'utf8')
    boards = parsePlatformioIni(ini)
  } catch {
    /* no platformio.ini - plenty of embedded projects don't use PlatformIO */
  }

  // GPIO usage: a bounded scan of source files. This runs once on workspace
  // open (see the IPC handler), not per keystroke. Regex over a real compile
  // database would be more precise, but there is no compile database to drive
  // one here; this is a real signal read from the actual source, just not an
  // exhaustive one, and pinsTruncated says so rather than implying completeness.
  const allSourceFiles = allFiles.filter((f) => !isVendored(f) && SOURCE_EXTS.has(extname(f).toLowerCase()))
  const sourceFiles = allSourceFiles.slice(0, MAX_SCAN_FILES)
  const pins: PinUsage[] = []
  const buses: BusUsage[] = []
  const libraries: LibraryUsage[] = []
  for (const file of sourceFiles) {
    if (pins.length >= MAX_PIN_ENTRIES && buses.length >= MAX_BUS_ENTRIES && libraries.length >= MAX_LIBRARY_ENTRIES) break
    try {
      const stat = await fs.stat(file)
      if (stat.size > MAX_FILE_BYTES) continue
      // One read, one split, three scans over the shared line array.
      const lines = toLines(await fs.readFile(file, 'utf8'))
      const rel = file.startsWith(workspaceRoot) ? file.slice(workspaceRoot.length).replace(/^[\\/]/, '') : file
      scanPins(rel, lines, pins, MAX_PIN_ENTRIES)
      scanBuses(rel, lines, buses, MAX_BUS_ENTRIES)
      scanIncludes(rel, lines, libraries, MAX_LIBRARY_ENTRIES)
    } catch {
      /* unreadable file: skip it, not fatal to the whole model */
    }
  }

  const toolchains = (await detectToolchains()).filter((t) => t.available)
  const scanTruncated = sourceFiles.length < allSourceFiles.length

  return {
    languages,
    boards,
    toolchains,
    pins,
    pinsTruncated: scanTruncated || pins.length >= MAX_PIN_ENTRIES,
    buses,
    busesTruncated: scanTruncated || buses.length >= MAX_BUS_ENTRIES,
    libraries,
    librariesTruncated: scanTruncated || libraries.length >= MAX_LIBRARY_ENTRIES
  }
}
