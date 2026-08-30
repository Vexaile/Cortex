import { describe, it, expect } from 'vitest'
import { encodeMessage, MessageBuffer, pathToUri, uriToPath, langForFile } from '../src/shared/lsp'

const enc = new TextEncoder()
const dec = new TextDecoder()

/** Drain every complete message currently in the buffer. */
function drain(mb: MessageBuffer): unknown[] {
  const out: unknown[] = []
  let m
  while ((m = mb.next()) !== null) out.push(m)
  return out
}

describe('LSP message codec', () => {
  it('frames a message with a byte-accurate Content-Length', () => {
    const bytes = encodeMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    const text = dec.decode(bytes)
    const [header, body] = text.split('\r\n\r\n')
    expect(header).toMatch(/^Content-Length: \d+$/)
    expect(Number(header.split(': ')[1])).toBe(enc.encode(body).length)
    expect(JSON.parse(body)).toEqual({ jsonrpc: '2.0', id: 1, method: 'initialize' })
  })

  it('round-trips a message through the buffer', () => {
    const mb = new MessageBuffer()
    mb.append(encodeMessage({ id: 7, result: { ok: true } }))
    expect(drain(mb)).toEqual([{ id: 7, result: { ok: true } }])
  })

  it('reassembles a message split across chunks (header apart from body)', () => {
    const mb = new MessageBuffer()
    const full = encodeMessage({ id: 1, method: 'x' })
    // Split mid-header and mid-body.
    mb.append(full.subarray(0, 8))
    expect(mb.next()).toBeNull()
    mb.append(full.subarray(8, 20))
    mb.append(full.subarray(20))
    expect(drain(mb)).toEqual([{ id: 1, method: 'x' }])
  })

  it('pulls two messages delivered in one chunk', () => {
    const mb = new MessageBuffer()
    const a = encodeMessage({ id: 1 })
    const b = encodeMessage({ id: 2 })
    const both = new Uint8Array(a.length + b.length)
    both.set(a)
    both.set(b, a.length)
    mb.append(both)
    expect(drain(mb)).toEqual([{ id: 1 }, { id: 2 }])
  })

  // The bug this guards: Content-Length is BYTES, so a multi-byte character in a
  // hover string makes byte length != string length. A char-based decoder would
  // slice the next message's first bytes into this one.
  it('is byte-accurate with multi-byte characters', () => {
    const mb = new MessageBuffer()
    mb.append(encodeMessage({ hover: 'θ ± µ 中文' }))
    mb.append(encodeMessage({ id: 2 }))
    expect(drain(mb)).toEqual([{ hover: 'θ ± µ 中文' }, { id: 2 }])
  })

  it('survives a malformed body without wedging the stream', () => {
    const mb = new MessageBuffer()
    const bad = enc.encode('Content-Length: 5\r\n\r\n{bad}')
    mb.append(bad)
    expect(mb.next()).toBeNull() // bad JSON -> dropped, not thrown
    mb.append(encodeMessage({ id: 9 }))
    expect(drain(mb)).toEqual([{ id: 9 }])
  })
})

describe('path <-> uri', () => {
  it.each([
    'C:\\Users\\kings\\customIDE\\src\\main.cpp',
    'C:/Users/kings/a b/file.cpp',
    '/home/user/proj/main.rs'
  ])('round-trips %s', (p) => {
    const norm = p.replace(/\\/g, '/')
    expect(uriToPath(pathToUri(p))).toBe(norm)
  })

  it('produces a clangd-style Windows file URI', () => {
    expect(pathToUri('C:\\a\\b.cpp')).toBe('file:///C:/a/b.cpp')
  })

  it('encodes spaces but keeps the drive colon and slashes', () => {
    expect(pathToUri('C:/a b/c.cpp')).toBe('file:///C:/a%20b/c.cpp')
  })
})

describe('langForFile', () => {
  it.each([
    ['main.cpp', 'cpp'],
    ['sensor.h', 'cpp'],
    ['a.cc', 'cpp'],
    ['test.py', 'python'],
    ['lib.rs', 'rust']
  ])('%s -> %s', (path, lang) => {
    expect(langForFile(path)).toBe(lang)
  })

  it('has no server for .ino (the sim covers it) or unknown files', () => {
    expect(langForFile('blink.ino')).toBeNull()
    expect(langForFile('README.md')).toBeNull()
    expect(langForFile('noext')).toBeNull()
  })
})
