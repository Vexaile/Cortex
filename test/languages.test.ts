import { describe, it, expect } from 'vitest'
import { langFromPath } from '../src/shared/languages'

describe('langFromPath', () => {
  it('maps .cpp to cpp', () => expect(langFromPath('a/b/main.cpp').id).toBe('cpp'))
  it('maps an Arduino .ino to cpp', () => expect(langFromPath('Blink/Blink.ino').id).toBe('cpp'))
  it('maps .py to python', () => expect(langFromPath('x.py').id).toBe('python'))
  it('maps .rs to rust and it is runnable', () => {
    const l = langFromPath('m.rs')
    expect(l.id).toBe('rust')
    expect(l.runnable).toBe(true)
  })
  it('maps .ts to typescript', () => expect(langFromPath('a.ts').id).toBe('typescript'))
  it('is case-insensitive on the extension', () => expect(langFromPath('M.CPP').id).toBe('cpp'))
  it('falls back to plaintext for unknown files', () => expect(langFromPath('README').id).toBe('plaintext'))
})
