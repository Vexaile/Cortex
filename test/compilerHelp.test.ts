import { describe, it, expect } from 'vitest'
import { detectOS, compilerInstallHelp, type OS } from '../src/shared/compilerHelp'

describe('detectOS', () => {
  it('reads the OS out of a realistic user agent', () => {
    expect(detectOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/33')).toBe('windows')
    expect(detectOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/33')).toBe('mac')
    expect(detectOS('Mozilla/5.0 (X11; Linux x86_64) Electron/33')).toBe('linux')
  })
  it('defaults to linux for an unknown platform', () => {
    expect(detectOS('some-headless-thing')).toBe('linux')
  })
  // "darwin" contains the substring "win", so an order that tests windows first
  // silently classifies every Darwin agent as Windows.
  it('reads a Darwin user agent as mac, not windows', () => {
    expect(detectOS('Darwin')).toBe('mac')
    expect(detectOS('Mozilla/5.0 (Darwin/23.1.0)')).toBe('mac')
  })
})

describe('compilerInstallHelp', () => {
  const cases: Array<[OS, RegExp]> = [
    ['windows', /winget|msys2/i],
    ['mac', /xcode-select/i],
    ['linux', /apt|build-essential/i]
  ]
  it.each(cases)('gives a real install command for %s', (os, re) => {
    const help = compilerInstallHelp(os)
    expect(help.os).toBe(os)
    expect(help.command).toMatch(re)
    expect(help.note.length).toBeGreaterThan(0)
    expect(help.docLabel.length).toBeGreaterThan(0)
    expect(help.docUrl).toMatch(/^https:\/\//)
  })
  it('mentions clang++ for mac (Apple Clang) and gcc paths for linux', () => {
    expect(compilerInstallHelp('mac').note).toMatch(/clang\+\+/)
    expect(compilerInstallHelp('linux').note).toMatch(/dnf|pacman/)
  })
})
