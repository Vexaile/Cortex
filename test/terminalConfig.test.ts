import { describe, it, expect } from 'vitest'
import { pickShell, clampDim, MAX_TERMINALS } from '../src/shared/terminalConfig'

describe('clampDim', () => {
  it('passes a normal integer through', () => {
    expect(clampDim(80, 24)).toBe(80)
    expect(clampDim(24, 80)).toBe(24)
  })
  it('falls back on a non-finite value', () => {
    expect(clampDim(NaN, 24)).toBe(24)
    expect(clampDim(Infinity, 24)).toBe(24)
  })
  it('never returns below 1 (a zero-size or detached container)', () => {
    expect(clampDim(0, 24)).toBe(1)
    expect(clampDim(-5, 24)).toBe(1)
  })
  it('caps an absurd value so the pty is never asked for a giant grid', () => {
    expect(clampDim(100000, 24)).toBe(1000)
  })
  it('floors a fractional measurement', () => {
    expect(clampDim(80.9, 24)).toBe(80)
  })
})

describe('pickShell', () => {
  it('defaults to PowerShell on Windows with an empty argv (spawned as file+args, never a shell string)', () => {
    const s = pickShell('win32', {})
    expect(s.file).toBe('powershell.exe')
    expect(s.args).toEqual([])
  })
  it('honors $SHELL on posix, then falls back to bash', () => {
    expect(pickShell('linux', { SHELL: '/usr/bin/zsh' }).file).toBe('/usr/bin/zsh')
    expect(pickShell('linux', {}).file).toBe('/bin/bash')
    expect(pickShell('darwin', {}).file).toBe('/bin/bash')
  })
  it('lets CORTEX_SHELL override on either platform', () => {
    expect(pickShell('win32', { CORTEX_SHELL: 'pwsh.exe' }).file).toBe('pwsh.exe')
    expect(pickShell('linux', { CORTEX_SHELL: '/bin/fish', SHELL: '/bin/zsh' }).file).toBe('/bin/fish')
  })
})

describe('MAX_TERMINALS', () => {
  it('is a positive cap', () => {
    expect(MAX_TERMINALS).toBeGreaterThan(0)
  })
})
