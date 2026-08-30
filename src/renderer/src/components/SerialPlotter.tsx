import { LineChart } from 'lucide-react'
import { useStore } from '../store/useStore'
import EmptyState from './EmptyState'

// Theme tokens, not a second palette. These were near-duplicates of colors that
// already exist (#3574f0 is JetBrains blue, ~8 degrees off our own accent).
const COLORS = ['#2E6FE0', '#6FB65A', '#E8B44A', '#E05561', '#C58BE6', '#4FB8A8']

function Sparkline({ values, color, w, h }: { values: number[]; color: string; w: number; h: number }): JSX.Element {
  if (values.length < 2) return <span className="text-ide-faint">...</span>
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const step = w / (values.length - 1)
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}

export default function SerialPlotter(): JSX.Element {
  const series = useStore((s) => s.plotSeries)
  const keys = Object.keys(series)

  if (keys.length === 0) {
    return (
      <EmptyState icon={<LineChart size={22} />}>
        Numeric telemetry (e.g. <span className="mono text-ide-muted">temp: 24.5</span> or CSV) auto-plots here.
      </EmptyState>
    )
  }

  return (
    <div className="h-full space-y-2 overflow-auto p-3">
      {keys.map((key, i) => {
        const values = series[key]
        const color = COLORS[i % COLORS.length]
        const latest = values[values.length - 1]
        return (
          <div key={key} className="rounded bg-ide-bg/60 p-2">
            <div className="mb-1 row justify-between text-[11px]">
              <span className="row gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
                <span className="mono text-ide-text">{key}</span>
              </span>
              <span className="mono text-ide-muted">{latest?.toFixed(2)}</span>
            </div>
            <Sparkline values={values} color={color} w={320} h={40} />
          </div>
        )
      })}
    </div>
  )
}
