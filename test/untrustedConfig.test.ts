import { describe, it, expect } from 'vitest'
import { sanitizeExtraArgs, isAllowedExtraArg, OPT_LEVELS, isHostCpp } from '../src/shared/security'
import { cDriver, cppDriver } from '../src/shared/languages'

/**
 * <workspace>/.cortex/config.json travels with a cloned repo, and everything in
 * it lands on a compiler command line. These are the vectors that made pressing
 * Run on someone else's project a code-execution primitive.
 */

describe('extraArgs from an untrusted project config', () => {
  it('rejects the compiler flags that are really code execution', () => {
    // Each of these makes gcc load or run something the repo supplies, before a
    // single line of the reviewed source is compiled.
    expect(isAllowedExtraArg('-fplugin=./payload.so')).toBe(false)
    expect(isAllowedExtraArg('-specs=./evil.specs')).toBe(false)
    expect(isAllowedExtraArg('-B.')).toBe(false)
    expect(isAllowedExtraArg('-B./bin')).toBe(false)
    expect(isAllowedExtraArg('@moreflags')).toBe(false)
    expect(isAllowedExtraArg('-fuse-ld=./ld')).toBe(false)
    expect(isAllowedExtraArg('-wrapper')).toBe(false)
  })

  it('rejects a second -o, which would beat the workspace-confined output path', () => {
    // GCC takes the LAST -o, so this used to place the built executable
    // anywhere on disk (Startup, say) from an ordinary Run.
    expect(isAllowedExtraArg('-o')).toBe(false)
    expect(isAllowedExtraArg('--output=x.exe')).toBe(false)
  })

  it('rejects a bare filename, which would add a translation unit to the build', () => {
    expect(isAllowedExtraArg('extra.cpp')).toBe(false)
    expect(isAllowedExtraArg('../../etc/passwd')).toBe(false)
    expect(isAllowedExtraArg('')).toBe(false)
  })

  it('rejects linker passthrough while keeping ordinary warning flags', () => {
    expect(isAllowedExtraArg('-Wl,--script=./evil.ld')).toBe(false)
    expect(isAllowedExtraArg('-Wextra')).toBe(true)
    expect(isAllowedExtraArg('-Wno-unused')).toBe(true)
  })

  it('keeps the flags that actually describe this translation unit', () => {
    for (const ok of ['-DDEBUG=1', '-UNDEBUG', '-Iinclude', '-I./vendor/inc', '-Llib', '-lm', '-pthread', '-march=native', '-fno-exceptions']) {
      expect(isAllowedExtraArg(ok)).toBe(true)
    }
  })

  it('partitions rather than silently dropping, so the user can be told', () => {
    const { kept, dropped } = sanitizeExtraArgs(['-Iinclude', '-fplugin=./x.so', '-DX=1', '-o', 'evil.exe'])
    expect(kept).toEqual(['-Iinclude', '-DX=1'])
    expect(dropped).toEqual(['-fplugin=./x.so', '-o', 'evil.exe'])
  })

  it('survives a config that is not an array of strings at all', () => {
    expect(sanitizeExtraArgs(undefined)).toEqual({ kept: [], dropped: [] })
    expect(sanitizeExtraArgs('-Iinclude')).toEqual({ kept: [], dropped: [] })
    expect(sanitizeExtraArgs([1, null]).kept).toEqual([])
  })
})

describe('optimization from an untrusted project config', () => {
  it('only admits real optimization levels', () => {
    // The level is pushed as its own argv token, so this was a second,
    // independent instance of the -fplugin primitive.
    expect(OPT_LEVELS).toContain('-O2')
    expect(OPT_LEVELS).not.toContain('-fplugin=./payload.so')
    expect(OPT_LEVELS.includes('-specs=./evil')).toBe(false)
  })
})

describe('compiler from an untrusted project config', () => {
  it('normalizes a C driver up to its C++ counterpart', () => {
    // The stored value is canonically the C++ driver; storing 'gcc' would leak
    // into C++ builds, where it cannot link libstdc++.
    expect(cppDriver('gcc')).toBe('g++')
    expect(isHostCpp(cppDriver('gcc'))).toBe(true)
  })

  it('refuses a cross compiler as the host compiler', () => {
    // It builds firmware for a chip: exec'ing it here, or handing it to host
    // gdb, cannot work.
    expect(isHostCpp(cppDriver('arm-none-eabi-gcc'))).toBe(false)
    expect(isHostCpp('avr-g++')).toBe(false)
  })
})

describe('driver mapping across every legal command form', () => {
  it('maps a Windows .exe suffix, which isAllowedCommand accepts', () => {
    // A repo may legally pin {"compiler":"g++.exe"}: bare and allowlisted. The
    // old end-anchored regex no-oped on it and built C with a C++ driver.
    expect(cDriver('g++.exe')).toBe('gcc.exe')
    expect(cDriver('clang++.exe')).toBe('clang.exe')
    expect(cppDriver('gcc.exe')).toBe('g++.exe')
  })

  it('maps an absolute path, the form app settings are meant to hold', () => {
    expect(cDriver('C:/msys64/mingw64/bin/g++.exe')).toBe('C:/msys64/mingw64/bin/gcc.exe')
    expect(cDriver('/usr/bin/clang++')).toBe('/usr/bin/clang')
    expect(cDriver('C:\\msys64\\mingw64\\bin\\g++.exe')).toBe('C:\\msys64\\mingw64\\bin\\gcc.exe')
  })

  it('keeps a cross toolchain prefix instead of collapsing to the host driver', () => {
    expect(cDriver('avr-g++')).toBe('avr-gcc')
    expect(cDriver('arm-none-eabi-g++.exe')).toBe('arm-none-eabi-gcc.exe')
    expect(cppDriver('/opt/tools/arm-none-eabi-gcc')).toBe('/opt/tools/arm-none-eabi-g++')
  })

  it('is idempotent, so a stored value cannot drift by being mapped twice', () => {
    expect(cDriver(cDriver('g++'))).toBe('gcc')
    expect(cppDriver(cppDriver('gcc'))).toBe('g++')
  })

  it('leaves anything that is not a whole driver segment alone', () => {
    expect(cDriver('mygcc++')).toBe('mygcc++')
    expect(cppDriver('gccalike')).toBe('gccalike')
    expect(cppDriver('rustc')).toBe('rustc')
    expect(cDriver('zig')).toBe('zig')
  })
})

describe('flags the prefix allowlist used to let through', () => {
  it('rejects the other dlopen-into-the-compiler spellings', () => {
    // -fplugin was blocked by name; clang's -fpass-plugin is the identical
    // primitive and walked straight through a /^-f(?!plugin)./ rule.
    expect(isAllowedExtraArg('-fpass-plugin=./payload.so')).toBe(false)
    expect(isAllowedExtraArg('-fplugin-arg-x=y')).toBe(false)
  })

  it('rejects the -f family that writes files to arbitrary paths', () => {
    for (const bad of [
      '-fdump-final-insns=C:/Users/me/Startup/x.txt',
      '-ftime-trace=C:/tmp/t.json',
      '-foptimization-record-file=/tmp/o',
      '-fprofile-generate=/tmp/p',
      '-fmodules-cache-path=/tmp/m'
    ]) {
      expect(isAllowedExtraArg(bad), bad).toBe(false)
    }
  })

  it('rejects assembler passthrough, not just linker passthrough', () => {
    expect(isAllowedExtraArg('-Wa,--MD,/tmp/out')).toBe(false)
    expect(isAllowedExtraArg('-Wl,--script=./evil.ld')).toBe(false)
  })

  it('closes the two-token smuggle: -mllvm takes its value from the NEXT token', () => {
    // Both tokens individually matched the old per-token prefixes (-m., -l.),
    // so the pair survived and loaded a shared object into LLVM.
    const { kept, dropped } = sanitizeExtraArgs(['-mllvm', '-load=./pwn.so'])
    expect(kept).toEqual([])
    expect(dropped).toEqual(['-mllvm', '-load=./pwn.so'])
  })

  it('refuses include and library paths that reach off this machine', () => {
    // On Windows the driver stat()s every -I dir, so a UNC path makes the SMB
    // client connect out and authenticate to whoever the repo names.
    // Built from char codes: a literal backslash run in a test file is exactly
    // the thing that keeps getting mangled in transit.
    const bs = String.fromCharCode(92)
    expect(isAllowedExtraArg('-I' + bs + bs + 'evil.example.com' + bs + 'share')).toBe(false)
    expect(isAllowedExtraArg('-I//evil.example.com/share')).toBe(false)
    expect(sanitizeExtraArgs(['-I', '//evil.example.com/share']).kept).toEqual([])
    // A single leading separator is a local path, not a UNC path.
    expect(isAllowedExtraArg('-I' + bs + 'local' + bs + 'inc')).toBe(true)
  })
})

describe('separated flag spellings gcc has always accepted', () => {
  it('keeps -I dir, -D name and -L dir as pairs', () => {
    // The per-token rule required a character after the letter, so these were
    // rejected AND reported as build-redirect attacks, which was simply wrong.
    const { kept, dropped } = sanitizeExtraArgs(['-I', 'include', '-D', 'NDEBUG', '-L', 'lib'])
    expect(kept).toEqual(['-I', 'include', '-D', 'NDEBUG', '-L', 'lib'])
    expect(dropped).toEqual([])
  })

  it('will not let a value-consuming flag swallow another flag', () => {
    const { kept, dropped } = sanitizeExtraArgs(['-I', '-fplugin=./x.so'])
    expect(kept).toEqual([])
    expect(dropped).toContain('-I')
  })

  it('drops a value-consuming flag with nothing after it', () => {
    expect(sanitizeExtraArgs(['-D']).kept).toEqual([])
  })
})

describe('optimization values the UI can actually produce', () => {
  it('accepts the release level the Rust profile dropdown writes', () => {
    // One `optimization` field is shared by the C/C++ and Rust toolbars. It used
    // to persist a bare '-O', which the validator then replaced with -O0,
    // silently turning optimization OFF for C++ builds in that project.
    expect(OPT_LEVELS).toContain('-O2')
    expect(OPT_LEVELS).toContain('-O')
  })
})
