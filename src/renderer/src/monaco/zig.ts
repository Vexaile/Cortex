import type * as monaco from 'monaco-editor'

/**
 * Monaco ships no Zig grammar, so `.zig` opened as flat grey plaintext while the
 * tab and status bar both said "Zig" - which reads as a rendering bug. This
 * registers a Monarch tokenizer emitting exactly the token names the Cortex Dark
 * theme already styles (keyword, type, number, string, comment, macro), so Zig
 * picks up the same palette as every other language.
 */

const KEYWORDS = [
  'align', 'allowzero', 'and', 'anyframe', 'anytype', 'asm', 'async', 'await', 'break', 'callconv',
  'catch', 'comptime', 'const', 'continue', 'defer', 'else', 'enum', 'errdefer', 'error', 'export',
  'extern', 'fn', 'for', 'if', 'inline', 'linksection', 'noalias', 'noinline', 'nosuspend',
  'opaque', 'or', 'orelse', 'packed', 'pub', 'resume', 'return', 'struct', 'suspend', 'switch',
  'test', 'threadlocal', 'try', 'union', 'unreachable', 'usingnamespace', 'var', 'volatile', 'while'
]

const TYPES = [
  'bool', 'void', 'noreturn', 'type', 'anyerror', 'comptime_int', 'comptime_float',
  'isize', 'usize', 'c_char', 'c_short', 'c_ushort', 'c_int', 'c_uint', 'c_long', 'c_ulong',
  'c_longlong', 'c_ulonglong', 'c_longdouble',
  'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64', 'u64', 'i128', 'u128',
  'f16', 'f32', 'f64', 'f80', 'f128'
]

const LITERALS = ['true', 'false', 'null', 'undefined']

let registered = false

/** Idempotent: safe to call from every editor mount. */
export function registerZig(m: typeof monaco): void {
  if (registered) return
  registered = true

  m.languages.register({ id: 'zig', extensions: ['.zig', '.zon'], aliases: ['Zig', 'zig'] })

  m.languages.setLanguageConfiguration('zig', {
    comments: { lineComment: '//' },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
      { open: "'", close: "'", notIn: ['string'] }
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" }
    ]
  })

  m.languages.setMonarchTokensProvider('zig', {
    defaultToken: '',
    keywords: KEYWORDS,
    types: TYPES,
    literals: LITERALS,
    tokenizer: {
      root: [
        // Builtins (@import, @intCast, ...) share the macro colour, as in C.
        [/@[a-zA-Z_]\w*/, 'macro'],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@types': 'type',
              '@literals': 'keyword',
              '@default': 'identifier'
            }
          }
        ],
        { include: '@whitespace' },
        // Multiline string: \\ to end of line.
        [/\\\\.*$/, 'string'],
        // An unterminated quote must be consumed HERE, before the rule that
        // pushes @string. Monarch carries a state across lines, and Zig has no
        // newline-spanning quoted string, so without this one stray quote
        // paints the whole rest of the file as a string.
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, { token: 'string.quote', next: '@string' }],
        [/'(?:[^'\\]|\\.)*'/, 'string'],
        [/0[xX][0-9a-fA-F_]+/, 'number.hex'],
        [/0[bB][01_]+/, 'number'],
        [/0[oO][0-7_]+/, 'number'],
        [/\d[\d_]*(\.[\d_]+)?([eE][-+]?\d+)?/, 'number'],
        [/[{}()[\]]/, '@brackets'],
        [/[<>=!+\-*/%&|^~?:]+/, 'operator'],
        [/[;,.]/, 'delimiter']
      ],
      whitespace: [
        [/\s+/, ''],
        // /// doc comments and // line comments.
        [/\/\/.*$/, 'comment']
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, { token: 'string.quote', next: '@pop' }]
      ]
    }
  })
}

let jsonRegistered = false

/**
 * Monaco's JSON support lives in its language *service*, which pulls a worker.
 * Cortex deliberately dropped those workers (they were most of a 24 MB bundle),
 * so this registers a plain tokenizer instead: highlighting without validation,
 * at no bundle cost. `.cortex/config.json`, `package.json` and
 * `compile_commands.json` are all common in these projects.
 */
export function registerJson(m: typeof monaco): void {
  if (jsonRegistered) return
  jsonRegistered = true

  m.languages.register({ id: 'json', extensions: ['.json'], aliases: ['JSON', 'json'] })
  m.languages.setLanguageConfiguration('json', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [
      ['{', '}'],
      ['[', ']']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"', notIn: ['string'] }
    ]
  })
  m.languages.setMonarchTokensProvider('json', {
    defaultToken: '',
    tokenizer: {
      root: [
        // A key is a string immediately followed by a colon.
        [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'type'],
        // Unterminated quote: consume to end of line so @string cannot leak
        // into every following line (JSON strings never span a newline).
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, { token: 'string.quote', next: '@string' }],
        [/\b(?:true|false|null)\b/, 'keyword'],
        [/-?\d+(\.\d+)?([eE][-+]?\d+)?/, 'number'],
        [/[{}[\]]/, '@brackets'],
        [/[:,]/, 'delimiter'],
        // JSON with comments (tsconfig, .vscode) is common enough to tolerate.
        [/\/\/.*$/, 'comment'],
        [/\/\*/, { token: 'comment', next: '@comment' }]
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, { token: 'string.quote', next: '@pop' }]
      ],
      comment: [
        [/[^*/]+/, 'comment'],
        [/\*\//, { token: 'comment', next: '@pop' }],
        [/./, 'comment']
      ]
    }
  })
}
