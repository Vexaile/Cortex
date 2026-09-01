import { Play, Square, CheckCircle2, UploadCloud, AlertTriangle, Radio, LineChart, Bug } from 'lucide-react'
import { useStore, isSketch } from '../store/useStore'
import { isHeaderPath } from '@shared/languages'
import BoardPortSelect from './BoardPortSelect'
import TargetSelect from './TargetSelect'

/**
 * The run/build toolbar: the build Target selector for the active file, the
 * primary action buttons (Run / Stop, or the Arduino Verify / Upload / Debug
 * trio), the Board + Port selector, and Serial Monitor / Plotter. It lives on
 * its own row below the title bar so build configuration is no longer crammed
 * into the window chrome. Build config is per-project (ProjectConfig) and lives
 * behind the Target selector (components/TargetSelect.tsx).
 */
export default function Toolbar(): JSX.Element {
  const {
    tabs,
    activePath,
    running,
    runActive,
    stopRun,
    boardStatus,
    selectedFqbn,
    verifyBoard,
    uploadBoard,
    startSim,
    simRunning,
    stopSim,
    setBottom,
    setSerialPlot,
    startDebug,
    debug
  } = useStore()

  const boardsReady = !!boardStatus?.available

  const openSerial = (plot: boolean): void => {
    setSerialPlot(plot)
    // setBottom reveals the panel; a stale-read toggleBottom() would re-close it.
    setBottom('serial')
  }

  const activeTab = tabs.find((t) => t.path === activePath)
  const sketch = isSketch(activePath)
  // A header shares the C++ language entry but is not a translation unit: `g++
  // util.hpp` writes a precompiled header that then fails to execute.
  const header = isHeaderPath(activePath ?? '')
  const isNative = !sketch && !header && (activeTab?.language.id === 'cpp' || activeTab?.language.id === 'c')
  const isRust = activeTab?.language.id === 'rust'
  const isC = activeTab?.language.id === 'c'
  const canRun = !!activeTab?.language.runnable && !header
  const runTitle = header
    ? 'A header is not a program. Open the .cpp/.c that includes it.'
    : canRun
      ? 'Run (F5)'
      : `Cortex cannot run ${activeTab?.language.label ?? 'this'} files`

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-ide-border bg-ide-bar px-2 text-[12px]">
      {/* Build target: compiler / standard / optimization for host C/C++, or
          edition / profile for Rust. Sketches target a board, chosen via the
          Board + Port control further right. */}
      {isNative && <TargetSelect kind={isC ? 'c' : 'cpp'} />}
      {isRust && <TargetSelect kind="rust" />}

      <div className="flex-1" />

      {/* Action buttons (Verify / Upload / Debug for a sketch; Run / Debug for
          host code), then the Board + Port selector to their right the way
          Arduino IDE lays it out. */}
      <div className="flex shrink-0 items-center gap-1 pl-1">
        {running ? (
          <button className="btn bg-ide-red/90 text-white hover:brightness-110" onClick={() => void stopRun()}>
            <Square size={14} /> Stop
          </button>
        ) : sketch ? (
          <>
            {/* Without arduino-cli, Verify/Upload cannot work. Simulate CAN, so it
                becomes the primary action instead of shipping a toolbar whose only
                accent button is disabled. */}
            {!boardsReady && (
              <>
                {/* Same action as the Simulator toolbar's Run, so it carries
                    the same name and the same running state. Without the
                    simRunning arm this stayed an accent primary button that
                    silently did nothing (startSim returns early while a sim is
                    live), which is the normal case: loop() never ends. */}
                {simRunning ? (
                  <button
                    className="btn bg-ide-red/90 text-white hover:brightness-110"
                    onClick={() => void stopSim()}
                    title="Stop the simulation"
                  >
                    <Square size={14} /> Stop
                  </button>
                ) : (
                  <button
                    className="btn btn-accent"
                    onClick={() => void startSim()}
                    title="Run this sketch in the simulator (no hardware needed)"
                  >
                    <Play size={14} /> Run
                  </button>
                )}
                {/* boardStatus.hint already says what is missing, what it
                    unlocks and how to install it. Hardcoding the headline here
                    a second time meant the remedy was computed and thrown
                    away. */}
                <span
                  className="row cursor-help gap-1 rounded border border-ide-border px-1.5 py-0.5 text-[10px] text-ide-muted"
                  title={boardStatus?.hint || 'arduino-cli not found'}
                >
                  <AlertTriangle size={11} className="text-ide-amber" />
                  arduino-cli not found
                </span>
              </>
            )}
            <button
              // Circular icon buttons, the way Arduino IDE draws Verify/Upload.
              // Verify (compile only) is outlined; Upload (writes the chip) is
              // the filled accent, so the more consequential action reads as the
              // primary one.
              className={`grid h-7 w-7 place-items-center rounded-full border border-ide-border bg-ide-bar text-ide-text transition-colors enabled:hover:bg-ide-hover disabled:cursor-not-allowed disabled:opacity-40 ${
                boardsReady ? '' : 'hidden'
              }`}
              onClick={() => void verifyBoard()}
              disabled={!selectedFqbn}
              title="Verify (compile) for the selected board"
            >
              <CheckCircle2 size={16} />
            </button>
            <button
              className={`grid h-7 w-7 place-items-center rounded-full bg-ide-accent text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${
                boardsReady ? '' : 'hidden'
              }`}
              onClick={() => void uploadBoard()}
              disabled={!selectedFqbn}
              title="Compile and upload to the connected board"
            >
              <UploadCloud size={16} />
            </button>
            {/* Debug, third in the Arduino trio. On-chip firmware debug needs a
                hardware probe + OpenOCD, so it is disabled with an honest reason
                rather than silently doing nothing. */}
            <button
              className={`grid h-7 w-7 place-items-center rounded-full border border-ide-border bg-ide-bar text-ide-text transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                boardsReady ? '' : 'hidden'
              }`}
              disabled
              title="On-chip debugging needs a hardware debug probe (coming soon). Host C/C++ debugging works on plain .cpp files."
            >
              <Bug size={16} />
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-accent disabled:opacity-40" onClick={() => void runActive()} disabled={!canRun} title={runTitle}>
              <Play size={14} /> Run
            </button>
            {/* Host C/C++ debugging (gdb): compile with -g and launch a session. */}
            {isNative && (
              <button
                className="btn disabled:opacity-40"
                onClick={() => void startDebug()}
                disabled={debug.status === 'running' || debug.status === 'stopped' || debug.status === 'starting'}
                title="Debug this file with gdb (F5 breakpoints in the gutter)"
              >
                <Bug size={14} /> Debug
              </button>
            )}
          </>
        )}
      </div>

      {/* Board + Port selector, right of the action buttons for a sketch. */}
      {sketch && <BoardPortSelect />}

      {/* Serial Plotter + Serial Monitor, far right, the way Arduino IDE places
          them. Both open the bottom serial panel; the plotter opens it in plot
          mode. */}
      <div className="flex shrink-0 items-center gap-0.5 pl-1">
        <button className="btn" onClick={() => openSerial(true)} title="Serial Plotter">
          <LineChart size={15} />
        </button>
        <button className="btn" onClick={() => openSerial(false)} title="Serial Monitor">
          <Radio size={15} />
        </button>
      </div>
    </div>
  )
}
