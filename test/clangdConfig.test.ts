import { describe, it, expect } from 'vitest'
import { parseDriverOutput, buildClangdConfig, MARKER } from '../src/main/services/clangdConfig'

// A trimmed but representative `g++ -E -xc++ -v -` report (MSYS2 MinGW), with the
// CRLF line endings the driver emits on Windows.
const GXX_V = [
  'Using built-in specs.',
  'Target: x86_64-w64-mingw32',
  'Thread model: posix',
  'ignoring nonexistent directory "D:/a/msys64/mingw64/include"',
  '#include "..." search starts here:',
  '#include <...> search starts here:',
  ' C:/msys64/mingw64/include/c++/14.2.0',
  ' C:/msys64/mingw64/include/c++/14.2.0/x86_64-w64-mingw32',
  ' C:/msys64/mingw64/lib/gcc/x86_64-w64-mingw32/14.2.0/include',
  'End of search list.',
  'COMPILER_PATH=...'
].join('\r\n')

describe('parseDriverOutput', () => {
  it('extracts the target triple', () => {
    expect(parseDriverOutput(GXX_V).target).toBe('x86_64-w64-mingw32')
  })

  it('extracts every system include directory, trimmed', () => {
    expect(parseDriverOutput(GXX_V).includes).toEqual([
      'C:/msys64/mingw64/include/c++/14.2.0',
      'C:/msys64/mingw64/include/c++/14.2.0/x86_64-w64-mingw32',
      'C:/msys64/mingw64/lib/gcc/x86_64-w64-mingw32/14.2.0/include'
    ])
  })

  it('does not include the quoted-search or ignored-directory lines', () => {
    const inc = parseDriverOutput(GXX_V).includes
    expect(inc.some((d) => d.includes('nonexistent'))).toBe(false)
    expect(inc.some((d) => d.includes('search starts here'))).toBe(false)
  })

  it('returns empty when the report has no search block', () => {
    expect(parseDriverOutput('clang version 22\nTarget: none')).toEqual({ target: 'none', includes: [] })
  })

  it('handles LF-only output as well as CRLF', () => {
    expect(parseDriverOutput(GXX_V.replace(/\r\n/g, '\n')).includes).toHaveLength(3)
  })

  it('drops Apple Clang framework-directory lines (not valid -isystem paths)', () => {
    const appleClang = [
      'Target: arm64-apple-darwin23',
      '#include <...> search starts here:',
      ' /usr/local/include',
      ' /Library/Developer/CommandLineTools/usr/include/c++/v1',
      ' /System/Library/Frameworks (framework directory)',
      'End of search list.'
    ].join('\n')
    const inc = parseDriverOutput(appleClang).includes
    expect(inc).toEqual(['/usr/local/include', '/Library/Developer/CommandLineTools/usr/include/c++/v1'])
    expect(inc.some((d) => d.includes('framework directory'))).toBe(false)
  })
})

describe('buildClangdConfig', () => {
  const tc = { target: 'x86_64-w64-mingw32', includes: ['C:/a/inc', 'C:/b/inc'] }
  const cfg = buildClangdConfig(tc, 'c++23')

  it('starts with the Cortex marker so the writer can recognise its own file', () => {
    expect(cfg.startsWith(MARKER)).toBe(true)
  })

  it('adds the target and each include dir as -isystem to the global flags', () => {
    expect(cfg).toContain('"--target=x86_64-w64-mingw32"')
    expect(cfg).toContain('"-isystem"')
    expect(cfg).toContain('"C:/a/inc"')
    expect(cfg).toContain('"C:/b/inc"')
  })

  it('scopes the C++ standard to C++ extensions and keeps it off .c files', () => {
    const frags = cfg.split('\n---\n')
    const cppFrag = frags.find((f) => f.includes('cpp|cxx'))
    const cFrag = frags.find((f) => /PathMatch: \[".*\\\\\.c"\]/.test(f))
    // The C++ fragment carries -std=c++23 (a hard error on a C file); the .c
    // fragment carries -std=c17, and the two never mix.
    expect(cppFrag).toBeDefined()
    expect(cppFrag).toContain('"-std=c++23"')
    expect(cppFrag).not.toContain('c17')
    expect(cFrag).toBeDefined()
    expect(cFrag).toContain('"-std=c17"')
    expect(cFrag).not.toContain('c++23')
  })

  it('uses the project C standard, not a hardcoded c17', () => {
    // Pinning c17 meant clangd flagged code the build accepts (and vice versa)
    // on any project whose toolbar C standard was not c17.
    const c99 = buildClangdConfig(tc, 'c++20', 'c99')
    const frags = c99.split('\n---\n')
    const cFrag = frags.find((f) => /PathMatch: \[".*\\\\\.c"\]/.test(f))
    expect(cFrag).toContain('"-std=c99"')
    expect(cFrag).not.toContain('c17')
    expect(frags.find((f) => f.includes('cpp|cxx'))).toContain('"-std=c++20"')
  })

  it('matches a literal .c++ file and drops the dead ipp/tpp/ino entries', () => {
    const cppFrag = cfg.split('\n---\n').find((f) => f.includes('cpp|cxx'))
    // c[+][+] matches ".c++" (a GNU C++ extension langForFile routes to clangd).
    expect(cppFrag).toContain('c[+][+]')
    // These were never routed to clangd by langForFile, so they must not appear.
    expect(cppFrag).not.toContain('ipp')
    expect(cppFrag).not.toContain('tpp')
    expect(cppFrag).not.toContain('ino')
  })

  it('marks the file machine-specific so it is not committed', () => {
    expect(cfg).toContain('do not commit')
  })

  it('never emits an em dash, en dash, or ellipsis (house style)', () => {
    // Built from code points so this file itself stays free of the characters
    // the house-style test forbids (en dash, em dash, ellipsis).
    const forbidden = new RegExp('[' + String.fromCharCode(0x2013, 0x2014, 0x2026) + ']')
    expect(forbidden.test(cfg)).toBe(false)
  })
})
