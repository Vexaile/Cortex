/**
 * Parse a gdb value string into a navigable tree.
 *
 * gdb's MI `-stack-list-variables --all-values` (and `-data-evaluate-expression`)
 * return a struct or array as a single flat string, e.g.
 *   {x = 1, y = {a = 2, b = 3}}   a struct with a nested struct
 *   {1, 2, 3}                     an array
 *   {{x = 1}, {x = 2}}            an array of structs
 *   {name = "hi", '\000' <repeats 6 times>, id = 7}   a char-array field + int
 *   {cb = 0x1149 <run(int, char)>}                    a resolved code pointer
 *   {<Base> = {x = 1}, y = 2}                          a C++ base subobject
 *   0x400b60 "hello"              a pointer to a C string (a scalar leaf)
 *   42                            a scalar
 *
 * The Variables / Watch panels showed that whole string on one line, so a
 * nested struct or a long array was unreadable and could not be drilled into.
 *
 * This turns the string gdb ALREADY returned into a tree WITHOUT asking gdb for
 * anything more: every node's text is exactly what gdb printed. It is a
 * presentation transform, not new debug data - nothing here is inferred or
 * fabricated. The parser is deliberately conservative: where gdb's flat syntax
 * is ambiguous it renders a childless leaf (the exact verbatim string) rather
 * than risk splitting one value into a wrong tree. A value that is not an
 * aggregate (a scalar, a pointer, a string, `<optimized out>`, an error) parses
 * to a single childless leaf, so the caller renders it inline as before.
 */

export interface GdbNode {
  /** Struct field name, or an "[i]" / "[i...j]" index label for array elements
   *  (a repeat-elided run covers a range of slots). Absent at the root of a
   *  parsed value (the variable/expression supplies that name). */
  name?: string
  /** The raw text gdb printed for this node: the scalar, or the whole "{...}"
   *  aggregate (useful as a collapsed one-line summary). */
  value: string
  /** Present iff this node is an aggregate (struct or array). */
  children?: GdbNode[]
}

// A guard against pathological / adversarial nesting: gdb output is bounded in
// practice, but a hand-crafted string should never blow the stack.
const MAX_DEPTH = 32

const REPEAT = /<repeats (\d+) times>/

/**
 * Split a string on its top-level commas, respecting quotes and every bracket
 * pair gdb actually emits: `{}` (aggregates), `<>` (symbol / `<repeats>` /
 * `<optimized out>` / base-class annotations) and `()` (demangled parameter
 * lists). A comma inside any of those - `<run(int, char)>`, `"a, b"` - is not a
 * separator. Decrements clamp at zero so an unbalanced close degrades toward
 * "do not split" (an honest verbatim leaf) rather than mis-splitting.
 */
function splitTopLevel(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let esc = false
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '{' || c === '<' || c === '(') depth++
    else if (c === '}' || c === '>' || c === ')') depth = Math.max(0, depth - 1)
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts.map((p) => p.trim()).filter((p) => p.length > 0)
}

/** Split "name = value" at the FIRST top-level " = " (gdb always spaces it),
 *  ignoring any " = " inside brackets or quotes. Array elements and value
 *  continuations have no name and fall through to a bare value. */
function splitNameValue(s: string): { name?: string; value: string } {
  let depth = 0
  let quote: string | null = null
  let esc = false
  for (let i = 0; i + 2 < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '{' || c === '<' || c === '(') depth++
    else if (c === '}' || c === '>' || c === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && c === ' ' && s[i + 1] === '=' && s[i + 2] === ' ') {
      return { name: s.slice(0, i), value: s.slice(i + 3) }
    }
  }
  return { value: s }
}

/** Is this the text of an aggregate gdb value - a real `{...}` block, not a
 *  scalar that merely happens to start with a brace? A pointer-with-string or a
 *  repeat-elided array (`{...} <repeats N times>`) does not end in `}` and is
 *  treated as a leaf, which is honest: we show exactly what gdb printed. */
function isAggregate(value: string): boolean {
  return value.length >= 2 && value.startsWith('{') && value.endsWith('}')
}

function parse(raw: string, depth: number): GdbNode {
  const value = raw.trim()
  if (depth >= MAX_DEPTH || !isAggregate(value)) return { value }
  const inner = value.slice(1, -1).trim()
  if (inner === '') return { value } // `{}` empty aggregate
  const parts = splitTopLevel(inner)
  if (parts.length === 0) return { value }
  const fields = parts.map((p) => splitNameValue(p))
  // A lone `<...>` interior (`{<No data fields>}`) is a sentinel, not a field or
  // element: render it as the verbatim leaf gdb gave us.
  if (parts.length === 1 && fields[0].name === undefined && parts[0].startsWith('<')) return { value }

  // Struct if any part is a `name = value` field (gdb prints struct fields that
  // way and array elements as bare values).
  if (fields.some((f) => f.name !== undefined)) {
    // gdb joins the segments of ONE multi-part value (a char array with trailing
    // bytes: `"hi", '\000' <repeats 6 times>`) with a top-level comma that is
    // NOT a field separator. Splitting there and keeping the pieces would both
    // truncate the value and invent a phantom field, so a part with no `name = `
    // is folded back onto the previous field's value.
    const merged: { name: string; value: string }[] = []
    for (let i = 0; i < parts.length; i++) {
      const f = fields[i]
      if (f.name !== undefined) merged.push({ name: f.name, value: f.value })
      else if (merged.length > 0) merged[merged.length - 1].value += ', ' + parts[i]
      else return { value } // a continuation with no field before it: malformed, show verbatim
    }
    return { value, children: merged.map((m) => ({ ...parse(m.value, depth + 1), name: m.name })) }
  }

  // Array of bare elements. Index labels are the one piece of presentation gdb
  // does not give us; keep them honest by advancing past `<repeats N times>`
  // runs (one printed part can stand for many array slots) instead of counting
  // parts, which would mislabel every element after an elided run.
  const children: GdbNode[] = []
  let idx = 0
  for (const part of parts) {
    const m = REPEAT.exec(part)
    const count = m ? parseInt(m[1], 10) : 1
    const name = count > 1 ? `[${idx}...${idx + count - 1}]` : `[${idx}]`
    children.push({ ...parse(part, depth + 1), name })
    idx += count
  }
  return { value, children }
}

/** Parse a gdb value string into a tree. Scalars return a childless leaf. */
export function parseGdbValue(raw: string): GdbNode {
  return parse(raw, 0)
}
