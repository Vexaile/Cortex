// Dashboard/telemetry.ts - the UI-layer side of the project.
// Parses the firmware's "key:value" telemetry lines (same format the Cortex
// Serial Plotter auto-detects) into typed samples for a dashboard.

export interface TelemetrySample {
  temp: number
  voltage: number
  rpm: number
}

export function parseTelemetry(line: string): Partial<TelemetrySample> {
  const out: Record<string, number> = {}
  for (const match of line.matchAll(/([a-z_]+)\s*[:=]\s*(-?\d+(?:\.\d+)?)/gi)) {
    out[match[1]] = Number(match[2])
  }
  return out as Partial<TelemetrySample>
}

// Example usage (run with Node): parses a couple of firmware lines.
const demo = ['temp:23.4 voltage:3417 rpm:1237', 'temp:24.0 voltage:3420 rpm:1274']
for (const line of demo) {
  console.log(parseTelemetry(line))
}
