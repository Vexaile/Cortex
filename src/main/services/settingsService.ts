import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { DEFAULT_BOARD_URLS } from '../../shared/boardUrls'

export interface Settings {
  theme: 'dark' | 'light'
  defaultCppCompiler: string
  defaultCppStandard: string
  pythonPath: string
  ai: {
    provider: 'anthropic' | 'openai' | 'gemini' | 'local' | 'custom' | 'none'
    model: string
    apiKey: string // decrypted, main-process only. Never sent to the renderer.
    baseUrl: string
  }
  serial: {
    baudRate: number
  }
  boards: {
    /** Extra arduino-cli board-manager index URLs (the "Additional Boards
     *  Manager URLs" of the Arduino IDE). Without the ESP32/ESP8266 index here,
     *  arduino-cli cannot see or install those cores. */
    additionalUrls: string[]
  }
}

/** Renderer-facing settings: the raw key is redacted, replaced by a boolean. */
export interface PublicSettings extends Omit<Settings, 'ai'> {
  ai: Omit<Settings['ai'], 'apiKey'> & { apiKey: ''; apiKeySet: boolean }
}

const DEFAULTS: Settings = {
  theme: 'dark',
  // Empty means "whatever detection found", like ai.model below. 'g++' here was
  // a guess that behaved like an explicit user override: loadSettings applied it
  // unconditionally (it is truthy), so on a machine with clang++ and no g++ it
  // could overwrite the compiler detection had correctly chosen, and the sim
  // then failed with a bare "spawn g++ ENOENT".
  defaultCppCompiler: '',
  defaultCppStandard: 'c++23',
  pythonPath: 'python',
  // model is intentionally empty: a hardcoded Claude id was being POSTed to
  // Ollama the moment someone picked the local provider. aiService fills in a
  // per-provider default when this is blank.
  ai: { provider: 'none', model: '', apiKey: '', baseUrl: '' },
  serial: { baudRate: 115200 },
  // Pre-seeded so ESP32 works out of the box: an ESP32-focused IDE that could
  // not install the ESP32 core without the user first hunting down an index URL
  // was the single most common first-run wall in the audit.
  boards: { additionalUrls: [...DEFAULT_BOARD_URLS] }
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cached: Settings | null = null

function decryptStored(stored: string, encrypted: boolean): string {
  if (!stored) return ''
  if (encrypted) {
    try {
      if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      /* corrupt/unreadable ciphertext */
    }
    return ''
  }
  return stored
}

/** Full settings including the decrypted API key. Main-process use only. */
export async function getSettings(): Promise<Settings> {
  if (cached) return cached
  let next: Settings = { ...DEFAULTS, ai: { ...DEFAULTS.ai }, serial: { ...DEFAULTS.serial }, boards: { ...DEFAULTS.boards } }
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8')
    const p = JSON.parse(raw)
    const ai = {
      provider: p.ai?.provider ?? DEFAULTS.ai.provider,
      model: p.ai?.model ?? DEFAULTS.ai.model,
      baseUrl: p.ai?.baseUrl ?? DEFAULTS.ai.baseUrl,
      apiKey: decryptStored(p.ai?.apiKeyStored ?? '', !!p.ai?.apiKeyEncrypted)
    }
    // Migration: an older plaintext apiKey field is honored once, then re-encrypted on next save.
    if (!ai.apiKey && typeof p.ai?.apiKey === 'string') ai.apiKey = p.ai.apiKey
    // Keep only well-formed http(s) URLs from disk. A stored file is only as
    // trustworthy as whatever last wrote it, and these are passed to arduino-cli.
    const storedUrls = Array.isArray(p.boards?.additionalUrls)
      ? (p.boards.additionalUrls as unknown[]).filter((u): u is string => typeof u === 'string')
      : DEFAULTS.boards.additionalUrls
    next = {
      theme: p.theme ?? DEFAULTS.theme,
      defaultCppCompiler: p.defaultCppCompiler ?? DEFAULTS.defaultCppCompiler,
      defaultCppStandard: p.defaultCppStandard ?? DEFAULTS.defaultCppStandard,
      pythonPath: p.pythonPath ?? DEFAULTS.pythonPath,
      ai,
      serial: { ...DEFAULTS.serial, ...p.serial },
      boards: { additionalUrls: storedUrls }
    }
  } catch {
    /* no file yet: defaults */
  }
  cached = next
  return next
}

/** Redacted settings for the renderer (never carries the raw key). */
export async function getPublicSettings(): Promise<PublicSettings> {
  const s = await getSettings()
  return { ...s, ai: { provider: s.ai.provider, model: s.ai.model, baseUrl: s.ai.baseUrl, apiKey: '', apiKeySet: !!s.ai.apiKey } }
}

export async function setSettings(patch: Partial<Settings>): Promise<PublicSettings> {
  const current = await getSettings()
  const mergedAi = { ...current.ai, ...patch.ai }
  // An empty incoming apiKey means "leave the stored key unchanged" (the renderer
  // never receives the real key, so it echoes back an empty one on other edits).
  const incoming = patch.ai?.apiKey
  mergedAi.apiKey = typeof incoming === 'string' && incoming.trim() !== '' ? incoming : current.ai.apiKey

  const next: Settings = {
    ...current,
    ...patch,
    ai: mergedAi,
    serial: { ...current.serial, ...patch.serial },
    boards: { ...current.boards, ...patch.boards }
  }
  cached = next

  const persistedAi: Record<string, unknown> = {
    provider: next.ai.provider,
    model: next.ai.model,
    baseUrl: next.ai.baseUrl
  }
  if (next.ai.apiKey) {
    if (safeStorage.isEncryptionAvailable()) {
      persistedAi.apiKeyStored = safeStorage.encryptString(next.ai.apiKey).toString('base64')
      persistedAi.apiKeyEncrypted = true
    } else {
      // Best effort: no OS keyring available (e.g. some Linux setups).
      persistedAi.apiKeyStored = next.ai.apiKey
      persistedAi.apiKeyEncrypted = false
    }
  }

  const persisted = {
    theme: next.theme,
    defaultCppCompiler: next.defaultCppCompiler,
    defaultCppStandard: next.defaultCppStandard,
    pythonPath: next.pythonPath,
    ai: persistedAi,
    serial: next.serial,
    boards: next.boards
  }
  await fs.writeFile(settingsPath(), JSON.stringify(persisted, null, 2), 'utf8')
  return getPublicSettings()
}
