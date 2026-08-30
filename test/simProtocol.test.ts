import { describe, it, expect } from 'vitest'
import { parseSimLine } from '../src/shared/simProtocol'

describe('parseSimLine', () => {
  it('parses @pin', () => expect(parseSimLine('@pin 13 1')).toEqual({ kind: 'pin', pin: 13, value: 1 }))
  it('parses @pwm', () => expect(parseSimLine('@pwm 9 128')).toEqual({ kind: 'pwm', pin: 9, value: 128 }))
  it('parses @mode', () => expect(parseSimLine('@mode 2 2')).toEqual({ kind: 'mode', pin: 2, value: 2 }))
  it('parses @tone', () => expect(parseSimLine('@tone 8 440')).toEqual({ kind: 'tone', pin: 8, value: 440 }))
  it('parses @serial with text', () =>
    expect(parseSimLine('@serial hello world')).toEqual({ kind: 'serial', text: 'hello world' }))
  it('parses @serial with empty text', () => expect(parseSimLine('@serial ')).toEqual({ kind: 'serial', text: '' }))
  it('drops a malformed pin line (missing value)', () => expect(parseSimLine('@pin 13')).toBeNull())
  it('drops an unknown @-directive rather than mis-rendering it', () => expect(parseSimLine('@wat 1 2')).toBeNull())
  it('treats a bare line as serial output', () =>
    expect(parseSimLine('printf output')).toEqual({ kind: 'serial', text: 'printf output' }))
  it('returns null for an empty line', () => expect(parseSimLine('')).toBeNull())
})
