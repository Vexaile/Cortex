import { useEffect, useRef, useState } from 'react'
import { RotateCw, TerminalSquare } from 'lucide-react'
import { terminal, type TerminalStatus } from '../terminal/terminalController'
import { useStore } from '../store/useStore'

/**
 * Hosts the integrated terminal. The heavy lifting (the xterm instance, the pty
 * session, scrollback) lives in the module-level controller so it survives this
 * component unmounting on a tab or panel switch; this component only mounts the
 * controller's view into the DOM, keeps it fitted, and surfaces status.
 */
export default function TerminalPanel({ active }: { active: boolean }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(active)
  const [status, setStatus] = useState<TerminalStatus>(terminal.status)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    terminal.attach(host)
    const off = terminal.onStatus(() => {
      setStatus(terminal.status)
      // A workspace switch disposes the shell (status -> idle). If this is the
      // visible terminal and a workspace is open, spawn a fresh shell in the new
      // project. Guarded on an open workspace so closing to Welcome (which also
      // disposes) does not spawn a stray shell in the home directory.
      if (terminal.status === 'idle' && activeRef.current && useStore.getState().workspaceRoot) {
        terminal.attach(host)
      }
    })
    const ro = new ResizeObserver(() => terminal.fitAndResize())
    ro.observe(host)
    setStatus(terminal.status)
    return () => {
      ro.disconnect()
      off()
    }
  }, [])

  // Becoming the active tab: the container was display:none (zero-size, so the
  // pty could not be fitted). attach() re-fits and, if the shell was torn down,
  // starts a fresh one; then focus so the user can type immediately.
  useEffect(() => {
    activeRef.current = active
    if (!active) return
    const host = hostRef.current
    if (host) terminal.attach(host)
    const id = requestAnimationFrame(() => {
      terminal.fitAndResize()
      terminal.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [active])

  return (
    <div className="relative flex h-full flex-col bg-ide-bg">
      {(status === 'exited' || status === 'unavailable') && (
        <div className="row shrink-0 items-center gap-2 border-b border-ide-border bg-ide-panel px-3 py-1 text-[11px] text-ide-muted">
          <TerminalSquare size={13} className="text-ide-faint" />
          <span className="min-w-0 flex-1 truncate">
            {status === 'unavailable'
              ? terminal.error || 'The terminal backend is unavailable on this machine.'
              : 'The shell exited.'}
          </span>
          {status !== 'unavailable' && (
            <button
              className="btn shrink-0 whitespace-nowrap border border-ide-border text-[11px]"
              onClick={() => void terminal.restart()}
              title="Start a new shell"
            >
              <RotateCw size={12} /> Restart
            </button>
          )}
        </div>
      )}
      {/* xterm mounts its own canvas/DOM into this host via the controller. */}
      <div ref={hostRef} className="min-h-0 flex-1 px-2 py-1" />
    </div>
  )
}
