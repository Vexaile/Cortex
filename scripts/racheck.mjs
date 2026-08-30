/**
 * Drives real rust-analyzer through the LSP handshake against examples/rustproj,
 * to separate "rust-analyzer misbehaves" from "Cortex's client is wrong".
 *
 * rust-analyzer differs from clangd in one way that matters: it will answer
 * requests BEFORE it has loaded the Cargo workspace, and those answers are
 * empty. It signals readiness with $/progress (token "rustAnalyzer/Indexing"),
 * so this waits for that rather than a fixed sleep.
 *
 * Usage: node scripts/racheck.mjs
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', 'examples', 'rustproj')
const file = join(root, 'src', 'main.rs')
const text = readFileSync(file, 'utf8')
const uri = 'file:///' + file.replace(/\\/g, '/')
const rootUri = 'file:///' + root.replace(/\\/g, '/')

const enc = new TextEncoder()
const dec = new TextDecoder()
const frame = (msg) => {
  const body = enc.encode(JSON.stringify(msg))
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), Buffer.from(body)])
}

const proc = spawn('rust-analyzer', [], { cwd: root, windowsHide: true })
proc.on('error', (e) => {
  console.error('spawn failed:', e.message)
  process.exit(1)
})

let buf = Buffer.alloc(0)
let contentLen = -1
const pending = new Map()
let indexingDone = false
const progressSeen = []

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
    if (msg.id !== undefined && !msg.method) {
      const p = pending.get(msg.id)
      if (p) { pending.delete(msg.id); p(msg) }
    } else if (msg.method === '$/progress') {
      const v = msg.params?.value ?? {}
      progressSeen.push(`${msg.params?.token}:${v.kind}`)
      if (v.kind === 'end') indexingDone = true
    } else if (msg.id !== undefined && msg.method) {
      // Server -> client request. rust-analyzer asks for configuration and
      // registers capabilities; answer minimally so it does not stall.
      const result =
        msg.method === 'workspace/configuration' ? (msg.params.items || []).map(() => ({})) : null
      proc.stdin.write(frame({ jsonrpc: '2.0', id: msg.id, result }))
    }
  }
})

let nextId = 1
const request = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    proc.stdin.write(frame({ jsonrpc: '2.0', id, method, params }))
  })
const notify = (method, params) => proc.stdin.write(frame({ jsonrpc: '2.0', method, params }))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const run = async () => {
  const init = await request('initialize', {
    processId: process.pid,
    rootUri,
    // What Cortex's lspService sends today.
    capabilities: {
      textDocument: {
        synchronization: { didSave: true, dynamicRegistration: false },
        completion: { completionItem: { snippetSupport: true } },
        hover: { contentFormat: ['markdown', 'plaintext'] },
        publishDiagnostics: {}
      },
      workspace: { configuration: true }
    }
  })
  console.log('initialize ok:', !!init.result?.capabilities, '| server:', init.result?.serverInfo?.name)
  notify('initialized', {})
  notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'rust', version: 1, text }
  })

  // No fixed wait: poll instead, to MEASURE how long rust-analyzer needs.

  // Complete after `f.` on the line following `let mut f = ...`.
  const lines = text.split('\n')
  const declIdx = lines.findIndex((l) => l.includes('let mut f'))
  const edited = [...lines]
  edited.splice(declIdx + 1, 0, '    f.')
  notify('textDocument/didChange', {
    textDocument: { uri, version: 2 },
    contentChanges: [{ text: edited.join('\n') }]
  })
  const t0 = Date.now()
  let items = []
  for (let i = 0; i < 45; i++) {
    await sleep(2000)
    const comp = await request('textDocument/completion', {
      textDocument: { uri },
      position: { line: declIdx + 1, character: 6 }
    })
    items = comp.result?.items || comp.result || []
    if (items.length) break
  }
  console.log('first useful completion after:', ((Date.now() - t0) / 1000).toFixed(1) + 's')
  console.log('progress events:', progressSeen.length, '| indexingDone:', indexingDone)
  console.log('completion count:', items.length, '| has push:', items.some((i) => String(i.label).startsWith('push')))

  notify('shutdown', null)
  notify('exit', null)
  await sleep(200)
  proc.kill()
  process.exit(0)
}
run().catch((e) => { console.error(e); proc.kill(); process.exit(1) })
setTimeout(() => { console.error('timeout'); proc.kill(); process.exit(1) }, 120000)
