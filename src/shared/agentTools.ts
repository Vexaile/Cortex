/**
 * The Cortex engineering agent's tool contract, shared between the main-process
 * loop (which executes the tools) and the tests. Kept pure and dependency-free:
 * no Electron, no fs, no provider SDK. The main service translates these into
 * each provider's own tool format and executes them behind the security
 * boundary (workspace confinement, human approval for edits).
 *
 * Trust tiers (see CLAUDE.md sections 7-8):
 *   - read_file / search_project / get_diagnostics / get_project_model are SAFE:
 *     read-only, auto-run, confined to the open workspace.
 *   - propose_edit is REVIEW-REQUIRED: it never writes to disk. It stages a diff
 *     that the human approves or rejects per file; only then does the renderer
 *     apply it through the same workspace-confined write path a user edit uses.
 */

export interface AgentToolDef {
  name: string
  description: string
  /** JSON Schema for the tool input (draft-07 subset the providers accept). */
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required: string[]
  }
}

export const READ_FILE = 'read_file'
export const SEARCH_PROJECT = 'search_project'
export const GET_DIAGNOSTICS = 'get_diagnostics'
export const GET_PROJECT_MODEL = 'get_project_model'
export const PROPOSE_EDIT = 'propose_edit'

/** The only tool that mutates; everything else is read-only. */
export const MUTATION_TOOLS: ReadonlySet<string> = new Set([PROPOSE_EDIT])

export const AGENT_TOOLS: AgentToolDef[] = [
  {
    name: READ_FILE,
    description:
      'Read a text file from the open workspace. Paths are workspace-relative (or absolute inside the workspace). Use this to inspect any file before reasoning about or editing it.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Workspace-relative path to the file.' } },
      required: ['path']
    }
  },
  {
    name: SEARCH_PROJECT,
    description:
      'Search the workspace source for a string (or regex). Returns matching files with line numbers and previews. Use it to locate symbols, includes, pin usage, or callers.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The text or pattern to search for.' },
        regex: { type: 'string', description: 'Set to "true" to treat the query as a regular expression.' }
      },
      required: ['query']
    }
  },
  {
    name: GET_DIAGNOSTICS,
    description:
      'Return the current compiler/linter problems (the Problems feed): file, line, severity, and message. Use this to ground a fix in the actual errors and warnings.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: GET_PROJECT_MODEL,
    description:
      'Return the derived project model: languages, the board/platform (from platformio.ini when present), the GPIO pins the source touches, the buses (I2C/SPI/UART) in use, and the device driver headers included. This is what makes Cortex hardware-aware; consult it before hardware reasoning.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: PROPOSE_EDIT,
    description:
      'Propose replacing the ENTIRE contents of a workspace file with new_content. This does NOT write to disk: it stages a diff for the human to approve or reject. Always read the file first and return its complete new content, not a fragment. Prefer several small, focused proposals over one sweeping rewrite.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path to the file to change.' },
        new_content: { type: 'string', description: 'The complete new contents of the file.' },
        summary: { type: 'string', description: 'One short line describing what this edit does.' }
      },
      required: ['path', 'new_content']
    }
  }
]

export const AGENT_SYSTEM_PROMPT = `You are the Cortex embedded engineering agent. You act on task-oriented requests about firmware and the hardware it controls (C/C++ up to C++23, interrupts, DMA, RTOS tasks, peripheral registers, buses, timers, GPIO, memory layout).

Work like an engineer, using the tools:
1. Understand the request and inspect the relevant files (read_file, search_project).
2. Ground yourself in reality: get_diagnostics for current errors/warnings, get_project_model for the board, pins, buses, and devices.
3. When code must change, call propose_edit with the file's COMPLETE new content. This never writes to disk; it stages a diff the engineer approves or rejects per file. Never claim a change is applied. Prefer small, focused edits.
4. Finish with a short plain-language summary of what you found and what you proposed.

Rules:
- Only touch files in the open workspace.
- Read a file before you edit it; return its full new content, never a partial fragment or a diff.
- Do not fabricate file contents, pin assignments, or hardware you have not observed via the tools.
- Be concise and concrete. Prefer register-level detail and real line references.`

/** Max tool rounds before the loop stops itself, so a confused model cannot run
 *  up unbounded cost. */
export const MAX_AGENT_STEPS = 16

// ---- provider format adapters --------------------------------------------

export interface AnthropicTool {
  name: string
  description: string
  input_schema: AgentToolDef['inputSchema']
}
export function toAnthropicTools(tools: AgentToolDef[] = AGENT_TOOLS): AnthropicTool[] {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
}

export interface OpenAiTool {
  type: 'function'
  function: { name: string; description: string; parameters: AgentToolDef['inputSchema'] }
}
export function toOpenAiTools(tools: AgentToolDef[] = AGENT_TOOLS): OpenAiTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema }
  }))
}

// ---- structured fallback (providers without tool-calling) -----------------

export interface ProposedEdit {
  path: string
  new_content: string
  summary?: string
}
export interface StructuredProposal {
  answer: string
  edits: ProposedEdit[]
}

/**
 * The instruction appended for providers that cannot do tool-calling. The model
 * gets the read-only context up front and must answer in one structured JSON
 * object, so the same diff-review UI can consume its edits.
 */
export const STRUCTURED_FALLBACK_INSTRUCTION = `You cannot call tools in this mode. Using only the context provided above, respond with a SINGLE JSON object and nothing else, in this exact shape:
{"answer": "<your plain-language explanation>", "edits": [{"path": "<workspace-relative path>", "new_content": "<the COMPLETE new file contents>", "summary": "<one line>"}]}
If no file needs to change, use an empty edits array. Never include a partial file in new_content.`

/**
 * Extract the structured proposal from a fallback model's reply. Tolerates the
 * model wrapping the JSON in a code fence or in prose: takes the first balanced
 * top-level object. Returns null when nothing parseable is present (the caller
 * then treats the whole reply as a plain answer with no edits).
 */
export function parseStructuredProposal(text: string): StructuredProposal | null {
  const raw = extractFirstJsonObject(text)
  if (!raw) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  const answer = typeof rec.answer === 'string' ? rec.answer : ''
  const editsIn = Array.isArray(rec.edits) ? rec.edits : []
  const edits: ProposedEdit[] = []
  for (const e of editsIn) {
    if (!e || typeof e !== 'object') continue
    const er = e as Record<string, unknown>
    if (typeof er.path === 'string' && typeof er.new_content === 'string') {
      edits.push({
        path: er.path,
        new_content: er.new_content,
        summary: typeof er.summary === 'string' ? er.summary : undefined
      })
    }
  }
  if (!answer && edits.length === 0) return null
  return { answer, edits }
}

/** Find the first balanced {...} run, ignoring braces inside strings. */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}
