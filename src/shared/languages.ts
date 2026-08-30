import type { LanguageId } from './ipc'

export interface LanguageDef {
  id: LanguageId
  label: string
  /** Monaco language id */
  monaco: string
  extensions: string[]
  /** Category shown in the multi-language project view */
  category: 'embedded' | 'scripting' | 'systems' | 'web' | 'other'
  runnable: boolean
  /** Cortex can start a source debugger for this language (host gdb). */
  debuggable: boolean
  color: string
}

export const LANGUAGES: LanguageDef[] = [
  { id: 'cpp', label: 'C++', monaco: 'cpp', extensions: ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h', '.ino'], category: 'embedded', runnable: true, debuggable: true, color: '#f34b7d' },
  { id: 'c', label: 'C', monaco: 'c', extensions: ['.c'], category: 'embedded', runnable: true, debuggable: true, color: '#555555' },
  { id: 'python', label: 'Python', monaco: 'python', extensions: ['.py', '.pyw'], category: 'scripting', runnable: true, debuggable: false, color: '#3572A5' },
  { id: 'rust', label: 'Rust', monaco: 'rust', extensions: ['.rs'], category: 'systems', runnable: true, debuggable: false, color: '#dea584' },
  // .zon is Zig's object-notation manifest (build.zig.zon); the Monaco grammar
  // claims it, so the table must too or it opens as plaintext.
  { id: 'zig', label: 'Zig', monaco: 'zig', extensions: ['.zig', '.zon'], category: 'systems', runnable: false, debuggable: false, color: '#ec915c' },
  { id: 'lua', label: 'Lua', monaco: 'lua', extensions: ['.lua'], category: 'scripting', runnable: false, debuggable: false, color: '#000080' },
  { id: 'typescript', label: 'TypeScript', monaco: 'typescript', extensions: ['.ts', '.tsx'], category: 'web', runnable: false, debuggable: false, color: '#3178c6' },
  { id: 'javascript', label: 'JavaScript', monaco: 'javascript', extensions: ['.js', '.jsx', '.mjs', '.cjs'], category: 'web', runnable: true, debuggable: false, color: '#f1e05a' },
  // Ancillary project files. Not runnable, but an embedded repo is full of them
  // and they used to open as flat plaintext.
  { id: 'markdown', label: 'Markdown', monaco: 'markdown', extensions: ['.md', '.markdown'], category: 'other', runnable: false, debuggable: false, color: '#6FB65A' },
  { id: 'yaml', label: 'YAML', monaco: 'yaml', extensions: ['.yml', '.yaml'], category: 'other', runnable: false, debuggable: false, color: '#cb171e' },
  { id: 'json', label: 'JSON', monaco: 'json', extensions: ['.json'], category: 'other', runnable: false, debuggable: false, color: '#8FBF6B' },
  { id: 'ini', label: 'INI', monaco: 'ini', extensions: ['.ini', '.cfg', '.conf', '.properties'], category: 'other', runnable: false, debuggable: false, color: '#9da0a8' },
  { id: 'xml', label: 'XML', monaco: 'xml', extensions: ['.xml', '.svg', '.plist'], category: 'other', runnable: false, debuggable: false, color: '#e37933' },
  { id: 'shell', label: 'Shell', monaco: 'shell', extensions: ['.sh', '.bash', '.zsh'], category: 'other', runnable: false, debuggable: false, color: '#89e051' }
]

/**
 * C++ driver -> its C counterpart, and back. Cortex keeps ONE `compiler`
 * setting across languages, so the canonical value is the C++ driver and the C
 * one is derived: storing 'gcc' directly would then be used to build C++ too.
 * g++ silently compiling a .c file as C++ rejects valid C (void* conversions).
 */
export const C_DRIVER: Record<string, string> = { 'g++': 'gcc', 'clang++': 'clang' }
export const CPP_DRIVER: Record<string, string> = { gcc: 'g++', clang: 'clang++' }

/**
 * Swap the driver token in a compiler command, preserving everything around it.
 *
 * A plain table lookup only ever matched the four bare host names, and every
 * other legal form of the setting silently fell through unmapped - which meant
 * building C with a C++ driver, the exact failure the mapping exists to stop.
 * Three forms have to work:
 *   - a target prefix:  avr-g++        -> avr-gcc  (not host gcc)
 *   - a Windows suffix: g++.exe        -> gcc.exe  (isAllowedCommand accepts it)
 *   - an absolute path: C:/msys64/mingw64/bin/g++.exe (what app settings hold)
 * The prefix must be empty or end in '-', so `mygcc++` and `gccalike` are left
 * alone: only a whole driver segment is swapped.
 */
function swapDriver(cmd: string, table: Record<string, string>): string {
  const sep = Math.max(cmd.lastIndexOf('/'), cmd.lastIndexOf('\\'))
  const dir = cmd.slice(0, sep + 1)
  const base = cmd.slice(sep + 1)
  const ext = base.match(/\.(exe|cmd|bat|com)$/i)?.[0] ?? ''
  const stem = ext ? base.slice(0, -ext.length) : base
  const m = stem.match(/^(|.*-)(g\+\+|clang\+\+|gcc|clang)$/i)
  const mapped = m && table[m[2].toLowerCase()]
  return mapped ? dir + m![1] + mapped + ext : cmd
}

/** C++ driver -> its C counterpart. Idempotent: a C driver is returned as-is. */
export function cDriver(cmd: string): string {
  return swapDriver(cmd, { 'g++': 'gcc', 'clang++': 'clang' })
}

/** C driver -> its C++ counterpart. Idempotent the same way. */
export function cppDriver(cmd: string): string {
  return swapDriver(cmd, { gcc: 'g++', clang: 'clang++' })
}

const HEADER_EXT = new Set(['.h', '.hpp', '.hh', '.hxx', '.h++'])

/**
 * A header is not a translation unit. `g++ util.hpp -o util.exe` exits 0 and
 * writes a precompiled header, which then fails to execute - so Run and Debug
 * must refuse headers even though they share the C++ language entry.
 */
export function isHeaderPath(p: string): boolean {
  const lower = p.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot >= 0 && HEADER_EXT.has(lower.slice(dot))
}

const EXT_MAP: Record<string, LanguageDef> = {}
for (const def of LANGUAGES) {
  for (const ext of def.extensions) EXT_MAP[ext] = def
}

export function langFromPath(filePath: string): LanguageDef {
  const lower = filePath.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot) : ''
  return EXT_MAP[ext] ?? {
    id: 'plaintext',
    label: 'Text',
    monaco: 'plaintext',
    extensions: [],
    category: 'other',
    runnable: false,
    debuggable: false,
    color: '#9da0a8'
  }
}

export function iconForFile(filePath: string): string {
  return langFromPath(filePath).id
}
