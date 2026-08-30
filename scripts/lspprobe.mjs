/**
 * Isolates why completion on a real C++23 file returns nothing. Opens the actual
 * examples/robot/Firmware/sense.cpp, appends "tempFilter." like the capture does,
 * and asks for member completion - once with clangd's default std and once with
 * fallbackFlags:[-std=c++23]. If the second returns "push" and the first does not,
 * the fix is: tell clangd the project's std. Usage: node scripts/lspprobe.mjs
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const file = join(here, '..', 'examples', 'robot', 'Firmware', 'sense.cpp')
const root = join(here, '..', 'examples', 'robot')
const base = readFileSync(file, 'utf8')
const uri = 'file:///' + file.replace(/\\/g, '/')
const rootUri = 'file:///' + root.replace(/\\/g, '/')

const enc = new TextEncoder()
const dec = new TextDecoder()
const frame = (msg) => {
  const body = enc.encode(JSON.stringify(msg))
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), Buffer.from(body)])
}

// Insert "\n    tempFilter." after line 25 (1-based), matching the capture harness.
const lines = base.split('\n')
lines.splice(25, 0, '    tempFilter.') // after index 24 => new line 26
const edited = lines.join('\n')
// completion position: line 26 (1-based) => LSP line 25, char 15 (end of "    tempFilter.")

async function probe(label, fallbackFlags) {
  const args = ['--background-index=false', '--clang-tidy=false']
  const proc = spawn('clangd', args, { cwd: root, windowsHide: true })
  let buf = Buffer.alloc(0)
  let contentLen = -1
  const pending = new Map()
  const diags = []
  proc.stdout.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (contentLen < 0) {
        const i = buf.indexOf('\r\n\r\n')
        if (i < 0) break
        const m = buf.subarray(0, i).toString().match(/content-length:\s*(\d+)/i)
        contentLen = m ? Number(m[1]) : 0
        buf = buf.subarray(i + 4)
      }
      if (buf.length < contentLen) break
      const msg = JSON.parse(dec.decode(buf.subarray(0, contentLen)))
      buf = buf.subarray(contentLen)
      contentLen = -1
      if (msg.id !== undefined && !msg.method && (msg.result !== undefined || msg.error !== undefined)) {
        const p = pending.get(msg.id)
        if (p) { pending.delete(msg.id); p(msg) }
      } else if (msg.method === 'textDocument/publishDiagnostics') {
        diags.push(...msg.params.diagnostics)
      } else if (msg.id !== undefined && msg.method) {
        const result = msg.method === 'workspace/configuration' ? (msg.params.items || []).map(() => ({})) : null
        proc.stdin.write(frame({ jsonrpc: '2.0', id: msg.id, result }))
      }
    }
  })
  let nextId = 1
  const request = (method, params) =>
    new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); proc.stdin.write(frame({ jsonrpc: '2.0', id, method, params })) })
  const notify = (method, params) => proc.stdin.write(frame({ jsonrpc: '2.0', method, params }))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  await request('initialize', {
    processId: process.pid,
    rootUri,
    initializationOptions: fallbackFlags ? { fallbackFlags } : {},
    capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } }, hover: {}, publishDiagnostics: {} } }
  })
  notify('initialized', {})
  notify('textDocument/didOpen', { textDocument: { uri, languageId: 'cpp', version: 1, text: edited } })
  await sleep(3000)
  const comp = await request('textDocument/completion', { textDocument: { uri }, position: { line: 25, character: 15 } })
  const items = (comp.result?.items || comp.result || []).map((i) => i.label)
  const errs = diags.filter((d) => d.severity === 1).slice(0, 4).map((d) => `[L${d.range.start.line + 1}] ${d.message}`)
  console.log(`\n=== ${label} ===`)
  console.log('errors:', diags.filter((d) => d.severity === 1).length, errs)
  console.log('completion count:', items.length)
  console.log('has push:', items.includes('push'), '| sample:', items.slice(0, 12))
  notify('shutdown', null); notify('exit', null)
  await sleep(150); proc.kill()
}

// Extract g++'s system include search paths + target, the way clangd needs.
import { spawnSync } from 'node:child_process'
function probeDriver(cmd, lang) {
  const r = spawnSync(cmd, ['-E', `-x${lang}`, '-v', '-'], { input: '', encoding: 'utf8' })
  const text = (r.stdout || '') + (r.stderr || '')
  const m = text.match(/#include <\.\.\.> search starts here:\r?\n([\s\S]*?)\r?\nEnd of search list\./)
  const dirs = m ? m[1].split('\n').map((l) => l.trim()).filter(Boolean) : []
  const tgt = text.match(/^Target:\s*(\S+)/m)
  return { dirs, target: tgt ? tgt[1] : null }
}

const run = async () => {
  const { dirs, target } = probeDriver('g++', 'c++')
  console.log('(discovered', dirs.length, 'dirs, target', target, ')')
  const isystem = dirs.flatMap((d) => ['-isystem', d])
  const dflt = spawnSync('clang', ['-dM', '-E', '-xc++', '-'], { input: '', encoding: 'utf8' })
  console.log('clang default __cplusplus:', (dflt.stdout || '').match(/__cplusplus (\S+)/)?.[1])
  // Unedited real file, to compare std-on vs std-off diagnostics.
  await probeFile('UNEDITED: target + isystem, NO -std', base, [`--target=${target}`, ...isystem])
  await probeFile('UNEDITED: target + isystem + -std=c++23', base, ['-std=c++23', `--target=${target}`, ...isystem])
  await probe('EDITED completion: std + target + isystem', ['-std=c++23', `--target=${target}`, ...isystem])
  // Does clangd itself (via its flag mangler) tolerate a .c file when the
  // global fallbackFlags carry -std=c++23? Open a trivial C file and inspect.
  await probeC('clangd on a .c file with c++ fallbackFlags', ['-std=c++23', `--target=${target}`, ...isystem])
  process.exit(0)
}

// Open a given source text unedited and report all error diagnostics.
async function probeFile(label, text, fallbackFlags) {
  const proc = spawn('clangd', ['--background-index=false', '--clang-tidy=false'], { cwd: root, windowsHide: true })
  let buf = Buffer.alloc(0), contentLen = -1
  const pending = new Map(), diags = []
  proc.stdout.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (contentLen < 0) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) break
        const m = buf.subarray(0, i).toString().match(/content-length:\s*(\d+)/i); contentLen = m ? Number(m[1]) : 0; buf = buf.subarray(i + 4) }
      if (buf.length < contentLen) break
      const msg = JSON.parse(dec.decode(buf.subarray(0, contentLen))); buf = buf.subarray(contentLen); contentLen = -1
      if (msg.method === 'textDocument/publishDiagnostics') { diags.length = 0; diags.push(...msg.params.diagnostics) }
      else if (msg.id !== undefined && !msg.method) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); p(msg) } }
      else if (msg.id !== undefined && msg.method) { proc.stdin.write(frame({ jsonrpc: '2.0', id: msg.id, result: msg.method === 'workspace/configuration' ? (msg.params.items || []).map(() => ({})) : null })) }
    }
  })
  let nextId = 1
  const request = (method, params) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); proc.stdin.write(frame({ jsonrpc: '2.0', id, method, params })) })
  const notify = (method, params) => proc.stdin.write(frame({ jsonrpc: '2.0', method, params }))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  await request('initialize', { processId: process.pid, rootUri, initializationOptions: { fallbackFlags }, capabilities: { textDocument: { publishDiagnostics: {} } } })
  notify('initialized', {})
  notify('textDocument/didOpen', { textDocument: { uri, languageId: 'cpp', version: 1, text } })
  await sleep(3000)
  const errs = diags.filter((d) => d.severity === 1)
  console.log(`\n=== ${label} ===`)
  console.log('error count:', errs.length, errs.slice(0, 5).map((d) => `[L${d.range.start.line + 1}] ${d.message}`))
  notify('shutdown', null); notify('exit', null); await sleep(150); proc.kill()
}

// Variant: open a trivial C file, report whether clangd emits a bogus std error.
async function probeC(label, fallbackFlags) {
  const cfile = join(root, 'Firmware', '__probe.c')
  const curi = 'file:///' + cfile.replace(/\\/g, '/')
  const proc = spawn('clangd', ['--background-index=false', '--clang-tidy=false'], { cwd: root, windowsHide: true })
  let buf = Buffer.alloc(0), contentLen = -1
  const pending = new Map(), diags = []
  proc.stdout.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (contentLen < 0) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) break
        const m = buf.subarray(0, i).toString().match(/content-length:\s*(\d+)/i); contentLen = m ? Number(m[1]) : 0; buf = buf.subarray(i + 4) }
      if (buf.length < contentLen) break
      const msg = JSON.parse(dec.decode(buf.subarray(0, contentLen))); buf = buf.subarray(contentLen); contentLen = -1
      if (msg.id !== undefined && !msg.method && (msg.result !== undefined || msg.error !== undefined)) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); p(msg) } }
      else if (msg.method === 'textDocument/publishDiagnostics') { diags.push(...msg.params.diagnostics) }
      else if (msg.id !== undefined && msg.method) { proc.stdin.write(frame({ jsonrpc: '2.0', id: msg.id, result: msg.method === 'workspace/configuration' ? (msg.params.items || []).map(() => ({})) : null })) }
    }
  })
  let nextId = 1
  const request = (method, params) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); proc.stdin.write(frame({ jsonrpc: '2.0', id, method, params })) })
  const notify = (method, params) => proc.stdin.write(frame({ jsonrpc: '2.0', method, params }))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  await request('initialize', { processId: process.pid, rootUri, initializationOptions: { fallbackFlags }, capabilities: { textDocument: { publishDiagnostics: {} } } })
  notify('initialized', {})
  notify('textDocument/didOpen', { textDocument: { uri: curi, languageId: 'c', version: 1, text: '#include <stdio.h>\nint main(void){ int x = 1; return x; }\n' } })
  await sleep(2500)
  console.log(`\n=== ${label} ===`)
  console.log('C-file errors:', diags.filter((d) => d.severity === 1).map((d) => d.message).slice(0, 3))
  notify('shutdown', null); notify('exit', null); await sleep(150); proc.kill()
}
run().catch((e) => { console.error(e); process.exit(1) })
setTimeout(() => { console.error('timeout'); process.exit(1) }, 30000)
