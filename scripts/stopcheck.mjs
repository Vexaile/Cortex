/**
 * Drives a REAL sim binary (the product's ARDUINO_SHIM + SIM_MAIN, running
 * loop()) through the product's stop sequence and through a grace window, and
 * prints what each one actually yields. The vitest shim suite cannot show this:
 * it substitutes its own main that never calls loop() and never stops.
 */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = promisify(execFile)

const shimSrc = readFileSync('src/main/services/arduinoShim.ts', 'utf8')
const proto = readFileSync('src/shared/simProtocol.ts', 'utf8')
const num = (n) => Number(proto.match(new RegExp('export const ' + n + ' = (\\d+)'))[1])
const C = { ADC_MAX: num('ADC_MAX'), LOGIC_THRESHOLD: num('LOGIC_THRESHOLD'), PWM_MAX: num('PWM_MAX') }
const shim = shimSrc
  .slice(shimSrc.indexOf('String.raw`') + 11, shimSrc.lastIndexOf('`'))
  .replace(/\$\{(\w+)\}/g, (_, k) => String(C[k]))

// The product's own SIM_MAIN, lifted verbatim so this cannot drift from it.
const svc = readFileSync('src/main/services/simService.ts', 'utf8')
const SIM_MAIN = svc.slice(svc.indexOf('const SIM_MAIN = `') + 'const SIM_MAIN = `'.length, svc.indexOf('`\n\nexport async function start'))

// A sketch with a partial print: the residue only appears if the flush runs.
const SKETCH = `
void setup() { Serial.print("Ready..."); }
void loop() { delay(10); }
`

const dir = mkdtempSync(join(tmpdir(), 'stopcheck-'))
writeFileSync(join(dir, 'Arduino.h'), shim)
writeFileSync(join(dir, 'sketch.cpp'), '#include "Arduino.h"\n' + SKETCH)
writeFileSync(join(dir, 'sim_main.cpp'), SIM_MAIN)
const exe = join(dir, 'sim.exe')
await run('g++', [
  join(dir, 'sketch.cpp'),
  join(dir, 'sim_main.cpp'),
  '-o', exe,
  '-std=c++23',
  '-I', dir,
  '-pthread',
  '-O1'
])

/** graceMs = 0 reproduces the product: write @stop, kill in the same tick. */
function trial(graceMs) {
  return new Promise((resolve) => {
    const child = spawn(exe, [], { cwd: dir, windowsHide: true })
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stdin.on('error', () => {})
    setTimeout(() => {
      child.stdin.write('@stop\n', () => {})
      if (graceMs === 0) child.kill()
      else {
        const t = setTimeout(() => child.kill(), graceMs)
        child.once('exit', () => clearTimeout(t))
      }
    }, 300)
    child.on('close', (code) => resolve({ code, out: out.trim() }))
  })
}

for (const grace of [0, 250]) {
  const label = grace === 0 ? 'product (kill immediately)' : `grace window ${grace}ms`
  const r = await trial(grace)
  console.log(`${label.padEnd(28)} exit=${String(r.code).padEnd(5)} stdout=${JSON.stringify(r.out)}`)
}
