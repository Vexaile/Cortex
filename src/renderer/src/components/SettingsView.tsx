import { useEffect, useRef, useState } from 'react'
import { RefreshCw, CheckCircle2, XCircle, X, Plus } from 'lucide-react'
import { useStore } from '../store/useStore'
import { isValidIndexUrl } from '@shared/boardUrls'
import type { ToolchainInfo } from '@shared/ipc'

const KIND_LABEL: Record<ToolchainInfo['kind'], string> = {
  cpp: 'C / C++',
  c: 'C / C++',
  embedded: 'Embedded toolchains',
  python: 'Python',
  rust: 'Rust',
  node: 'JavaScript',
  cmake: 'Build Systems',
  other: 'CLI & Tools'
}

type Category = 'appearance' | 'build' | 'ai' | 'boards' | 'diagnostics'
const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'build', label: 'Build' },
  { id: 'ai', label: 'AI' },
  { id: 'boards', label: 'Board Manager' },
  { id: 'diagnostics', label: 'Diagnostics' }
]

const input =
  'w-full rounded border border-ide-border bg-ide-bg px-2 py-1.5 text-[12px] text-ide-text outline-none focus:border-ide-accent'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ide-text">{label}</span>
      {hint && <span className="mb-1.5 block text-[11px] leading-relaxed text-ide-faint">{hint}</span>}
      {children}
    </label>
  )
}

/**
 * A text field that commits on blur/Enter instead of on every keystroke.
 * Binding these straight to updateSettings made each character an IPC round-trip
 * plus a settings.json write.
 */
function DraftInput({
  value,
  onCommit,
  placeholder
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
}): JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      className={input}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setDraft(value)
      }}
    />
  )
}

function CategoryTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return <h2 className="text-[16px] font-semibold text-ide-text">{children}</h2>
}

/**
 * Settings as a full editor-area surface: a category nav on the left and a wide
 * content pane. It replaces the cramped sidebar panel; every entry point
 * (left rail, title bar, Ctrl+comma, palette) opens this view. All wiring is the
 * same as before - the API key is saved through the main process and never sent
 * back to the renderer.
 */
export default function SettingsView(): JSX.Element {
  const { settings, loadSettings, updateSettings, setTheme, compiler, toolchains, detectToolchains, setMainView } =
    useStore()
  const [cat, setCat] = useState<Category>('appearance')
  // The content pane is one persistent scroll container, so a tall category
  // switched to another tall one would open mid-page; reset it each change.
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0
  }, [cat])
  const [rescanning, setRescanning] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')

  const rescan = async (): Promise<void> => {
    setRescanning(true)
    await detectToolchains(true)
    setRescanning(false)
  }

  const boardUrls = settings?.boards?.additionalUrls ?? []
  // Read the current array from the store (not the render closure) so two quick
  // edits before the async save resolves do not clobber each other.
  const currentUrls = (): string[] => useStore.getState().settings?.boards?.additionalUrls ?? []
  const addBoardUrl = (): void => {
    const u = urlDraft.trim()
    if (!isValidIndexUrl(u)) return // not a valid http(s) index URL: ignore rather than persist garbage
    const urls = currentUrls()
    if (!urls.includes(u)) void updateSettings({ boards: { additionalUrls: [...urls, u] } })
    setUrlDraft('')
  }
  const removeBoardUrl = (u: string): void => {
    void updateSettings({ boards: { additionalUrls: currentUrls().filter((x) => x !== u) } })
  }
  const saveKey = (): void => {
    if (!settings || !keyDraft.trim()) return
    void updateSettings({ ai: { ...settings.ai, apiKey: keyDraft } }).then(() => {
      setKeyDraft('')
      setKeySaved(true)
    })
  }

  useEffect(() => {
    if (!settings) void loadSettings()
  }, [settings, loadSettings])

  const toolGroups = new Map<string, ToolchainInfo[]>()
  for (const t of toolchains) {
    const g = KIND_LABEL[t.kind]
    if (!toolGroups.has(g)) toolGroups.set(g, [])
    toolGroups.get(g)!.push(t)
  }

  const body = (): JSX.Element => {
    if (!settings) return <div className="text-[12px] text-ide-faint">Loading settings...</div>
    switch (cat) {
      case 'appearance':
        return (
          <>
            <CategoryTitle>Appearance</CategoryTitle>
            <Field label="Theme">
              {/* Segmented toggle rather than a select: two mutually-exclusive
                  choices read faster as buttons, and it previews the switch. */}
              <div
                className="row w-56 gap-1 rounded border border-ide-border bg-ide-bg p-0.5"
                role="group"
                aria-label="Theme"
              >
                {(['dark', 'light'] as const).map((t) => {
                  const active = (settings.theme ?? 'dark') === t
                  return (
                    <button
                      key={t}
                      className={`flex-1 rounded px-2 py-1 text-[12px] capitalize transition-colors ${
                        active ? 'bg-ide-accent text-white' : 'text-ide-muted hover:bg-ide-hover hover:text-ide-text'
                      }`}
                      aria-pressed={active}
                      onClick={() => !active && void setTheme(t)}
                    >
                      {t}
                    </button>
                  )
                })}
              </div>
            </Field>
          </>
        )
      case 'build':
        return (
          <>
            <CategoryTitle>Build</CategoryTitle>
            <Field label="Default C++ compiler" hint="Used when a project has not pinned one of its own.">
              <DraftInput
                value={settings.defaultCppCompiler}
                placeholder={compiler ? `auto: ${compiler}` : 'auto-detect'}
                onCommit={(v) => void updateSettings({ defaultCppCompiler: v })}
              />
            </Field>
            <Field label="Default C++ standard">
              <select
                className={input}
                value={settings.defaultCppStandard}
                onChange={(e) => void updateSettings({ defaultCppStandard: e.target.value })}
              >
                {['c++11', 'c++14', 'c++17', 'c++20', 'c++23', 'c++2c'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Python interpreter" hint="Path to the python used to run scripts. Leave blank to auto-detect.">
              <DraftInput value={settings.pythonPath} onCommit={(v) => void updateSettings({ pythonPath: v })} />
            </Field>
          </>
        )
      case 'ai':
        return (
          <>
            <CategoryTitle>AI</CategoryTitle>
            <Field label="Provider">
              <select
                className={input}
                value={settings.ai.provider}
                // Clear the model on provider change: keeping the old id sends e.g.
                // a Claude id to Ollama, which 404s on the one path needing no key.
                onChange={(e) =>
                  void updateSettings({ ai: { ...settings.ai, provider: e.target.value as never, model: '' } })
                }
              >
                <option value="none">None (offline)</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT)</option>
                <option value="gemini">Google (Gemini)</option>
                <option value="local">Local (Ollama / LM Studio)</option>
                <option value="custom">Custom (OpenAI-compatible)</option>
              </select>
            </Field>
            <Field label="Model">
              <DraftInput
                value={settings.ai.model}
                placeholder={
                  {
                    anthropic: 'claude-opus-4-8',
                    openai: 'gpt-4o',
                    gemini: 'gemini-2.5-flash',
                    local: 'llama3.1',
                    custom: 'model id',
                    none: ''
                  }[settings.ai.provider]
                }
                onCommit={(v) => void updateSettings({ ai: { ...settings.ai, model: v } })}
              />
            </Field>
            <Field label="API key">
              <div className="row gap-1.5">
                <input
                  type="password"
                  className={input}
                  placeholder={settings.ai.apiKeySet ? 'saved. type a new key to replace' : 'paste your key'}
                  value={keyDraft}
                  onChange={(e) => {
                    setKeyDraft(e.target.value)
                    setKeySaved(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && keyDraft.trim()) saveKey()
                  }}
                />
                <button className="btn btn-accent shrink-0 text-[12px] disabled:opacity-40" disabled={!keyDraft.trim()} onClick={saveKey}>
                  Save
                </button>
              </div>
              {(keySaved || settings.ai.apiKeySet) && !keyDraft && (
                <span className="mt-1 block text-[11px] text-ide-moss">Key saved and encrypted.</span>
              )}
            </Field>
            <Field label="Base URL (optional)">
              <DraftInput
                value={settings.ai.baseUrl}
                placeholder="e.g. http://localhost:11434 for Ollama"
                onCommit={(v) => void updateSettings({ ai: { ...settings.ai, baseUrl: v } })}
              />
            </Field>
            <p className="text-[11px] leading-relaxed text-ide-faint">
              The API key is encrypted at rest with your OS keychain (safeStorage) and stays in the main process. It
              never leaves your machine except in requests you initiate to the provider you choose.
            </p>
          </>
        )
      case 'boards':
        return (
          <>
            <CategoryTitle>Board Manager</CategoryTitle>
            <p className="text-[11px] leading-relaxed text-ide-faint">
              Extra package index URLs for the Boards Manager. ESP32 and ESP8266 are included by default. A new URL
              takes effect the next time you search or install a core.
            </p>
            <div className="space-y-1 rounded border border-ide-border bg-ide-bg p-2">
              {boardUrls.length === 0 ? (
                <div className="text-[12px] text-ide-faint">No additional URLs.</div>
              ) : (
                boardUrls.map((u) => (
                  <div key={u} className="row justify-between gap-2 text-[12px]">
                    <span className="mono min-w-0 truncate text-ide-muted" title={u}>
                      {u}
                    </span>
                    <button
                      className="shrink-0 rounded p-0.5 text-ide-faint hover:bg-ide-hover hover:text-ide-text"
                      title="Remove"
                      onClick={() => removeBoardUrl(u)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="row gap-1.5">
              <input
                className={input}
                value={urlDraft}
                placeholder="https://.../package_..._index.json"
                onChange={(e) => setUrlDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addBoardUrl()
                }}
              />
              <button
                className="btn btn-accent row shrink-0 gap-1 text-[12px] disabled:opacity-40"
                disabled={!urlDraft.trim()}
                onClick={addBoardUrl}
              >
                <Plus size={13} /> Add
              </button>
            </div>
          </>
        )
      case 'diagnostics':
        return (
          <>
            <div className="row items-center justify-between">
              <CategoryTitle>Diagnostics</CategoryTitle>
              <button
                className="row gap-1 rounded px-1.5 py-0.5 text-[11px] text-ide-muted hover:bg-ide-hover hover:text-ide-text"
                onClick={rescan}
                title="Rescan your system"
              >
                <RefreshCw size={12} className={rescanning ? 'animate-spin' : ''} /> Rescan
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-ide-faint">
              Read-only: the compilers and tools Cortex detected on this machine.
            </p>
            {toolchains.length === 0 ? (
              <div className="text-[12px] text-ide-faint">Scanning your system...</div>
            ) : (
              <div className="space-y-2 rounded border border-ide-border bg-ide-bg p-3">
                {[...toolGroups.entries()].map(([group, items]) => (
                  <div key={group}>
                    <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ide-faint">{group}</div>
                    {items.map((t) => (
                      <div
                        key={t.id}
                        className="row justify-between gap-2 py-0.5 text-[12px]"
                        title={t.version || 'not found'}
                      >
                        <span className="row min-w-0 gap-1.5">
                          {t.available ? (
                            <CheckCircle2 size={13} className="shrink-0 text-ide-green" />
                          ) : (
                            <XCircle size={13} className="shrink-0 text-ide-faint" />
                          )}
                          <span className={`truncate ${t.available ? 'text-ide-text' : 'text-ide-faint'}`}>{t.name}</span>
                        </span>
                        {t.available && t.version && (
                          <span className="mono shrink-0 truncate text-[10px] text-ide-muted" style={{ maxWidth: 120 }}>
                            {/* First dotted version, so "g++ (Rev2, ...) 14.2.0" reads
                                14.2.0 rather than the "2" inside "Rev2". */}
                            {t.version.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? t.version.split(' ')[0]}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-ide-border bg-ide-bg">
      <div className="row h-9 shrink-0 items-center justify-between border-b border-ide-border bg-ide-panel px-3">
        <span className="text-[12px] font-semibold text-ide-text">Settings</span>
        <button
          className="rounded p-1 text-ide-muted hover:bg-ide-hover hover:text-ide-text"
          onClick={() => setMainView('editor')}
          title="Close settings"
          aria-label="Close settings"
        >
          <X size={15} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 overflow-auto border-r border-ide-border bg-ide-panel p-2" aria-label="Settings categories">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`w-full rounded px-2 py-1.5 text-left text-[12.5px] transition-colors ${
                cat === c.id ? 'bg-ide-active text-ide-text' : 'text-ide-muted hover:bg-ide-hover hover:text-ide-text'
              }`}
              aria-current={cat === c.id}
              onClick={() => setCat(c.id)}
            >
              {c.label}
            </button>
          ))}
        </nav>
        <div ref={contentRef} className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-2xl space-y-4 p-6">{body()}</div>
        </div>
      </div>
    </div>
  )
}
