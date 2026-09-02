import { describe, it, expect } from 'vitest'
import { parseGdbValue } from '../src/shared/gdbValue'

describe('parseGdbValue', () => {
  it('treats a scalar as a childless leaf', () => {
    const n = parseGdbValue('42')
    expect(n.value).toBe('42')
    expect(n.children).toBeUndefined()
  })

  it('leaves a pointer-with-string as a leaf (starts with a brace? no)', () => {
    const n = parseGdbValue('0x400b60 "hello"')
    expect(n.children).toBeUndefined()
    expect(n.value).toBe('0x400b60 "hello"')
  })

  it('parses a flat struct into named fields', () => {
    const n = parseGdbValue('{x = 1, y = 2}')
    expect(n.children?.map((c) => [c.name, c.value])).toEqual([
      ['x', '1'],
      ['y', '2']
    ])
  })

  it('parses a nested struct recursively', () => {
    const n = parseGdbValue('{p = {x = 1, y = 2}, n = 3}')
    const p = n.children?.[0]
    expect(p?.name).toBe('p')
    expect(p?.children?.map((c) => [c.name, c.value])).toEqual([
      ['x', '1'],
      ['y', '2']
    ])
    expect(n.children?.[1]).toMatchObject({ name: 'n', value: '3' })
    expect(n.children?.[1].children).toBeUndefined()
  })

  it('labels array elements with their index', () => {
    const n = parseGdbValue('{10, 20, 30}')
    expect(n.children?.map((c) => [c.name, c.value])).toEqual([
      ['[0]', '10'],
      ['[1]', '20'],
      ['[2]', '30']
    ])
  })

  it('parses an array of structs', () => {
    const n = parseGdbValue('{{x = 1}, {x = 2}}')
    expect(n.children?.[0].name).toBe('[0]')
    expect(n.children?.[0].children?.[0]).toMatchObject({ name: 'x', value: '1' })
    expect(n.children?.[1].children?.[0]).toMatchObject({ name: 'x', value: '2' })
  })

  it('does not split on a comma inside a quoted string', () => {
    const n = parseGdbValue('{name = "a, b", n = 2}')
    expect(n.children?.map((c) => [c.name, c.value])).toEqual([
      ['name', '"a, b"'],
      ['n', '2']
    ])
  })

  it('does not split on an equals inside a quoted string', () => {
    const n = parseGdbValue('{s = "a = b"}')
    expect(n.children?.[0]).toMatchObject({ name: 's', value: '"a = b"' })
  })

  it('advances the array index past a repeat-elided run', () => {
    // gdb collapses indices 0..15 into one printed part; the element after it is
    // index 16, not 1. Labeling it [1] would be a fabricated, wrong index.
    const n = parseGdbValue('{0 <repeats 16 times>, 5}')
    expect(n.children?.map((c) => [c.name, c.value])).toEqual([
      ['[0...15]', '0 <repeats 16 times>'],
      ['[16]', '5']
    ])
  })

  it('does not split a comma inside a resolved code-pointer signature', () => {
    // gdb annotates a function pointer with its demangled symbol; a C++ signature
    // carries top-level commas that are NOT field separators.
    const n = parseGdbValue('{cb = 0x1149 <run(int, char)>}')
    expect(n.children?.length).toBe(1)
    expect(n.children?.[0]).toMatchObject({ name: 'cb', value: '0x1149 <run(int, char)>' })
    expect(n.children?.[0].children).toBeUndefined()
  })

  it('keeps a char-array field with trailing bytes as one value (no phantom field)', () => {
    // `char name[16] = "sensor"` prints as a quoted run + a repeat run joined by a
    // top-level comma inside ONE value; it must not be torn into two fields.
    const n = parseGdbValue(`{name = "sensor", '\\000' <repeats 9 times>, id = 7}`)
    expect(n.children?.map((c) => [c.name, c.value])).toEqual([
      ['name', `"sensor", '\\000' <repeats 9 times>`],
      ['id', '7']
    ])
  })

  it('expands a C++ base-class subobject rather than collapsing to a leaf', () => {
    const n = parseGdbValue('{<Base> = {x = 1}, y = 2}')
    expect(n.children?.map((c) => c.name)).toEqual(['<Base>', 'y'])
    expect(n.children?.[0].children?.[0]).toMatchObject({ name: 'x', value: '1' })
    expect(n.children?.[1]).toMatchObject({ name: 'y', value: '2' })
  })

  it('expands an array whose first element is an annotation token', () => {
    const n = parseGdbValue('{<optimized out>, 5}')
    expect(n.children?.map((c) => [c.name, c.value])).toEqual([
      ['[0]', '<optimized out>'],
      ['[1]', '5']
    ])
  })

  it('renders an empty aggregate as a leaf', () => {
    const n = parseGdbValue('{}')
    expect(n.children).toBeUndefined()
    expect(n.value).toBe('{}')
  })

  it('treats a no-data-fields sentinel as a leaf', () => {
    const n = parseGdbValue('{<No data fields>}')
    expect(n.children).toBeUndefined()
  })

  it('treats a repeat-elided struct (does not end in brace) as a leaf', () => {
    const n = parseGdbValue('{x = 0} <repeats 4 times>')
    expect(n.children).toBeUndefined()
    expect(n.value).toBe('{x = 0} <repeats 4 times>')
  })

  it('keeps <optimized out> as a leaf', () => {
    const n = parseGdbValue('<optimized out>')
    expect(n.children).toBeUndefined()
    expect(n.value).toBe('<optimized out>')
  })

  it('trims surrounding whitespace', () => {
    const n = parseGdbValue('  {a = 1}  ')
    expect(n.value).toBe('{a = 1}')
    expect(n.children?.[0]).toMatchObject({ name: 'a', value: '1' })
  })

  it('does not overflow on pathological nesting', () => {
    const deep = '{'.repeat(200) + '1' + '}'.repeat(200)
    expect(() => parseGdbValue(deep)).not.toThrow()
  })
})
