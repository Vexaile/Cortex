import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, TerminalSquare } from 'lucide-react'
import { useStore } from '../store/useStore'
import EmptyState from './EmptyState'

export default function OutputConsole(): JSX.Element {
  const { output, running, runPhase, sendRunInput } = useStore()
  const endRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('')

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [output])

  const colorFor = (stream: string): string =>
    stream === 'stderr' ? 'text-ide-red' : stream === 'system' ? 'text-ide-faint' : 'text-ide-text'

  const submit = async (): Promise<void> => {
    await sendRunInput(input)
    setInput('')
  }

  const acceptsStdin = running && runPhase === 'run'

  return (
    <div className="flex h-full flex-col bg-ide-bg">
      <div className="mono min-h-0 flex-1 overflow-auto px-3 py-2 text-[12.5px] leading-[1.5] selection:bg-ide-active">
        {output.length === 0 && !running ? (
          <EmptyState icon={<TerminalSquare size={22} />} mono>
            Run a file (F5) to see build and program output here.
          </EmptyState>
        ) : (
          output.map((line, i) => (
            <span key={i} className={`whitespace-pre-wrap ${colorFor(line.stream)}`}>
              {line.text}
            </span>
          ))
        )}
        {running && <span className="animate-pulse text-ide-accent">▍</span>}
        <div ref={endRef} />
      </div>
      {acceptsStdin && (
        <div className="row shrink-0 gap-1.5 border-t border-ide-border px-2 py-1.5">
          <span className="text-[11px] text-ide-faint">stdin</span>
          <input
            className="mono flex-1 rounded bg-ide-panel px-2 py-1 text-[12px] outline-none focus:ring-1 focus:ring-ide-accent"
            placeholder="Type input for the running program, press Enter..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            autoFocus
          />
          <button className="btn btn-accent" onClick={() => void submit()} title="Send to stdin">
            <CornerDownLeft size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
