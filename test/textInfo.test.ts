import { describe, it, expect } from 'vitest'
import { lineEnding } from '../src/shared/textInfo'

describe('lineEnding', () => {
  it('reports CRLF when the file uses carriage-return + newline', () => {
    expect(lineEnding('int main() {\r\n  return 0;\r\n}\r\n')).toBe('CRLF')
  })

  it('reports LF for plain newlines', () => {
    expect(lineEnding('int main() {\n  return 0;\n}\n')).toBe('LF')
  })

  it('reports CRLF when even one line uses it (mixed endings)', () => {
    expect(lineEnding('a\nb\r\nc\n')).toBe('CRLF')
  })

  it('defaults to LF for content with no line break', () => {
    expect(lineEnding('one line, no newline')).toBe('LF')
    expect(lineEnding('')).toBe('LF')
  })

  it('does not treat a lone carriage return as CRLF', () => {
    expect(lineEnding('old\rmac\rstyle')).toBe('LF')
  })
})
