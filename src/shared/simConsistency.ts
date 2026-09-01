/**
 * Firmware <-> simulator consistency: a pure reconciliation of the pins the
 * source actually drives/reads (from the ProjectModel) against what the
 * simulator has wired (its parts and their board-pin connections). This is the
 * check that closes the audit's core gap - the hardware graph and the simulator
 * were two separate models with nothing verifying they agree, so a sketch could
 * drive a pin the simulation never modelled (its effect invisible) or a part
 * could sit on a pin the firmware never touches (inert), with no signal either
 * way.
 *
 * Honesty contract (see the rest of the dependency/graph system): only CERTAIN,
 * observed mismatches are reported. Source pins are tokens - a numeric token
 * ("5", "GPIO5") resolves to a board pin unambiguously, but a named one ("A0",
 * "LED_BUILTIN") needs a board-specific map we do not have here, so it is listed
 * as unresolved rather than guessed. The "inert part" check needs the COMPLETE
 * set of firmware pins to be sure a pin is unused, so it runs only when every
 * source token resolved; otherwise it is skipped (an unresolved "LED_BUILTIN"
 * could be exactly the pin a part is wired to, and flagging it would be a false
 * claim). No Electron, no DOM: fully unit-testable.
 *
 * Precondition (the one assumption every claim rests on): a firmware token's
 * resolved number and a simulator part's wired pin number are in the SAME
 * numbering space. That holds for digital pin numbers, but analog access can
 * diverge on AVR - `analogRead(0)` means channel A0, not digital pin 0 - so a
 * bare-numeric analog access on an AVR-numbered board could, in principle, match
 * a different physical net. The idiomatic named form `analogRead(A0)` is safe:
 * "A0" does not resolve here and is reported unresolved rather than guessed. We
 * do not carry a board pin-map, so this file trusts its producers to use one
 * consistent numbering; if that assumption is ever broken it belongs upstream in
 * the token producer, not in a guess here.
 */

import type { PinUsage } from './ipc'
import { parseGpio } from './pinCapability'

/** A simulator part reduced to what consistency needs: what it is and where it
 *  is wired. Board pins are numbers; an unconnected named pin is null. */
export interface SimWiredPart {
  /** Part type or a human label, used only in messages (e.g. "led", "servo"). */
  type: string
  pins: Record<string, number | null>
}

export interface SimConsistencyFinding {
  id: string
  severity: 'info' | 'warning'
  kind: 'not-simulated' | 'inert-part'
  title: string
  detail: string
  pin: number
  /** First source site for a not-simulated pin (click-to-source). */
  file?: string
  line?: number
}

export interface SimConsistencyReport {
  findings: SimConsistencyFinding[]
  /** Named source pin tokens that could not be resolved to a board pin, so the
   *  checks below could not consider them. Surfaced so the UI can say the view
   *  is partial rather than imply completeness. */
  unresolvedPins: string[]
  /** Whether the inert-part check ran. It runs only when every source token
   *  resolved to a number (otherwise a wired pin cannot be certainly called
   *  unused). */
  inertCheckRan: boolean
}

/** A pin driven as an output or read as an input, for the message wording. */
function rolesLabel(usages: PinUsage[]): string {
  const roles = [...new Set(usages.map((u) => u.role))]
  return roles.join(', ')
}

/**
 * Reconcile firmware pin usage against the simulator's wiring. Pure and
 * deterministic.
 */
export function simConsistency(pins: PinUsage[], parts: SimWiredPart[]): SimConsistencyReport {
  // Group source pins by their resolved board number; collect unresolved tokens.
  const byNumber = new Map<number, PinUsage[]>()
  const unresolved = new Set<string>()
  for (const p of pins) {
    const n = parseGpio(p.pin)
    if (n == null) {
      unresolved.add(p.pin)
      continue
    }
    let list = byNumber.get(n)
    if (!list) {
      list = []
      byNumber.set(n, list)
    }
    list.push(p)
  }

  // The set of board pins the simulator has something wired to.
  const wired = new Set<number>()
  for (const part of parts) {
    for (const v of Object.values(part.pins)) {
      if (typeof v === 'number') wired.add(v)
    }
  }

  const findings: SimConsistencyFinding[] = []

  // Firmware uses a pin the simulator has nothing on: its effect (or its input)
  // will not be represented in the simulation. Certain for a numeric token.
  for (const [pin, usages] of [...byNumber.entries()].sort((a, b) => a[0] - b[0])) {
    if (wired.has(pin)) continue
    const first = usages[0]
    findings.push({
      id: `not-sim-${pin}`,
      severity: 'warning',
      kind: 'not-simulated',
      pin,
      title: `GPIO${pin} is used by the firmware but not wired in the simulator`,
      detail: `The firmware touches GPIO${pin} (${rolesLabel(usages)}), but no simulator part is connected to it, so its behavior will not appear in simulation. Add and wire a part on GPIO${pin}.`,
      file: first?.file,
      line: first?.line
    })
  }

  // Inert part: wired to a pin the firmware never uses. Only certain when every
  // source token resolved - an unresolved named token could be exactly this pin.
  const inertCheckRan = unresolved.size === 0
  if (inertCheckRan) {
    // One finding per unused wired pin, naming a part on it.
    const seen = new Set<number>()
    for (const part of parts) {
      for (const v of Object.values(part.pins)) {
        if (typeof v !== 'number' || byNumber.has(v) || seen.has(v)) continue
        seen.add(v)
        findings.push({
          id: `inert-${v}`,
          severity: 'info',
          kind: 'inert-part',
          pin: v,
          title: `A ${part.type} is on GPIO${v}, which the firmware never uses`,
          detail: `The simulator wires a ${part.type} to GPIO${v}, but the firmware never drives or reads that pin, so the part stays inert.`
        })
      }
    }
  }

  return { findings, unresolvedPins: [...unresolved].sort(), inertCheckRan }
}
