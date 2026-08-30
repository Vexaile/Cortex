import { spawn, execFile, ChildProcess } from 'child_process'
import { promisify } from 'util'
import { dirname } from 'path'
import type { BrowserWindow } from 'electron'
import type {
  BoardStatus,
  BoardPort,
  BoardTarget,
  BoardCompileRequest,
  BoardUploadRequest
} from '../../shared/ipc'
import * as runner from './runnerService'
import { safeCommand, needsShell } from './commandResolver'
import { getWorkspaceRoot } from './fsService'

const execFileAsync = promisify(execFile)

const CLI = 'arduino-cli'

/** Is arduino-cli installed and usable? */
export async function status(): Promise<BoardStatus> {
  try {
    const { stdout, stderr } = await execFileAsync(CLI, ['version'], {
      timeout: 6000,
      windowsHide: true
    })
    return { available: true, version: (stdout || stderr).toString().trim().split(/\r?\n/)[0] }
  } catch {
    // Name the tool, what it unlocks, and the exact command, the way the
    // simulator's missing-compiler path does. "Install it" with no command
    // leaves the user to go and find out how.
    return {
      available: false,
      version: '',
      hint:
        'arduino-cli not found. It is what compiles and uploads to a real board ' +
        '(Arduino, ESP32, RP2040). Install it with: winget install ArduinoSA.CLI ' +
        '(or brew install arduino-cli), then press rescan. The Simulator works without it.'
    }
  }
}

interface RawBoard {
  name?: string
  fqbn?: string
  FQBN?: string
}
interface RawPort {
  port?: { address?: string; protocol?: string; label?: string }
  matching_boards?: RawBoard[]
  boards?: RawBoard[] // legacy bare-array shape
  address?: string
  protocol?: string
}

/** Physically connected boards (`arduino-cli board list`). */
export async function listConnected(): Promise<BoardPort[]> {
  try {
    const { stdout } = await execFileAsync(CLI, ['board', 'list', '--format', 'json'], {
      timeout: 12000,
      windowsHide: true
    })
    const parsed = JSON.parse(stdout.toString() || '{}')
    // Newer CLIs: { detected_ports: [...] }. Older: a bare array of ports.
    const list: RawPort[] = Array.isArray(parsed) ? parsed : parsed.detected_ports ?? []
    return list
      .map((entry): BoardPort | null => {
        const address = entry.port?.address ?? entry.address
        const protocol = entry.port?.protocol ?? entry.protocol ?? 'serial'
        if (!address) return null
        const match = entry.matching_boards?.[0] ?? entry.boards?.[0]
        return {
          address,
          protocol,
          label: entry.port?.label,
          boardName: match?.name,
          fqbn: match?.fqbn ?? match?.FQBN
        }
      })
      .filter((b): b is BoardPort => b !== null)
  } catch {
    return []
  }
}

/** Known/installable boards from installed cores (`arduino-cli board listall`). */
export async function listAll(): Promise<BoardTarget[]> {
  try {
    const { stdout } = await execFileAsync(CLI, ['board', 'listall', '--format', 'json'], {
      timeout: 15000,
      windowsHide: true
    })
    const parsed = JSON.parse(stdout.toString() || '{}')
    const boards: { name?: string; fqbn?: string }[] = parsed.boards ?? []
    return boards
      .filter((b) => b.name && b.fqbn)
      .map((b) => ({ name: b.name as string, fqbn: b.fqbn as string }))
  } catch {
    return []
  }
}

function streamCli(
  win: BrowserWindow,
  id: string,
  args: string[],
  sketchPath: string
): void {
  const sketchDir = dirname(sketchPath)
  runner.sendRunOutput(win, id, 'system', `$ ${CLI} ${args.join(' ')}\n`)
  const start = performance.now()
  let proc: ChildProcess
  try {
    // cwd is the sketch directory, inside the project: resolve CLI from PATH.
    const cliBin = safeCommand(CLI, getWorkspaceRoot())
    if (!cliBin) throw new Error('arduino-cli resolved inside the workspace')
    proc = spawn(cliBin, args, { cwd: sketchDir, windowsHide: true, shell: needsShell(cliBin) })
    // Decode UTF-8 across chunk boundaries (see runnerService).
    proc.stdout?.setEncoding('utf8')
    proc.stderr?.setEncoding('utf8')
  } catch (err) {
    runner.sendRunOutput(win, id, 'stderr', `Failed to launch ${CLI}: ${String(err)}\n`)
    runner.sendRunExit(win, { id, code: 127, signal: null, durationMs: 0, phase: 'compile' })
    return
  }
  runner.trackProcess(id, proc)
  proc.stdin?.on('error', () => {})
  let stderrBuf = ''
  proc.stdout?.on('data', (d) => runner.sendRunOutput(win, id, 'stdout', d.toString()))
  proc.stderr?.on('data', (d) => {
    const text = d.toString()
    stderrBuf += text
    runner.sendRunOutput(win, id, 'stderr', text)
  })
  proc.on('error', (err) => runner.sendRunOutput(win, id, 'stderr', `${String(err)}\n`))
  proc.on('close', (code, signal) => {
    runner.untrackProcess(id)
    // arduino-cli surfaces the underlying gcc diagnostics on stderr.
    runner.emitDiagnostics(win, id, stderrBuf, sketchDir)
    const durationMs = Math.round(performance.now() - start)
    runner.sendRunExit(win, { id, code, signal, durationMs, phase: 'compile' })
    if (code === 0) runner.sendRunOutput(win, id, 'system', `Done in ${durationMs}ms\n`)
  })
}

/** Verify (compile) a sketch for the given board. */
export function compile(win: BrowserWindow, req: BoardCompileRequest): void {
  streamCli(win, req.id, ['compile', '--fqbn', req.fqbn, req.sketchPath], req.sketchPath)
}

/** Compile and upload a sketch to a connected board. */
export function upload(win: BrowserWindow, req: BoardUploadRequest): void {
  streamCli(
    win,
    req.id,
    ['compile', '--upload', '--fqbn', req.fqbn, '-p', req.port, req.sketchPath],
    req.sketchPath
  )
}
