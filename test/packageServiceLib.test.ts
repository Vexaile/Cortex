import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards that packageService.normalizeLib surfaces the fields the Intelligent
 * Dependency System depends on. packageService imports Electron and child_process
 * so it cannot be imported under node; this asserts on the source, the same
 * approach as the store tests. The real arduino-cli JSON shape (verified: `lib
 * list` returns library.provides_includes and library.architectures) is
 * exercised end-to-end by the environment panel's live check.
 */
const SRC = readFileSync(join(__dirname, '..', 'src', 'main', 'services', 'packageService.ts'), 'utf8')

describe('normalizeLib surfaces provides_includes for the dependency engine', () => {
  const body = SRC.slice(SRC.indexOf('function normalizeLib('), SRC.indexOf('export async function libSearch'))

  it('reads library.provides_includes into providesIncludes', () => {
    expect(body).toContain('provides_includes')
    expect(body).toMatch(/providesIncludes:/)
  })

  it('reads library.architectures', () => {
    expect(body).toMatch(/architectures:/)
  })

  it('filters to strings so a malformed CLI entry cannot inject a non-string header', () => {
    expect(body).toMatch(/typeof h === 'string'/)
  })
})
