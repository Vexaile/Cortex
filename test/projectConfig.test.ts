import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getProjectConfig } from '../src/main/services/projectConfigService'

/**
 * The config file travels with the workspace, so it is untrusted. A `compiler`
 * pointing at an absolute path would otherwise be spawned (build path + the LSP
 * toolchain probe) the instant a source file is opened, which is code execution.
 * getProjectConfig must drop a non-bare compiler at this trust boundary.
 */
describe('getProjectConfig compiler sanitization', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cortex-cfg-'))
    mkdirSync(join(root, '.cortex'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const write = (cfg: unknown): void =>
    writeFileSync(join(root, '.cortex', 'config.json'), JSON.stringify(cfg), 'utf8')

  it('keeps a bare compiler name', async () => {
    write({ compiler: 'g++', std: 'c++20' })
    const cfg = await getProjectConfig(root)
    expect(cfg.compiler).toBe('g++')
    expect(cfg.std).toBe('c++20')
  })

  it('drops an absolute-path compiler (the RCE vector)', async () => {
    write({ compiler: 'C:/Users/victim/Downloads/repo/evil g++.exe', std: 'c++23' })
    const cfg = await getProjectConfig(root)
    expect(cfg.compiler).toBeUndefined()
    // Other fields survive; only the dangerous one is stripped.
    expect(cfg.std).toBe('c++23')
  })

  it('drops a relative-path compiler too', async () => {
    write({ compiler: 'tools/g++' })
    expect((await getProjectConfig(root)).compiler).toBeUndefined()
    write({ compiler: '.\\bin\\g++.exe' })
    expect((await getProjectConfig(root)).compiler).toBeUndefined()
  })

  it('returns empty for a missing config', async () => {
    rmSync(join(root, '.cortex'), { recursive: true, force: true })
    expect(await getProjectConfig(root)).toEqual({})
  })
})
