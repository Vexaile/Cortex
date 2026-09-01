/**
 * The Cortex engineering agent's tool contract, shared between the main-process
 * loop (which executes the tools) and the tests. Kept pure and dependency-free:
 * no Electron, no fs, no provider SDK. The main service translates these into
 * each provider's own tool format and executes them behind the security
 * boundary (workspace confinement, human approval for edits).
 *
 * Trust tiers (see CLAUDE.md sections 7-8):
 *   - read_file / search_project / get_diagnostics / get_project_model /
 *     get_environment / get_hardware_graph are SAFE: read-only, auto-run,
 *     confined to the open workspace.
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
export const GET_ENVIRONMENT = 'get_environment'
export const GET_HARDWARE_GRAPH = 'get_hardware_graph'
export const SEARCH_DOCS = 'search_docs'
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
    name: GET_ENVIRONMENT,
    description:
      'Return the evidence-based environment report for the selected board: whether the board core is installed, each #include header and how it resolves (resolved via a named installed library / provided by the toolchain / unverified / MISSING confirmed by a build), available library updates with risk, and hardware findings. Every claim is backed by evidence; a header Cortex could not confirm is shown as "unverified", never as present. Use this to answer "can this build" and "what dependency is missing".',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: GET_HARDWARE_GRAPH,
    description:
      'Return the hardware relationship graph derived from the source: the board, recognized devices (from driver includes), the buses in use, the GPIO pins, and the inferred device<->bus attachments. Inferred attachments are labelled "likely" and carry the reason or caveat, so you can tell what Cortex knows from what it infers. Use this to reason about which device is on which bus and what a file controls.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: SEARCH_DOCS,
    description:
      "Search the project's imported engineering documents (datasheets, reference manuals, application notes) for passages relevant to a query. Returns verbatim excerpts WITH a citation to the source document, section, and line - retrieval, not summary. Use this to ground register values, bit fields, timing, electrical limits, addresses, and pinouts in the actual documentation instead of recalling them. If it returns no passage, the fact is simply not in the imported docs: say so rather than inventing a value. The query is enriched with the project's own devices, so a question like 'the I2C sensor' targets the right part's datasheet.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look up in the documents.' },
        k: { type: 'string', description: 'Optional max passages to return (default 5).' }
      },
      required: ['query']
    }
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
2. Ground yourself in reality: get_diagnostics for current errors/warnings, get_project_model for the board, pins, buses, and devices, get_environment for whether the board core and required libraries are actually installed (and what is missing or unverified), get_hardware_graph for how devices, buses, and pins relate, and search_docs to look up register values, bit fields, timing, addresses, and electrical limits in the project's imported datasheets. Trust what these report; do not assume a library or device is present unless a tool confirms it. Prefer search_docs over recalling a datasheet fact, cite the document/section/line it returns, and if it returns nothing treat the fact as "not in the imported docs" rather than inventing it.
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
