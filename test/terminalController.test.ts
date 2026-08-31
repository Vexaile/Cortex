import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards the terminal controller's supersession logic and the terminal entry
 * points, both found by review. The controller imports xterm (and the store
 * reaches for window), so these assert on source text like the other renderer
 * tests.
 *
 * The race: start() awaits an async create() before it can assign the session
 * id, so a dispose() during that window (a workspace switch or close) cannot
 * kill the not-yet-known pty. Without a supersession check the resumed start()
 * would adopt an orphaned shell (a stray shell on close) or, combined with the
 * respawn path, double-spawn (a leaked pty feeding the same terminal). The fix
 * is an epoch captured before the await and re-checked after it.
 */

const CTRL = readFileSync(
  join(__dirname, '..', 'src', 'renderer', 'src', 'terminal', 'terminalController.ts'),
  'utf8'
)
const STORE = readFileSync(join(__dirname, '..', 'src', 'renderer', 'src', 'store', 'useStore.ts'), 'utf8')

describe('terminal controller supersession', () => {
  const start = CTRL.slice(CTRL.indexOf('private async start('), CTRL.indexOf('private handleExit('))

  it('captures an epoch before the async create', () => {
    const cap = start.indexOf('++this.epoch')
    const create = start.indexOf('await window.api.terminal.create')
    expect(cap).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(-1)
    expect(cap, 'the epoch must be captured before the create() await').toBeLessThan(create)
  })

  it('bails and kills the orphaned pty when superseded after the await', () => {
    const create = start.indexOf('await window.api.terminal.create')
    const after = start.slice(create)
    expect(after).toMatch(/gen !== this\.epoch/)
    // The just-spawned pty is killed rather than adopted.
    expect(after).toMatch(/window\.api\.terminal\.kill\(id\)/)
    // The supersession check comes before the session is committed.
    expect(after.indexOf('gen !== this.epoch')).toBeLessThan(after.indexOf('this.sessionId = id'))
  })

  it('dispose bumps the epoch so an in-flight start is superseded', () => {
    const dispose = CTRL.slice(CTRL.indexOf('dispose(): void'))
    expect(dispose).toMatch(/this\.epoch\+\+/)
  })
})

describe('openTerminal removes the dead ends', () => {
  const body = STORE.slice(STORE.indexOf('openTerminal()'), STORE.indexOf('toggleBottom()'))

  it('requires an open workspace', () => {
    expect(body).toContain('if (!get().workspaceRoot) return')
  })

  it('leaves the simulator view and shows the terminal', () => {
    expect(body).toMatch(/mainView: 'editor'/)
    expect(body).toMatch(/bottomView: 'terminal'/)
    expect(body).toMatch(/bottomVisible: true/)
  })
})
