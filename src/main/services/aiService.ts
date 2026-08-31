import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import { getSettings } from './settingsService'
import ENGINEER_GUIDE from '../prompts/embedded-engineer.md?raw'

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiRequest {
  id: string
  messages: AiMessage[]
  /** Optional file/selection context the renderer attaches. */
  context?: string
}

// The same senior-embedded-engineer operating manual the agent runs on, plus a
// note that the chat panel has no tools. One source of truth for both surfaces.
const EMBEDDED_SYSTEM_PROMPT = `${ENGINEER_GUIDE}

---

You are answering in the Cortex chat panel. You have no tools here, so reason from what the user shows you and ask for a file, an error, or a config value when you need it rather than guessing. Be concise and concrete; prefer a focused snippet or diff over a full rewrite.`

function stream(win: BrowserWindow, id: string, delta: string, done: boolean, error?: string): void {
  if (!win.isDestroyed()) {
    win.webContents.send(IPC.AI_STREAM, { id, delta, done, error })
  }
}

/**
 * Streams a completion to the renderer. Uses the Anthropic Messages API when a
 * key/provider is configured; otherwise returns a helpful offline stub so the
 * panel is usable before the user wires up a provider.
 */
/** Each provider speaks its own model ids; never send one provider's id to another. */
const DEFAULT_MODEL: Record<string, string> = {
  anthropic: 'claude-opus-4-8',
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
  local: 'llama3.1',
  custom: ''
}

export async function complete(win: BrowserWindow, req: AiRequest): Promise<void> {
  const settings = await getSettings()
  const { provider, apiKey, baseUrl } = settings.ai
  const model = settings.ai.model || DEFAULT_MODEL[provider] || ''

  // A local endpoint (Ollama / LM Studio) needs no key: that is the whole point.
  if (provider === 'none' || (!apiKey && provider !== 'local')) {
    const stub =
      'The AI panel is not yet connected to a provider.\n\n' +
      'Open Settings and set an AI provider + API key (Anthropic or OpenAI), ' +
      'or point it at a local model endpoint.\n\n' +
      'Once configured, this assistant is tuned for embedded work - ask it to ' +
      'analyze firmware for stack overflows, race conditions, long ISRs, DMA ' +
      'misuse, or to generate a peripheral driver.'
    for (const word of stub.split(' ')) stream(win, req.id, word + ' ', false)
    stream(win, req.id, '', true)
    return
  }

  try {
    if (provider === 'anthropic') {
      await streamAnthropic(win, req, apiKey, model, baseUrl)
    } else if (provider === 'gemini') {
      await streamGemini(win, req, apiKey, model, baseUrl)
    } else {
      // openai, local, or custom: any OpenAI-compatible /v1/chat/completions endpoint
      await streamOpenAiCompatible(win, req, apiKey, model, baseUrl, provider)
    }
  } catch (err) {
    stream(win, req.id, '', true, String(err))
  }
}

async function streamGemini(
  win: BrowserWindow,
  req: AiRequest,
  apiKey: string,
  model: string,
  baseUrl: string
): Promise<void> {
  const base = baseUrl || 'https://generativelanguage.googleapis.com'
  const mdl = model || 'gemini-2.5-flash'
  const url = `${base}/v1beta/models/${mdl}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`
  const contents = req.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }))
  if (req.context) contents.unshift({ role: 'user', parts: [{ text: `Context:\n\n${req.context}` }] })
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: EMBEDDED_SYSTEM_PROMPT }] },
      contents
    })
  })
  if (!res.ok || !res.body) {
    throw new Error(`Gemini API error ${res.status}: ${await res.text()}`)
  }
  await pumpSse(res.body, (json) => {
    const parts = json.candidates?.[0]?.content?.parts
    if (Array.isArray(parts)) {
      for (const p of parts) if (p?.text) stream(win, req.id, p.text, false)
    }
  })
  stream(win, req.id, '', true)
}

async function streamAnthropic(
  win: BrowserWindow,
  req: AiRequest,
  apiKey: string,
  model: string,
  baseUrl: string
): Promise<void> {
  const url = (baseUrl || 'https://api.anthropic.com') + '/v1/messages'
  const messages = req.messages.map((m) => ({ role: m.role, content: m.content }))
  if (req.context) {
    messages.unshift({ role: 'user', content: `Context:\n\n${req.context}` })
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: EMBEDDED_SYSTEM_PROMPT,
      stream: true,
      messages
    })
  })
  if (!res.ok || !res.body) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`)
  }
  await pumpSse(res.body, (json) => {
    if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
      stream(win, req.id, json.delta.text, false)
    }
  })
  stream(win, req.id, '', true)
}

async function streamOpenAiCompatible(
  win: BrowserWindow,
  req: AiRequest,
  apiKey: string,
  model: string,
  baseUrl: string,
  provider: 'openai' | 'local' | 'custom'
): Promise<void> {
  const url =
    (baseUrl || (provider === 'openai' ? 'https://api.openai.com' : 'http://localhost:11434')) +
    '/v1/chat/completions'
  const messages = [
    { role: 'system', content: EMBEDDED_SYSTEM_PROMPT },
    ...(req.context ? [{ role: 'system' as const, content: `Context:\n\n${req.context}` }] : []),
    ...req.messages
  ]
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, stream: true, messages })
  })
  if (!res.ok || !res.body) {
    throw new Error(`AI API error ${res.status}: ${await res.text()}`)
  }
  await pumpSse(res.body, (json) => {
    const delta = json.choices?.[0]?.delta?.content
    if (delta) stream(win, req.id, delta, false)
  })
  stream(win, req.id, '', true)
}

/** Parse a Server-Sent-Events stream, invoking cb with each JSON data payload. */
async function pumpSse(
  body: ReadableStream<Uint8Array>,
  cb: (json: Record<string, unknown> & { [k: string]: any }) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]' || payload === '') continue
      try {
        cb(JSON.parse(payload))
      } catch {
        /* ignore partial/non-JSON keepalives */
      }
    }
  }
}
