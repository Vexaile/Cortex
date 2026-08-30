import { describe, it, expect } from 'vitest'
import { parseMiLine, asString, asArray, asTuple } from '../src/shared/gdbmi'

describe('parseMiLine', () => {
  it('parses the prompt', () => {
    expect(parseMiLine('(gdb)').kind).toBe('prompt')
  })

  it('parses a result record with a token', () => {
    const r = parseMiLine('42^done')
    expect(r).toMatchObject({ kind: 'result', token: 42, class: 'done' })
  })

  it('parses an error result and its message', () => {
    const r = parseMiLine('7^error,msg="No symbol \\"foo\\" in current context."')
    expect(r.kind).toBe('result')
    if (r.kind === 'result') {
      expect(r.class).toBe('error')
      expect(asString(r.results.msg)).toBe('No symbol "foo" in current context.')
    }
  })

  it('parses *stopped with a nested frame tuple', () => {
    const line =
      '*stopped,reason="breakpoint-hit",disp="keep",bkptno="1",frame={addr="0x1400",func="main",args=[],file="a.cpp",fullname="C:/a/a.cpp",line="12"},thread-id="1"'
    const r = parseMiLine(line)
    expect(r.kind).toBe('async')
    if (r.kind === 'async') {
      expect(r.class).toBe('stopped')
      expect(asString(r.results.reason)).toBe('breakpoint-hit')
      const frame = asTuple(r.results.frame)
      expect(asString(frame.func)).toBe('main')
      expect(asString(frame.line)).toBe('12')
      expect(asString(frame.fullname)).toBe('C:/a/a.cpp')
    }
  })

  it('parses a stack list into frame tuples', () => {
    const line =
      '12^done,stack=[frame={level="0",func="foo",file="a.cpp",line="3"},frame={level="1",func="main",file="a.cpp",line="9"}]'
    const r = parseMiLine(line)
    if (r.kind === 'result') {
      const frames = asArray(r.results.stack)
      expect(frames).toHaveLength(2)
      expect(asString(asTuple(frames[0]).func)).toBe('foo')
      expect(asString(asTuple(frames[1]).level)).toBe('1')
    }
  })

  it('parses a variables list', () => {
    const r = parseMiLine('9^done,variables=[{name="x",value="5"},{name="p",value="0x0"}]')
    if (r.kind === 'result') {
      const vars = asArray(r.results.variables)
      expect(vars).toHaveLength(2)
      expect(asString(asTuple(vars[0]).name)).toBe('x')
      expect(asString(asTuple(vars[0]).value)).toBe('5')
    }
  })

  it('unescapes newlines and quotes in stream records', () => {
    const r = parseMiLine('~"hello \\"world\\"\\n"')
    expect(r).toMatchObject({ kind: 'stream', type: 'console', text: 'hello "world"\n' })
  })

  it('decodes octal escapes so non-printable bytes are not shown as digits', () => {
    // In the MI line, \101 is the octal escape for 'A', \102 for 'B'.
    const r = parseMiLine('~"x=\\101\\102"')
    if (r.kind === 'stream') {
      expect(r.text).toBe('x=AB')
      expect(r.text.includes('101')).toBe(false)
    }
  })


  it('distinguishes target and log streams', () => {
    expect(parseMiLine('@"program output"').kind).toBe('stream')
    expect((parseMiLine('@"x"') as { type: string }).type).toBe('target')
    expect((parseMiLine('&"log"') as { type: string }).type).toBe('log')
  })

  it('parses notify async records', () => {
    const r = parseMiLine('=thread-group-added,id="i1"')
    expect(r).toMatchObject({ kind: 'async', type: 'notify', class: 'thread-group-added' })
  })

  it('handles commas inside quoted values without splitting', () => {
    const r = parseMiLine('^done,value="a, b, c"')
    if (r.kind === 'result') expect(asString(r.results.value)).toBe('a, b, c')
  })
})

describe('non-record lines (the inferior sharing gdb stdout)', () => {
  it('reports a plain program line as unknown, carrying its text', () => {
    // Windows gdb does not wrap the inferior's output in target (@) stream
    // records: the child writes to the same stdout handle, so a printf arrives
    // as a plain line. debugService routes `unknown` to the program stream;
    // dropping it made a debugged program's output invisible.
    const rec = parseMiLine('data.txt=found')
    expect(rec.kind).toBe('unknown')
    expect(rec.kind === 'unknown' && rec.text).toBe('data.txt=found')
  })

  it('does not mistake an MI record or the prompt for program output', () => {
    expect(parseMiLine('*stopped,reason="breakpoint-hit"').kind).toBe('async')
    expect(parseMiLine('~"reading symbols"').kind).toBe('stream')
    expect(parseMiLine('^done').kind).toBe('result')
    expect(parseMiLine('(gdb)').kind).toBe('prompt')
  })

  it('yields empty text for a blank line, so nothing is emitted for it', () => {
    const rec = parseMiLine('')
    expect(rec.kind === 'unknown' && rec.text).toBe('')
  })
})
