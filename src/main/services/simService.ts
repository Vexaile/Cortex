import { spawn, ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import type { BrowserWindow } from 'electron'
import type { SimStartRequest, SimEvent } from '../../shared/ipc'
import { IPC } from '../../shared/ipc'
import { ARDUINO_SHIM } from './arduinoShim'
import { parseSimLine } from '../../shared/simProtocol'
import { isHostCpp, commandBaseName } from '../../shared/security'
import * as runner from './runnerService'
import { safeCommand } from './commandResolver'
import { getWorkspaceRoot } from './fsService'

const active = new Map<string, ChildProcess>()
const cancelled = new Set<string>()

function emit(win: BrowserWindow, ev: SimEvent): void {
  if (!win.isDestroyed()) win.webContents.send(IPC.SIM_EVENT, ev)
}
function system(win: BrowserWindow, id: string, text: string): void {
  emit(win, { id, kind: 'system', text })
}
function exit(win: BrowserWindow, id: string, code: number | null): void {
  if (!win.isDestroyed()) win.webContents.send(IPC.SIM_EXIT, { id, code })
}

const SIM_MAIN = `#include "Arduino.h"
extern void setup();
extern void loop();
int main() {
  setup();
  while (__sim_run) {
    loop();
    std::this_thread::sleep_for(std::chrono::microseconds(200));
  }
  // Not "return 0": see __sim_exit. Returning races the detached stdin reader
  // against static destruction and can abort with a nonzero code that looks
  // like the user's sketch crashed.
  __sim_exit(0);
}
`

export async function start(win: BrowserWindow, req: SimStartRequest): Promise<void> {
  if (active.has(req.id)) return
  cancelled.delete(req.id)
  const simDir = join(req.cwd, '.cortex', 'sim')
  await fs.mkdir(simDir, { recursive: true })

  const source = await fs.readFile(req.filePath, 'utf8')
  const needsInclude = !/#include\s*[<"]Arduino\.h[>"]/.test(source)
  // #line makes the compiler report the user's real file and line numbers.
  // Without it every diagnostic points at .cortex/sim/sketch.cpp (a file the
  // user never wrote, hidden from the Explorer) and is off by one because of
  // the injected include.
  const escaped = req.filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const header = (needsInclude ? '#include "Arduino.h"\n' : '') + `#line 1 "${escaped}"\n`
  const sketch = header + source

  await fs.writeFile(join(simDir, 'Arduino.h'), ARDUINO_SHIM, 'utf8')
  await fs.writeFile(join(simDir, 'sketch.cpp'), sketch, 'utf8')
  await fs.writeFile(join(simDir, 'sim_main.cpp'), SIM_MAIN, 'utf8')

  // Only host C++ compilers may run the sim: a cross-compiler emits firmware
  // for a chip and cannot produce something this machine can execute.
  const wanted = req.compiler || 'g++'
  const compiler = isHostCpp(wanted) ? wanted : 'g++'
  if (wanted !== compiler) {
    // Say so. Substituting in silence is why picking avr-g++ in the toolbar
    // surfaced as a bare "spawn g++ ENOENT" with nothing connecting the two.
    system(win, req.id, `${commandBaseName(wanted)} builds firmware, not host programs. Using ${compiler} instead.\n`)
  }
  const exePath = join(simDir, 'sim.exe')
  const compileArgs = [
    join(simDir, 'sketch.cpp'),
    join(simDir, 'sim_main.cpp'),
    '-o',
    exePath,
    '-std=c++23',
    '-I',
    simDir,
    '-pthread',
    '-O1'
  ]

  system(win, req.id, `Compiling simulation with ${compiler}...\n`)
  let cc: ChildProcess
  try {
    const ccBin = safeCommand(compiler, getWorkspaceRoot())
    if (!ccBin) throw new Error(`Refusing a compiler from inside the workspace: ${compiler}`)
    cc = spawn(ccBin, compileArgs, { cwd: simDir, windowsHide: true })
    // Decode UTF-8 across chunk boundaries (see runnerService).
    cc.stdout?.setEncoding('utf8')
    cc.stderr?.setEncoding('utf8')
  } catch (err) {
    system(win, req.id, `Failed to launch ${compiler}: ${String(err)}\n`)
    exit(win, req.id, 127)
    return
  }
  // Track the compiler child so a Stop during compilation actually cancels it.
  active.set(req.id, cc)
  let cerr = ''
  cc.stdin?.on('error', () => {})
  cc.stderr?.on('data', (d) => (cerr += d.toString()))
  cc.on('error', (err) => system(win, req.id, `Failed to launch ${compiler}: ${String(err)}\n`))
  cc.on('close', (code) => {
    active.delete(req.id)
    if (cancelled.has(req.id)) {
      cancelled.delete(req.id)
      exit(win, req.id, code)
      return
    }
    // Emit UNCONDITIONALLY, like the native path: on success this publishes an
    // empty list, which is what clears stale problems and squiggles once the
    // user fixes the error. Only emitting on failure left them forever.
    // Thanks to #line these name the user's real .ino, not sketch.cpp.
    runner.emitDiagnostics(win, req.id, cerr, dirname(req.filePath))
    if (code !== 0) {
      system(win, req.id, cerr || 'Compilation failed.\n')
      exit(win, req.id, code)
      return
    }
    launch(win, req, exePath, simDir)
  })
}

function launch(win: BrowserWindow, req: SimStartRequest, exePath: string, cwd: string): void {
  if (cancelled.has(req.id)) {
    cancelled.delete(req.id)
    exit(win, req.id, null)
    return
  }
  system(win, req.id, 'Simulation running.\n')
  let child: ChildProcess
  try {
    child = spawn(exePath, [], { cwd, windowsHide: true })
    // Decode UTF-8 across chunk boundaries (see runnerService).
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
  } catch (err) {
    system(win, req.id, `Failed to start simulation: ${String(err)}\n`)
    exit(win, req.id, 1)
    return
  }
  active.set(req.id, child)
  child.stdin?.on('error', () => {})
  child.on('error', (err) => {
    active.delete(req.id)
    system(win, req.id, `Failed to start simulation: ${String(err)}\n`)
    exit(win, req.id, 1)
  })
  let buf = ''
  child.stdout?.on('data', (d) => {
    buf += d.toString()
    const lines = buf.split(/\r?\n/)
    buf = lines.pop() || ''
    for (const line of lines) {
      const parsed = parseSimLine(line)
      if (parsed) emit(win, { id: req.id, ...parsed } as SimEvent)
    }
  })
  child.stderr?.on('data', (d) => system(win, req.id, d.toString()))
  child.on('close', (code) => {
    active.delete(req.id)
    // Drain whatever never got its newline. The shim flushes its own residue at
    // exit, but a killed process cannot, and dropping the tail here would lose
    // the last thing the sketch said.
    if (buf) {
      const parsed = parseSimLine(buf)
      if (parsed) emit(win, { id: req.id, ...parsed } as SimEvent)
      buf = ''
    }
    exit(win, req.id, code)
  })
}

/**
 * How long a sketch gets to notice @stop and leave through __sim_exit, which is
 * what flushes a partial Serial.print and yields exit 0. Killing in the same
 * tick as the write meant the sketch never read it: every stop reported exit
 * null and dropped the sketch's last output, which made the shim's whole flush
 * path dead code in the product. Long enough for a loop() iteration, short
 * enough that Stop still feels instant.
 */
const STOP_GRACE_MS = 250

export function stop(id: string): void {
  const child = active.get(id)
  cancelled.add(id) // guard the compile->launch handoff even if we kill mid-compile
  if (!child) return
  child.stdin?.write('@stop\n', () => {})
  const t = setTimeout(() => child.kill(), STOP_GRACE_MS)
  // Removal belongs to the close handler, which also drains the last partial
  // line. Deleting here dropped both.
  child.once('exit', () => clearTimeout(t))
}

export function input(id: string, pin: number, value: number): void {
  const child = active.get(id)
  if (child?.stdin?.writable) child.stdin.write(`@in ${pin} ${value}\n`, () => {})
}

/**
 * Quit path: no grace window on purpose. The window is going away, so there is
 * nobody left to read a flushed line, and a per-child wait would only make quit
 * feel slow.
 */
export function killAll(): void {
  for (const [id, child] of active) {
    cancelled.add(id)
    child.kill()
  }
  active.clear()
}
