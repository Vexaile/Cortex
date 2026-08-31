import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/**
 * Owns the single integrated-terminal view (an xterm.js Terminal) and its pty
 * session, OUTSIDE the React tree. The bottom dock unmounts on panel-close, a
 * simulator switch, and a bottom-tab switch, and tying the pty to a component
 * would kill a running `pio run` every time the user peeked elsewhere. Instead
 * the xterm instance lives in a persistent wrapper div this controller owns and
 * re-parents into whatever host mounts; the pty lives in the main process. So
 * scrollback and the running shell both survive every unmount.
 */

// Matches the IDE dark palette (see tailwind.config.js `ide`), so the terminal
// reads as part of Cortex rather than a pasted-in black box.
const THEME = {
  background: '#0C1017',
  foreground: '#E6EBF4',
  cursor: '#E6EBF4',
  cursorAccent: '#0C1017',
  selectionBackground: '#1E3A5F',
  black: '#0C1017',
  red: '#E05561',
  green: '#6FB65A',
  yellow: '#E8B44A',
  blue: '#2E6FE0',
  magenta: '#C58BE6',
  cyan: '#4FB8A8',
  white: '#98A3B6',
  brightBlack: '#7D8899',
  brightRed: '#E05561',
  brightGreen: '#6FB65A',
  brightYellow: '#E8952B',
  brightBlue: '#4F8FF0',
  brightMagenta: '#C58BE6',
  brightCyan: '#4FB8A8',
  brightWhite: '#E6EBF4'
}

export type TerminalStatus = 'idle' | 'starting' | 'running' | 'exited' | 'unavailable'

class TerminalController {
  private term: Terminal | null = null
  private fit: FitAddon | null = null
  private wrapper: HTMLDivElement | null = null
  private sessionId: string | null = null
  /** IPC unsubscribes for the CURRENT session (data + exit). */
  private unsubs: Array<() => void> = []
  /** One-shot "press Enter to restart" listener, tracked so a later restart
   *  disposes it and a stale copy never fires mid-session. */
  private exitKey: IDisposable | null = null
  private starting = false
  /** Bumped whenever the intended session changes (a new start, or a dispose).
   *  start() captures it before the async create() and, if it no longer matches
   *  afterward, kills the just-spawned pty and bails: a workspace switch or close
   *  that fires mid-create would otherwise orphan that shell (dispose cannot kill
   *  a session whose id has not been assigned yet) or double-spawn. */
  private epoch = 0

  status: TerminalStatus = 'idle'
  error: string | null = null
  private listeners = new Set<() => void>()

  /** Subscribe to status changes (for the panel's Restart / unavailable UI). */
  onStatus(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  private emit(): void {
    for (const cb of this.listeners) cb()
  }

  private ensureTerm(): void {
    if (this.term) return
    const wrapper = document.createElement('div')
    wrapper.style.width = '100%'
    wrapper.style.height = '100%'
    this.wrapper = wrapper
    const term = new Terminal({
      theme: THEME,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(wrapper)
    // User keystrokes -> the pty. Guarded on a live session so keys typed while
    // the shell is dead (before restart) are dropped rather than misrouted.
    term.onData((d) => {
      if (this.sessionId) window.api.terminal.input(this.sessionId, d)
    })
    this.term = term
    this.fit = fit
  }

  /** Mount the terminal into `host` (re-parenting the persistent wrapper) and
   *  auto-start the shell the first time it is opened. */
  attach(host: HTMLElement): void {
    this.ensureTerm()
    if (this.wrapper && this.wrapper.parentElement !== host) host.appendChild(this.wrapper)
    // Auto-start only on the very first open. After an exit, the Enter one-shot
    // or the Restart button starts a fresh shell; after 'unavailable' there is
    // nothing to retry.
    if (this.status === 'idle') void this.start()
    requestAnimationFrame(() => this.fitAndResize())
  }

  private async start(): Promise<void> {
    if (this.starting || this.sessionId) return
    this.ensureTerm()
    this.exitKey?.dispose()
    this.exitKey = null
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    this.starting = true
    const gen = ++this.epoch
    this.status = 'starting'
    this.error = null
    this.emit()

    const id = `term-${crypto.randomUUID()}`
    const { cols, rows } = this.dims()
    const res = await window.api.terminal.create({ id, cols, rows })
    // Superseded while create() was in flight (a dispose from a workspace
    // switch/close, or a newer start()). The pty main just spawned is now
    // orphaned, so kill it and leave the current session untouched: touching
    // starting/status/sessionId here would clobber the session that superseded us.
    if (gen !== this.epoch) {
      if (res.ok) window.api.terminal.kill(id)
      return
    }
    this.starting = false
    if (!res.ok) {
      this.status = 'unavailable'
      this.error = res.error
      this.term?.writeln(`\x1b[31m${res.error}\x1b[0m`)
      this.emit()
      return
    }
    this.sessionId = id
    this.status = 'running'
    this.unsubs.push(
      window.api.terminal.onData((c) => {
        if (c.id === id) this.term?.write(c.data)
      }),
      window.api.terminal.onExit((e) => {
        if (e.id === id) this.handleExit(e.exitCode)
      })
    )
    this.emit()
    requestAnimationFrame(() => this.fitAndResize())
  }

  private handleExit(code: number): void {
    this.sessionId = null
    this.status = 'exited'
    this.term?.writeln(
      `\r\n\x1b[90m[process exited with code ${code}]  Press Enter to start a new shell.\x1b[0m`
    )
    this.exitKey?.dispose()
    this.exitKey =
      this.term?.onData((data) => {
        if (data === '\r') void this.restart()
      }) ?? null
    this.emit()
  }

  /** Start a fresh shell after an exit (or on demand from the Restart button). */
  async restart(): Promise<void> {
    if (this.starting) return
    this.term?.clear()
    await this.start()
  }

  private dims(): { cols: number; rows: number } {
    return { cols: this.term?.cols ?? 80, rows: this.term?.rows ?? 24 }
  }

  /** Fit the view to its container and push the new size to the pty. No-op while
   *  the container is hidden or zero-size (fit would throw or compute garbage). */
  fitAndResize(): void {
    const { term, fit, wrapper } = this
    if (!term || !fit || !wrapper) return
    if (wrapper.offsetWidth === 0 || wrapper.offsetHeight === 0) return
    try {
      fit.fit()
    } catch {
      return
    }
    if (this.sessionId) window.api.terminal.resize(this.sessionId, term.cols, term.rows)
  }

  clear(): void {
    this.term?.clear()
  }

  focus(): void {
    this.term?.focus()
  }

  /**
   * Kill the shell and return to a fresh, unstarted state. Called when the
   * workspace is switched or closed: the pty's cwd is the old project, and a
   * shell lingering in a closed folder is stale, so it is torn down like the
   * run/sim/debug processes are. The next time the terminal is opened, attach()
   * spawns a new shell in the new workspace. The xterm view itself is preserved
   * (only its buffer is cleared) so re-opening is instant.
   */
  dispose(): void {
    // Supersede any start() awaiting create(): it will kill its own just-spawned
    // pty instead of adopting it (dispose cannot kill an id that is not assigned
    // yet).
    this.epoch++
    if (this.sessionId) window.api.terminal.kill(this.sessionId)
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    this.exitKey?.dispose()
    this.exitKey = null
    this.sessionId = null
    this.starting = false
    this.status = 'idle'
    this.error = null
    this.term?.clear()
    this.emit()
  }
}

export const terminal = new TerminalController()

// A renderer global (like __cortexStore / __cortexEditor) so the store's
// workspace teardown can dispose the terminal without statically importing this
// module, which would pull xterm into the startup bundle. Undefined until the
// terminal chunk has loaded (i.e. until the terminal was opened at least once),
// so callers use optional chaining and a no-op is correct.
declare global {
  interface Window {
    __cortexTerminal?: TerminalController
  }
}
window.__cortexTerminal = terminal
