import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { Play, Square, CircuitBoard, Plus, Save, AlertTriangle, Radio } from 'lucide-react'
import { useStore, type SimPartType, type Sim3dBoardId } from '../store/useStore'
import SimCanvas, { PartGlyph } from './SimCanvas'
import SimBlockedPanel from './SimBlockedPanel'
import PanelHeader from './PanelHeader'
import EmptyState from './EmptyState'

// three.js is heavy, so the 3D view is only fetched when the user opens it.
const SimCanvas3D = lazy(() => import('./SimCanvas3D'))

// Labels only; the icon is the real part symbol (see PartGlyph).
// Every part here is driven by the engine. A resistor was removed deliberately:
// this engine models logic, not current, so a resistor could only ever be a
// sticker that changes nothing, teaching beginners that resistors are optional.
// Shipping no resistor beats shipping a fake one.
const PALETTE: { type: SimPartType; label: string }[] = [
  { type: 'led', label: 'LED' },
  { type: 'rgb', label: 'RGB' },
  { type: 'button', label: 'Button' },
  { type: 'buzzer', label: 'Buzzer' },
  { type: 'potentiometer', label: 'Pot' },
  { type: 'servo', label: 'Servo' },
  { type: 'ldr', label: 'LDR' },
  { type: 'thermistor', label: 'Temp' },
  { type: 'sevenseg', label: '7-seg' }
]

export default function SimulatorView(): JSX.Element {
  const {
    simRunning,
    simSerial,
    simParts,
    startSim,
    stopSim,
    addPart,
    cancelWire,
    simWiring,
    saveDiagram,
    workspaceRoot,
    activePath,
    tabs,
    selectedFqbn,
    sim3dBoard,
    setSim3dBoard,
    simBlock
  } = useStore()
  const endRef = useRef<HTMLDivElement>(null)
  const activeTab = tabs.find((t) => t.path === activePath)
  const [view, setView] = useState<'2d' | '3d'>('2d')
  // The block belongs to the file that raised it. Show it only over that file,
  // so switching tabs reveals the canvas instead of leaving a stale panel (and a
  // message that may name a file you already closed) plastered over a valid one.
  const blocked = !!simBlock && simBlock.path === activePath

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [simSerial])

  // Esc cancels an in-progress wire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && simWiring) cancelWire()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [simWiring, cancelWire])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-ide-border bg-ide-bg">
      {/* h-9 matches the editor tab bar and the AI panel header, so the top rule
          lines up when switching views (h-11 shifted it 8px). */}
      {/* cq: below the threshold every label here drops to its icon. Truncating
          the filename alone was not enough, and Save layout (the only way to
          persist a circuit) was still clipped off the bar at a 1000px window. */}
      <div className="cq row h-9 shrink-0 items-center gap-2 whitespace-nowrap border-b border-ide-border bg-ide-panel px-3">
        <span className="row shrink-0 gap-1.5 text-[13px] font-semibold" title="Simulator">
          <CircuitBoard size={16} className="text-ide-navy" /> <span className="cq-label">Simulator</span>
        </span>
        {simRunning ? (
          <button className="btn shrink-0 whitespace-nowrap bg-ide-danger text-white" onClick={() => void stopSim()}>
            <Square size={14} /> Stop
          </button>
        ) : (
          <button
            className="btn btn-accent shrink-0 whitespace-nowrap disabled:opacity-40"
            onClick={() => void startSim()}
            disabled={!activeTab}
            title={activeTab ? `Simulate ${activeTab.name}` : 'Open a sketch first'}
          >
            <Play size={14} /> Run
          </button>
        )}
        {/* 2D schematic vs 3D board. Same circuit either way (one store), so the
            toggle is a view switch, not a mode change. */}
        <div className="row shrink-0 overflow-hidden rounded border border-ide-border text-[11px] font-medium">
          {(['2d', '3d'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setView(m)}
              className={`px-2 py-0.5 ${
                view === m ? 'bg-ide-active text-ide-text' : 'text-ide-muted hover:bg-ide-hover hover:text-ide-text'
              }`}
              title={m === '3d' ? '3D board view' : '2D schematic view'}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        {/* Board model for the 3D view. The engine still runs Uno-core, so a
            non-Uno board drives pins at the digital level only. */}
        {view === '3d' && (
          <select
            className="shrink-0 rounded border border-ide-border bg-ide-panel px-1.5 py-0.5 text-[11px] text-ide-text outline-none hover:bg-ide-hover"
            value={sim3dBoard}
            onChange={(e) => setSim3dBoard(e.target.value as Sim3dBoardId)}
            title="3D board model"
          >
            <option value="uno">Arduino Uno</option>
            <option value="esp32">ESP32 DevKit</option>
            <option value="pi">Raspberry Pi</option>
          </select>
        )}
        {/* The label yields, the controls do not. This was shrink-0, so at a
            narrow width it held its full name and pushed Save layout off the
            bar, where it was clipped rather than wrapped: the only way to save
            a circuit silently disappeared. */}
        <span className="cq-label min-w-0 flex-1 truncate text-[11px] text-ide-faint" title={activeTab?.name}>
          {activeTab ? activeTab.name : 'open a sketch to simulate'}
        </span>
        {/* Keeps Save layout pushed right once the filename drops out. */}
        <span className="flex-1" />
        {/* The canvas and the shim are an Uno. Selecting another board in the
            toolbar does not change that, so say it rather than imply otherwise. */}
        {selectedFqbn && !/arduino:avr:(uno|nano|mega)/.test(selectedFqbn) && (
          <span
            className="row shrink-0 gap-1 rounded border border-ide-amber/40 px-1.5 py-0.5 text-[10px] text-ide-amber"
            title="The simulator models an Arduino Uno regardless of the selected board"
          >
            <AlertTriangle size={11} /> simulating an Uno
          </span>
        )}

        <button
          className="btn shrink-0 whitespace-nowrap text-[11px] disabled:opacity-40"
          onClick={() => void saveDiagram()}
          disabled={!workspaceRoot}
          title="Save circuit layout to .cortex/diagram.json"
        >
          <Save size={14} /> <span className="cq-label">Save layout</span>
        </button>
      </div>

      {/* Parts get their own wrapping row. Sharing the toolbar meant 6 of 9 were
          scrolled out of reach at the default window width. */}
      {/* Below ~420px the labels drop to glyphs, which keeps all nine parts on
          one row. Wrapping instead cost four rows of canvas at a 1000px window,
          and the canvas is the thing the user came here for. */}
      <div className="cq row shrink-0 flex-wrap gap-0.5 border-b border-ide-border bg-ide-panel px-3 py-1.5">
        <span className="cq-label mr-1 text-[10px] uppercase tracking-wider text-ide-faint">Add part</span>
        {PALETTE.map(({ type, label }) => (
          <button
            key={type}
            onClick={() => addPart(type)}
            title={blocked ? 'Run a sketch first' : `Add ${label}`}
            // Parts would land on a canvas the blocked panel is covering, so the
            // palette is inert while blocked rather than silently adding hidden parts.
            disabled={blocked}
            className="row shrink-0 gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] text-ide-muted hover:bg-ide-hover hover:text-ide-text disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ide-muted"
          >
            <PartGlyph type={type} size={16} />
            <span className="cq-label">{label}</span>
            <Plus size={9} className="text-ide-faint" />
          </button>
        ))}
      </div>

      {/* stage: canvas gets the full width, serial sits underneath (Wokwi-style) */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* min-w-0 is load-bearing: without it the SVG canvas sets a
            content-based min-width and pushes the whole app layout wider. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 min-w-0 flex-1">
            {blocked ? (
              // Cannot run (no host compiler, or not a sketch): show a clear,
              // actionable state instead of a dead canvas + cryptic serial text.
              <SimBlockedPanel />
            ) : view === '3d' ? (
              <Suspense
                fallback={
                  <div className="grid h-full place-items-center text-[12px] text-ide-faint">Loading 3D board...</div>
                }
              >
                <SimCanvas3D />
              </Suspense>
            ) : (
              <SimCanvas />
            )}
            {!blocked && simParts.length === 0 && (
              <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-ide-border bg-ide-bar/85 px-3 py-1 text-[10px] text-ide-muted">
                Add a part above, then click it and a board pin to wire it.
              </div>
            )}
          </div>
          {/* Honest context about the model, so it belongs on the canvas it
              describes. It is a layout strip rather than an absolute overlay:
              the SVG scales to its box, so any overlay eventually collides with
              the board at some window size. Reserving the space cannot. */}
          <div className="shrink-0 px-3 pb-1.5 text-[10px] leading-snug text-ide-faint">
            <span className="text-ide-on-amber">Logic view</span>: this runs your real code and shows pin signals. It
            does not model current, so a real circuit still needs GND and a resistor per LED.
          </div>
        </div>

        {/* serial strip */}
        <div className="flex h-40 shrink-0 flex-col border-t border-ide-border bg-ide-panel">
          <PanelHeader>Serial output</PanelHeader>
          <div className="mono min-h-0 flex-1 overflow-auto px-3 py-2 text-[12px] leading-relaxed">
            {simSerial.length === 0 ? (
              <EmptyState icon={<Radio size={20} />} mono>
                Serial.print() output from your sketch appears here once you press Run.
              </EmptyState>
            ) : (
              simSerial.map((line, i) => (
                <div
                  key={i}
                  // Build/status lines are ours, not the sketch's Serial output.
                  className={`whitespace-pre-wrap ${line.kind === 'system' ? 'text-ide-amber' : 'text-ide-moss'}`}
                >
                  {line.text}
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>
        </div>
      </div>
    </div>
  )
}
