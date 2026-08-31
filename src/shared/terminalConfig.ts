/**
 * Pure, dependency-free helpers for the integrated terminal, split out from the
 * pty service so they are unit-testable without spawning a shell or reaching for
 * Electron. The service composes these; nothing here touches a process.
 */

/** Most terminals a single window may hold at once. A cap keeps a runaway loop
 *  (or a stuck renderer) from spawning unbounded shells. */
export const MAX_TERMINALS = 8

/**
 * Clamp a terminal dimension (cols/rows) to a sane positive integer. The
 * renderer measures these from the DOM, so a detached/zero-size container or a
 * bad number must never reach pty.resize as NaN, 0, or something enormous.
 */
export function clampDim(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback
  const i = Math.floor(n)
  if (i < 1) return 1
  if (i > 1000) return 1000
  return i
}

export interface ShellChoice {
  /** The shell binary to spawn. */
  file: string
  /** argv for the shell. The pty spawns file + args directly (never a shell
   *  string), so nothing here is interpolated into a command line. */
  args: string[]
}

/**
 * Pick the interactive shell for this OS. On Windows, PowerShell is a better
 * default for an embedded IDE than cmd.exe and is present on every Win10/11; on
 * posix, honor $SHELL, then bash, then sh. CORTEX_SHELL overrides in either
 * case (a user's own env var, so user-authorized like $SHELL itself).
 */
export function pickShell(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>
): ShellChoice {
  if (platform === 'win32') {
    return { file: env.CORTEX_SHELL || 'powershell.exe', args: [] }
  }
  return { file: env.CORTEX_SHELL || env.SHELL || '/bin/bash', args: [] }
}
