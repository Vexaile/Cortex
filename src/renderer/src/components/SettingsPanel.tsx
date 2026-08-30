import { useEffect, useState } from 'react'
import { RefreshCw, CheckCircle2, XCircle } from 'lucide-react'
import { useStore } from '../store/useStore'
import PanelHeader from './PanelHeader'
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

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-ide-muted">{label}</span>
      {children}
    </label>
  )
}

const input =
  'w-full rounded bg-ide-bg px-2 py-1.5 text-[12px] text-ide-text outline-none focus:ring-1 focus:ring-ide-accent'

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

export default function SettingsPanel(): JSX.Element {
  const { settings, loadSettings, updateSettings, compiler, toolchains, detectToolchains } = useStore()
  const [rescanning, setRescanning] = useState(false)
  const rescan = async (): Promise<void> => {
    setRescanning(true)
    await detectToolchains(true)
    setRescanning(false)
  }
  const toolGroups = new Map<string, ToolchainInfo[]>()
  for (const t of toolchains) {
    const g = KIND_LABEL[t.kind]
    if (!toolGroups.has(g)) toolGroups.set(g, [])
    toolGroups.get(g)!.push(t)
  }
  // The stored key is never sent back to the renderer (it is redacted), so the
  // field must NOT be bound to settings.ai.apiKey: that would round-trip to ''
  // on every keystroke and persist only the last character. Keep a local draft
  // and commit it explicitly.
  const [keyDraft, setKeyDraft] = useState('')
  const [keySaved, setKeySaved] = useState(false)

  useEffect(() => {
    if (!settings) void loadSettings()
  }, [settings, loadSettings])

  if (!settings) return <div className="p-3 text-[12px] text-ide-faint">Loading settings...</div>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader>Settings</PanelHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
        <section className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ide-faint">Build</h4>
          {/* Blank means "use what detection found", so say which one that is
              rather than showing an empty box the user has to guess about. */}
          <Field label="Default C++ compiler">
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
          <Field label="Python interpreter">
            <DraftInput value={settings.pythonPath} onCommit={(v) => void updateSettings({ pythonPath: v })} />
          </Field>
        </section>

        <section className="space-y-2">
          <div className="row items-center justify-between">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ide-faint">Detected toolchains</h4>
            <button
              className="row gap-1 rounded px-1 py-0.5 text-[10px] text-ide-muted hover:bg-ide-hover hover:text-ide-text"
              onClick={rescan}
              title="Rescan your system"
            >
              <RefreshCw size={11} className={rescanning ? 'animate-spin' : ''} /> Rescan
            </button>
          </div>
          {toolchains.length === 0 ? (
            <div className="text-[11px] text-ide-faint">Scanning your system...</div>
          ) : (
            <div className="space-y-2 rounded border border-ide-border bg-ide-bg p-2">
              {[...toolGroups.entries()].map(([group, items]) => (
                <div key={group}>
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ide-faint">{group}</div>
                  {items.map((t) => (
                    <div key={t.id} className="row justify-between gap-2 py-0.5 text-[11px]" title={t.version || 'not found'}>
                      <span className="row min-w-0 gap-1.5">
                        {t.available ? (
                          <CheckCircle2 size={12} className="shrink-0 text-ide-green" />
                        ) : (
                          <XCircle size={12} className="shrink-0 text-ide-faint" />
                        )}
                        <span className={`truncate ${t.available ? 'text-ide-text' : 'text-ide-faint'}`}>{t.name}</span>
                      </span>
                      {t.available && t.version && (
                        <span className="mono shrink-0 truncate text-[10px] text-ide-muted" style={{ maxWidth: 84 }}>
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
        </section>

        <section className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ide-faint">AI Assistant</h4>
          <Field label="Provider">
            <select
              className={input}
              value={settings.ai.provider}
              // Clear the model on provider change: keeping the old id sends e.g.
              // a Claude id to Ollama, which 404s on the one path needing no key.
              onChange={(e) => void updateSettings({ ai: { ...settings.ai, provider: e.target.value as never, model: '' } })}
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
                  if (e.key === 'Enter' && keyDraft.trim()) {
                    void updateSettings({ ai: { ...settings.ai, apiKey: keyDraft } }).then(() => {
                      setKeyDraft('')
                      setKeySaved(true)
                    })
                  }
                }}
              />
              <button
                className="btn btn-accent shrink-0 text-[11px] disabled:opacity-40"
                disabled={!keyDraft.trim()}
                onClick={() =>
                  void updateSettings({ ai: { ...settings.ai, apiKey: keyDraft } }).then(() => {
                    setKeyDraft('')
                    setKeySaved(true)
                  })
                }
              >
                Save
              </button>
            </div>
            {(keySaved || settings.ai.apiKeySet) && !keyDraft && (
              <span className="mt-1 block text-[10px] text-ide-moss">Key saved and encrypted.</span>
            )}
          </Field>
          <Field label="Base URL (optional)">
            <DraftInput
              value={settings.ai.baseUrl}
              placeholder="e.g. http://localhost:11434 for Ollama"
              onCommit={(v) => void updateSettings({ ai: { ...settings.ai, baseUrl: v } })}
            />
          </Field>
        </section>

        <p className="text-[10px] leading-relaxed text-ide-faint">
          Settings live in <span className="mono">settings.json</span> in your user data folder. The API key is
          encrypted at rest with your OS keychain (safeStorage) and stays in the main process. It never leaves your
          machine except in requests you initiate to the provider you choose.
        </p>
      </div>
    </div>
  )
}
