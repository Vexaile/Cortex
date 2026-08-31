import { describe, it, expect } from 'vitest'
import {
  AGENT_TOOLS,
  MUTATION_TOOLS,
  PROPOSE_EDIT,
  READ_FILE,
  toAnthropicTools,
  toOpenAiTools,
  parseStructuredProposal
} from '../src/shared/agentTools'

describe('agent tool contract', () => {
  it('marks only propose_edit as a mutation', () => {
    expect(MUTATION_TOOLS.has(PROPOSE_EDIT)).toBe(true)
    expect(MUTATION_TOOLS.has(READ_FILE)).toBe(false)
    expect(MUTATION_TOOLS.size).toBe(1)
  })

  it('translates to Anthropic tool shape with input_schema', () => {
    const tools = toAnthropicTools()
    const edit = tools.find((t) => t.name === PROPOSE_EDIT)
    expect(edit).toBeTruthy()
    expect(edit!.input_schema.required).toContain('new_content')
    expect(tools.length).toBe(AGENT_TOOLS.length)
  })

  it('translates to OpenAI function-tool shape with parameters', () => {
    const tools = toOpenAiTools()
    const read = tools.find((t) => t.function.name === READ_FILE)
    expect(read).toBeTruthy()
    expect(read!.type).toBe('function')
    expect(read!.function.parameters.required).toContain('path')
  })
})

describe('parseStructuredProposal (fallback)', () => {
  it('parses a clean object', () => {
    const p = parseStructuredProposal('{"answer":"done","edits":[{"path":"a.c","new_content":"int x;","summary":"add x"}]}')
    expect(p).toBeTruthy()
    expect(p!.answer).toBe('done')
    expect(p!.edits).toHaveLength(1)
    expect(p!.edits[0].path).toBe('a.c')
  })

  it('extracts JSON wrapped in a code fence and prose', () => {
    const text = 'Sure, here is the change:\n```json\n{"answer":"ok","edits":[]}\n```\nHope that helps.'
    const p = parseStructuredProposal(text)
    expect(p).toBeTruthy()
    expect(p!.answer).toBe('ok')
    expect(p!.edits).toEqual([])
  })

  it('is not fooled by braces inside strings', () => {
    const p = parseStructuredProposal('{"answer":"use { and } carefully","edits":[]}')
    expect(p).toBeTruthy()
    expect(p!.answer).toBe('use { and } carefully')
  })

  it('drops malformed edit entries but keeps valid ones', () => {
    const p = parseStructuredProposal(
      '{"answer":"x","edits":[{"path":"a.c","new_content":"y"},{"path":"b.c"},{"foo":1}]}'
    )
    expect(p!.edits).toHaveLength(1)
    expect(p!.edits[0].path).toBe('a.c')
  })

  it('returns null when there is no JSON object', () => {
    expect(parseStructuredProposal('just a plain sentence, no json here')).toBeNull()
  })

  it('returns null for empty answer and no edits', () => {
    expect(parseStructuredProposal('{"answer":"","edits":[]}')).toBeNull()
  })
})
