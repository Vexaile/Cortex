/**
 * Proves the gdb/MI debug flow before the app layer: compile a test program
 * with -g, drive gdb --interpreter=mi2 to set a breakpoint, run, and read the
 * stop frame + locals. Usage: node scripts/gdbcheck.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SRC = `#include <iostream>
int add(int a, int b) {
  int sum = a + b;   // line 3
  return sum;
}
int main() {
  int x = 40;
  int y = 2;
  int z = add(x, y); // line 10
  std::cout << z << "\\n";
  return 0;
}
`
const dir = mkdtempSync(join(tmpdir(), 'gdbcheck-'))
const src = join(dir, 'main.cpp')
const exe = join(dir, process.platform === 'win32' ? 'main.exe' : 'main')
writeFileSync(src, SRC)
execFileSync('g++', ['-g', '-O0', '-std=c++23', src, '-o', exe])
console.log('compiled ok')

const gdb = spawn('gdb', ['--interpreter=mi2', exe], { cwd: dir, windowsHide: true })
let buf = ''
let token = 1
const pending = new Map()
const events = []
gdb.stdout.on('data', (d) => {
  buf += d.toString()
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).replace(/\r$/, '')
    buf = buf.slice(nl + 1)
    const m = line.match(/^(\d+)\^(done|error|running|connected|exit)(,(.*))?$/)
    if (m) {
      const p = pending.get(Number(m[1]))
      if (p) {
        pending.delete(Number(m[1]))
        p(m[2] === 'error' ? Promise.reject(m[4]) : m[4] || '')
      }
    } else if (line.startsWith('*stopped')) {
      events.push(line)
    }
  }
})
const cmd = (c) =>
  new Promise((resolve, reject) => {
    const t = token++
    pending.set(t, (v) => (typeof v?.then === 'function' ? v.then(resolve, reject) : resolve(v)))
    gdb.stdin.write(`${t}${c}\n`)
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const run = async () => {
  await cmd('-break-insert ' + src.replace(/\\/g, '/') + ':3').catch((e) => console.log('bp err', e))
  console.log('breakpoint set on line 3 (int sum = a + b)')
  cmd('-exec-run').catch(() => {})
  // wait for *stopped
  for (let i = 0; i < 50 && events.length === 0; i++) await sleep(100)
  const stopped = events[0] || '(none)'
  const frame = stopped.match(/func="([^"]+)".*?line="(\d+)"/)
  console.log('stopped:', frame ? `func=${frame[1]} line=${frame[2]}` : stopped.slice(0, 120))
  const stack = await cmd('-stack-list-frames').catch(() => '')
  console.log('stack frames:', (stack.match(/func="([^"]+)"/g) || []).map((s) => s.slice(6, -1)).join(' -> '))
  const vars = await cmd('-stack-list-variables --all-values').catch(() => '')
  console.log('locals:', (vars.match(/name="([^"]+)",value="([^"]*)"/g) || []).join(', '))
  gdb.stdin.write('-gdb-exit\n')
  await sleep(150)
  gdb.kill()
  process.exit(0)
}
run().catch((e) => {
  console.error(e)
  gdb.kill()
  process.exit(1)
})
setTimeout(() => {
  console.error('timeout')
  gdb.kill()
  process.exit(1)
}, 30000)
