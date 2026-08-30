import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Settings whose default is a GUESS must default to empty, not to the guess.
 *
 * loadSettings applies a setting with `s.x || get().x`, so a non-empty default
 * is indistinguishable from a deliberate user choice and wins unconditionally.
 * defaultCppCompiler shipped as 'g++' and therefore overwrote the compiler that
 * detection had correctly chosen; on a machine with clang++ and no g++ the
 * simulator then failed with a bare "spawn g++ ENOENT". ai.model had the same
 * shape and the same bug (a Claude model id POSTed to Ollama).
 *
 * Reads source text: settingsService imports electron for safeStorage, and the
 * test env is node with no electron.
 */

const ROOT = join(__dirname, '..')
const SETTINGS_SRC = readFileSync(join(ROOT, 'src', 'main', 'services', 'settingsService.ts'), 'utf8')
const STORE_SRC = readFileSync(join(ROOT, 'src', 'renderer', 'src', 'store', 'useStore.ts'), 'utf8')

/** The DEFAULTS object literal. */
const defaults = (): string => {
  const start = SETTINGS_SRC.indexOf('const DEFAULTS: Settings = {')
  expect(start, 'DEFAULTS must exist').toBeGreaterThan(-1)
  return SETTINGS_SRC.slice(start, SETTINGS_SRC.indexOf('\n}', start))
}

describe('settings defaults that are guesses are empty', () => {
  const body = defaults()

  it.each([
    ['defaultCppCompiler', 'detection picks the compiler that is actually installed'],
    ['model', 'aiService picks a per-provider default'],
    ['apiKey', 'there is no default key'],
    ['baseUrl', 'there is no default endpoint']
  ])('%s defaults to empty because %s', (key) => {
    expect(body).toMatch(new RegExp(`${key}:\\s*''`))
  })

  // These are real choices with no detectable answer, so a concrete default is
  // correct for them. Pinned so that emptying one is a deliberate act.
  it.each([
    ['theme', "'dark'"],
    ['defaultCppStandard', "'c++23'"],
    ['pythonPath', "'python'"]
  ])('%s keeps its concrete default %s', (key, value) => {
    expect(body).toMatch(new RegExp(`${key}:\\s*${value.replace(/[+]/g, '\\+')}`))
  })
})

describe('loadSettings precedence', () => {
  const load = STORE_SRC.slice(STORE_SRC.indexOf('async loadSettings()'), STORE_SRC.indexOf('async updateSettings('))

  // The `|| get().x` shape is what makes an empty default mean "keep whatever
  // detection found". It only works while the default is empty.
  it('falls back to the live value when a setting is empty', () => {
    expect(load).toContain('s.defaultCppCompiler || get().compiler')
  })

  it('does not overwrite the detected compiler with a hardcoded one', () => {
    expect(load).not.toMatch(/compiler:\s*'g\+\+'/)
  })
})

describe('host C++ detection has one definition', () => {
  it('no service keeps its own copy of the host-compiler predicate', () => {
    const service = readFileSync(join(ROOT, 'src', 'main', 'services', 'toolchainService.ts'), 'utf8')
    // toolchainService may CLASSIFY probes by kind, but it must not decide which
    // compiler the simulator can use: that is isHostCpp in shared/security.
    expect(service).not.toContain("chains.find((t) => t.kind === 'cpp' && t.available)")
  })

  it('the store guards on isHostCpp, not on the kind label', () => {
    expect(STORE_SRC).toContain('isHostCpp')
    expect(STORE_SRC).not.toContain("t.kind === 'cpp' && t.available")
  })
})
