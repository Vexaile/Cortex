/**
 * Pure formatters that turn the environment report and the hardware graph into
 * the compact, honest text the engineering agent reads through its read-only
 * tools. Kept out of agentService (which pulls in Electron/fs) so they are
 * dependency-free and unit-testable: the exact bytes the model sees are the
 * thing worth pinning down.
 *
 * The honesty of the underlying data is preserved verbatim - a dependency the
 * engine could not confirm is shown as "unverified", never as present, and an
 * inferred bus attachment carries its "likely" qualifier and note. The agent
 * must be able to tell what Cortex KNOWS from what it GUESSES, so these strings
 * never upgrade a hedge into a fact.
 */

import type { EnvironmentReport, DependencyState } from './environment'
import type { HardwareGraph } from './hardwareGraph'

const DEP_LABEL: Record<DependencyState, string> = {
  resolved: 'resolved',
  'provided-by-toolchain': 'toolchain',
  unverified: 'unverified',
  missing: 'MISSING'
}

/** The environment report as agent-readable text: board/core, each used header
 *  and how it resolves, available updates, and the evidence-based findings. */
export function formatEnvironmentReport(report: EnvironmentReport): string {
  const lines: string[] = []
  const c = report.core
  if (c.fqbn) {
    lines.push(
      `Board: ${c.fqbn}${c.platformId ? ` (core ${c.platformId})` : ''} - ${
        c.installed ? `core installed${c.installedVersion ? ` ${c.installedVersion}` : ''}` : 'core NOT installed'
      }`
    )
  } else {
    lines.push('Board: none selected')
  }

  if (report.dependencies.length) {
    lines.push('', 'Dependencies (used #include -> how it resolves):')
    for (const d of report.dependencies) {
      const prov = d.provider ? ` via ${d.provider}${d.providerVersion ? ` ${d.providerVersion}` : ''}` : ''
      lines.push(`  ${d.header}: ${DEP_LABEL[d.state]}${prov}`)
    }
  }

  if (report.updates.length) {
    lines.push('', 'Updates available:')
    for (const u of report.updates) lines.push(`  ${u.library}: ${u.installed} -> ${u.latest} (risk ${u.risk})`)
  }

  const notable = report.findings.filter((f) => f.severity === 'error' || f.severity === 'warning')
  if (notable.length) {
    lines.push('', 'Findings:')
    for (const f of notable) {
      const at = f.file && f.line != null ? ` [${f.file}:${f.line}]` : ''
      lines.push(`  [${f.severity}] ${f.title}${at}`)
    }
  }

  if (report.incomplete) {
    lines.push('', 'Note: this picture is partial (the scan was truncated or provider metadata was missing); a build gives the certain answer.')
  }
  return lines.join('\n')
}

/** The hardware graph as agent-readable text: board, recognized devices, buses,
 *  pins, and the inferred device<->bus attachments with their honest notes. */
export function formatHardwareGraph(graph: HardwareGraph): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const of = (kind: string): typeof graph.nodes => graph.nodes.filter((n) => n.kind === kind)
  const lines: string[] = []

  const board = graph.nodes.find((n) => n.kind === 'board')
  lines.push(`Board: ${board ? board.label + (board.detail ? ` (${board.detail})` : '') : 'none configured'}`)

  const devices = of('device')
  if (devices.length) {
    lines.push('', 'Devices (from driver includes - the include is evidence the driver is compiled in, not proof the part is wired):')
    for (const d of devices) {
      lines.push(`  ${d.label}${d.detail ? ` - ${d.detail}` : ''}`)
      // The honest inference: which bus this device is likely on, and why / caveat.
      for (const e of graph.edges.filter((e) => e.from === d.id && e.relation === 'likely-on-bus')) {
        const bus = byId.get(e.to)
        lines.push(`    likely on ${bus?.label ?? e.to}${e.note ? ` (${e.note})` : ''}`)
      }
    }
  }

  const buses = of('bus')
  if (buses.length) {
    lines.push('', 'Buses:')
    for (const b of buses) lines.push(`  ${b.label}${b.detail ? ` - ${b.detail}` : ''}`)
  }

  const pins = of('pin')
  if (pins.length) {
    lines.push('', 'GPIO pins:')
    for (const p of pins) lines.push(`  ${p.label}${p.detail ? ` - ${p.detail}` : ''}`)
  }

  if (graph.incomplete) {
    lines.push('', 'Note: partial scan (project larger than the scan cap), so this is a sample, not the whole graph.')
  }
  return lines.join('\n')
}
