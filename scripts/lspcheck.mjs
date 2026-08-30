/**
 * Drives real clangd through the LSP handshake to prove the transport before
 * the Monaco layer exists: initialize -> didOpen -> publishDiagnostics ->
 * completion -> hover. Mirrors lspService's framing. Usage: node scripts/lspcheck.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const enc = new TextEncoder()
const dec = new TextDecoder()
const frame = (msg) => {
  const body = enc.encode(JSON.stringify(msg))
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), Buffer.from(body)])
}

const SRC = `struct Point { int x; int y; };

int main() {
  Point p;
  p.x = 1;
  return zzz;
}
`
const dir = mkdtempSync(join(tmpdir(), 'lspcheck-'))
const file = join(dir, 'main.cpp')
writeFileSync(file, SRC)
const uri = 'file:///' + file.replace(/\\/g, '/')

const proc = spawn('clangd', ['--background-index', '--clang-tidy=false'], { cwd: dir, windowsHide: true })
proc.on('error', (e) => {
  console.error('spawn failed:', e.message)
  process.exit(1)
})

let buf = Buffer.alloc(0)
let contentLen = -1
const pending = new Map()
const diagnostics = []
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
      diagnostics.push(...msg.params.diagnostics)
    } else if (msg.id !== undefined && msg.method) {
      // answer server->client requests minimally
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

const run = async () => {
  const init = await request('initialize', {
    processId: process.pid,
    rootUri: 'file:///' + dir.replace(/\\/g, '/'),
    capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } }, hover: {}, publishDiagnostics: {} } }
  })
  console.log('initialize ok:', !!init.result?.capabilities, '| server:', init.result?.serverInfo?.name, init.result?.serverInfo?.version)
  notify('initialized', {})
  notify('textDocument/didOpen', { textDocument: { uri, languageId: 'cpp', version: 1, text: SRC } })

  await sleep(2500) // let clangd parse + publish diagnostics
  console.log('diagnostics:', diagnostics.length, diagnostics.map((d) => `[L${d.range.start.line + 1}] ${d.message}`))

  // completion after "p." (line 4, char 4)
  const comp = await request('textDocument/completion', { textDocument: { uri }, position: { line: 4, character: 4 } })
  const items = (comp.result?.items || comp.result || []).map((i) => i.label).slice(0, 8)
  console.log('completion items (p.x = 1 line):', items)

  // completion after replacing with a member access point: request at "p." members
  const comp2 = await request('textDocument/completion', { textDocument: { uri }, position: { line: 3, character: 8 } })
  console.log('completion at Point decl:', ((comp2.result?.items || comp2.result || []).length), 'items')

  // hover over Point on line 3
  const hover = await request('textDocument/hover', { textDocument: { uri }, position: { line: 3, character: 3 } })
  const hv = hover.result?.contents
  console.log('hover:', typeof hv === 'string' ? hv : hv?.value ? hv.value.slice(0, 80) : JSON.stringify(hv)?.slice(0, 80))

  notify('shutdown', null)
  notify('exit', null)
  await sleep(200)
  proc.kill()
  process.exit(0)
}
run().catch((e) => { console.error(e); proc.kill(); process.exit(1) })
setTimeout(() => { console.error('timeout'); proc.kill(); process.exit(1) }, 20000)
