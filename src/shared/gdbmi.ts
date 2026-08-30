/**
 * Parser for GDB's Machine Interface (MI2) output. Pure and dependency-free so
 * it is unit-testable and can be shared. Only the subset Cortex drives is
 * modelled, but the value grammar (c-strings, tuples, lists) is parsed in full.
 *
 * A line of MI output is one of:
 *   result record:  `[token]^class[,results]`      e.g. 42^done,stack=[...]
 *   async record:   `[token](*|+|=)class[,results]` e.g. *stopped,reason="..."
 *   stream record:  `(~|@|&)"c-string"`             console / target / log text
 *   the prompt:     `(gdb)`
 */

export type MiValue = string | MiTuple | MiValue[]
export interface MiTuple {
  [key: string]: MiValue
}

export type MiRecord =
  | { kind: 'result'; token: number | null; class: string; results: MiTuple }
  | { kind: 'async'; type: 'exec' | 'status' | 'notify'; token: number | null; class: string; results: MiTuple }
  | { kind: 'stream'; type: 'console' | 'target' | 'log'; text: string }
  | { kind: 'prompt' }
  | { kind: 'unknown'; text: string }

const ASYNC_PREFIX: Record<string, 'exec' | 'status' | 'notify'> = {
  '*': 'exec',
  '+': 'status',
  '=': 'notify'
}
const STREAM_PREFIX: Record<string, 'console' | 'target' | 'log'> = {
  '~': 'console',
  '@': 'target',
  '&': 'log'
}

/** Parse one line of MI output. Trailing CR is tolerated. */
export function parseMiLine(raw: string): MiRecord {
  const line = raw.replace(/\r$/, '')
  if (line === '(gdb)' || line === '(gdb) ') return { kind: 'prompt' }
  if (line.length === 0) return { kind: 'unknown', text: '' }

  // Optional leading token (digits).
  let i = 0
  while (i < line.length && line[i] >= '0' && line[i] <= '9') i++
  const token = i > 0 ? parseInt(line.slice(0, i), 10) : null
  const marker = line[i]

  if (STREAM_PREFIX[marker]) {
    const p = new Parser(line, i + 1)
    const text = p.parseCString()
    return { kind: 'stream', type: STREAM_PREFIX[marker], text }
  }

  if (marker === '^' || ASYNC_PREFIX[marker]) {
    const p = new Parser(line, i + 1)
    const cls = p.parseClass()
    const results: MiTuple = {}
    while (p.peek() === ',') {
      p.next() // consume comma
      const [key, value] = p.parseResult()
      // Repeated keys (gdb emits several `frame=` etc.) collapse into a list.
      if (key in results) {
        const prev = results[key]
        results[key] = Array.isArray(prev) ? [...prev, value] : [prev, value]
      } else {
        results[key] = value
      }
    }
    if (marker === '^') return { kind: 'result', token, class: cls, results }
    return { kind: 'async', type: ASYNC_PREFIX[marker], token, class: cls, results }
  }

  return { kind: 'unknown', text: line }
}

class Parser {
  constructor(
    private s: string,
    private i = 0
  ) {}

  peek(): string {
    return this.s[this.i]
  }
  next(): string {
    return this.s[this.i++]
  }

  parseClass(): string {
    const start = this.i
    while (this.i < this.s.length && /[A-Za-z0-9-]/.test(this.s[this.i])) this.i++
    return this.s.slice(start, this.i)
  }

  private parseVariable(): string {
    const start = this.i
    while (this.i < this.s.length && this.s[this.i] !== '=') this.i++
    return this.s.slice(start, this.i)
  }

  parseResult(): [string, MiValue] {
    const key = this.parseVariable()
    if (this.peek() === '=') this.next()
    return [key, this.parseValue()]
  }

  parseValue(): MiValue {
    const c = this.peek()
    if (c === '"') return this.parseCString()
    if (c === '{') return this.parseTuple()
    if (c === '[') return this.parseList()
    // Bare token (rare); read up to a delimiter.
    const start = this.i
    while (this.i < this.s.length && !',}]'.includes(this.s[this.i])) this.i++
    return this.s.slice(start, this.i)
  }

  parseCString(): string {
    // Assumes current char is the opening quote.
    if (this.peek() === '"') this.next()
    let out = ''
    while (this.i < this.s.length) {
      const ch = this.next()
      if (ch === '"') break
      if (ch === '\\') {
        const e = this.next()
        if (e >= '0' && e <= '7') {
          // gdb escapes non-printable bytes as octal \ooo (1-3 digits).
          let oct = e
          while (oct.length < 3 && this.s[this.i] >= '0' && this.s[this.i] <= '7') oct += this.next()
          out += String.fromCharCode(parseInt(oct, 8))
        } else {
          out += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e === '\\' ? '\\' : e === '"' ? '"' : e
        }
      } else {
        out += ch
      }
    }
    return out
  }

  private parseTuple(): MiTuple {
    this.next() // {
    const tuple: MiTuple = {}
    if (this.peek() === '}') {
      this.next()
      return tuple
    }
    for (;;) {
      const [key, value] = this.parseResult()
      if (key in tuple) {
        const prev = tuple[key]
        tuple[key] = Array.isArray(prev) ? [...prev, value] : [prev, value]
      } else {
        tuple[key] = value
      }
      if (this.peek() === ',') {
        this.next()
        continue
      }
      break
    }
    if (this.peek() === '}') this.next()
    return tuple
  }

  private parseList(): MiValue[] {
    this.next() // [
    const list: MiValue[] = []
    if (this.peek() === ']') {
      this.next()
      return list
    }
    for (;;) {
      // A list holds either values or results (key=value); for results we keep
      // just the value, which is what every consumer here wants.
      const save = this.i
      const key = this.parseVariable()
      if (this.peek() === '=' && key.length > 0 && /^[A-Za-z_]/.test(key)) {
        this.next()
        list.push(this.parseValue())
      } else {
        this.i = save
        list.push(this.parseValue())
      }
      if (this.peek() === ',') {
        this.next()
        continue
      }
      break
    }
    if (this.peek() === ']') this.next()
    return list
  }
}

// ---- helpers for reading parsed values -----------------------------------

export function asString(v: MiValue | undefined): string {
  return typeof v === 'string' ? v : ''
}
export function asArray(v: MiValue | undefined): MiValue[] {
  return Array.isArray(v) ? v : v === undefined ? [] : [v]
}
export function asTuple(v: MiValue | undefined): MiTuple {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}
