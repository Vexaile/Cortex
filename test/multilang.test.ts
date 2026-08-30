import { describe, it, expect } from 'vitest'
import { langFromPath, isHeaderPath, LANGUAGES, C_DRIVER, CPP_DRIVER, cDriver, cppDriver } from '../src/shared/languages'
import { langForFile, CPP_EXT } from '../src/shared/lsp'
import { parseDiagnostics } from '../src/shared/diagnostics'

/**
 * Multi-language wiring. Each of these locks in a gap that shipped broken:
 * languages.ts, lsp.ts and clangdConfig.ts each kept their own extension list
 * and they had drifted apart, so files got a language badge with no server, or
 * a server with no highlighting.
 */

describe('isHeaderPath', () => {
  it('recognises every C/C++ header extension', () => {
    for (const p of ['a.h', 'a.hpp', 'a.hh', 'a.hxx', 'a.h++', 'C:/x/Util.HPP']) {
      expect(isHeaderPath(p), p).toBe(true)
    }
  })
  it('does not treat a translation unit as a header', () => {
    for (const p of ['a.c', 'a.cpp', 'a.cc', 'a.cxx', 'a.c++', 'a.ino', 'a.py', 'noext']) {
      expect(isHeaderPath(p), p).toBe(false)
    }
  })
})

describe('language table', () => {
  it('marks only C and C++ debuggable (host gdb)', () => {
    const debuggable = LANGUAGES.filter((l) => l.debuggable).map((l) => l.id).sort()
    expect(debuggable).toEqual(['c', 'cpp'])
  })

  it('gives every language a real Monaco grammar, not plaintext', () => {
    // Zig used to be monaco:'plaintext', which rendered flat grey text while the
    // status bar still claimed "Zig".
    for (const l of LANGUAGES) {
      expect(l.monaco, l.id).not.toBe('plaintext')
    }
  })

  it('resolves the C++ extensions that clangd claims', () => {
    for (const ext of ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h']) {
      expect(langFromPath('x' + ext).id, ext).toBe('cpp')
    }
    expect(langFromPath('x.c').id).toBe('c')
  })
})

describe('LSP extension coverage matches the language table', () => {
  it('every extension clangd serves is a C or C++ file to the editor', () => {
    // Anti-drift: .hxx/.c++ were in CPP_EXT but missing from languages.ts, so
    // they opened as "Text" with clangd squiggles painted on top.
    for (const ext of CPP_EXT) {
      const id = langFromPath('file' + ext).id
      expect(['c', 'cpp'], `${ext} resolved to ${id}`).toContain(id)
    }
  })

  it('routes both Python extensions to Pyright', () => {
    expect(langForFile('a.py')).toBe('python')
    expect(langForFile('a.pyw')).toBe('python')
  })

  it('still excludes .ino deliberately (clangd cannot find the Arduino core)', () => {
    expect(langForFile('sketch.ino')).toBeNull()
  })
})

describe('parseDiagnostics: rustc', () => {
  const RUSTC = [
    'error[E0425]: cannot find value `x` in this scope',
    ' --> src/main.rs:2:5',
    '  |',
    '2 |     x + 1;',
    '  |     ^ not found in this scope',
    '',
    'warning: unused variable: `y`',
    ' --> src/main.rs:7:9',
    '',
    'error: aborting due to previous error'
  ].join('\n')

  it('parses the two-line rustc form into line/column diagnostics', () => {
    const d = parseDiagnostics(RUSTC)
    expect(d).toHaveLength(2)
    expect(d[0]).toMatchObject({
      file: 'src/main.rs',
      line: 2,
      column: 5,
      severity: 'error',
      code: 'E0425',
      message: 'cannot find value `x` in this scope'
    })
    expect(d[1]).toMatchObject({ file: 'src/main.rs', line: 7, column: 9, severity: 'warning' })
  })

  it('ignores a trailing summary line that has no location', () => {
    expect(parseDiagnostics(RUSTC).some((x) => x.message.includes('aborting'))).toBe(false)
  })

  it('leaves gcc/clang parsing untouched', () => {
    const gcc = "main.cpp:10:52: error: 'x' is not a member of 'std'"
    const d = parseDiagnostics(gcc)
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ file: 'main.cpp', line: 10, column: 52, severity: 'error' })
  })
})

describe('C is built as C, not C++', () => {
  it('maps each C++ driver to its C counterpart and back', () => {
    // One `compiler` setting is shared across languages, so the canonical value
    // is the C++ driver and the C one is derived. g++ silently compiling .c as
    // C++ rejects valid C (void* conversions).
    expect(C_DRIVER['g++']).toBe('gcc')
    expect(C_DRIVER['clang++']).toBe('clang')
    expect(CPP_DRIVER['gcc']).toBe('g++')
    expect(CPP_DRIVER['clang']).toBe('clang++')
  })

  it('maps a prefixed cross-compiler too, keeping its target prefix', () => {
    // avr-g++ is exactly as unable to build C as g++ is. A table lookup missed
    // it and fell back to compiling C as C++.
    expect(cDriver('avr-g++')).toBe('avr-gcc')
    expect(cDriver('arm-none-eabi-g++')).toBe('arm-none-eabi-gcc')
    expect(cppDriver('avr-gcc')).toBe('avr-g++')
    expect(cDriver('arm-none-eabi-clang++')).toBe('arm-none-eabi-clang')
  })

  it('leaves a command with no C/C++ driver suffix alone', () => {
    expect(cDriver('zig')).toBe('zig')
    expect(cppDriver('rustc')).toBe('rustc')
    // Substrings must not match: only a whole final driver segment counts.
    expect(cppDriver('gccalike')).toBe('gccalike')
    expect(cDriver('mygcc++')).toBe('mygcc++')
  })

  it('agrees with the plain tables for the host drivers', () => {
    expect(cDriver('g++')).toBe(C_DRIVER['g++'])
    expect(cppDriver('clang')).toBe(CPP_DRIVER['clang'])
  })
})
