import {
  Play,
  Square,
  Cpu,
  CheckCircle2,
  UploadCloud,
  ChevronDown,
  AlertTriangle,
  Radio,
  LineChart,
  Bug
} from 'lucide-react'
import { useStore, isSketch } from '../store/useStore'
import { isHeaderPath, cDriver, cppDriver } from '@shared/languages'
import { isHostCpp } from '@shared/security'
import type { CppStandard, CStandard } from '@shared/ipc'
import MenuBar from './MenuBar'
import BoardPortSelect from './BoardPortSelect'
import FileIcon from './FileIcon'

const STANDARDS: CppStandard[] = ['c++11', 'c++14', 'c++17', 'c++20', 'c++23', 'c++2c']
const C_STANDARDS: CStandard[] = ['c99', 'c11', 'c17', 'c23']

// appearance-none is load-bearing: without it these render as native Windows combo
// boxes (native chevron, native font, taller box) right next to the primary Run
// button, which instantly reads as "not a real app".
const SELECT_CLASS =
  'h-6 w-full appearance-none rounded border border-ide-border bg-ide-bar pl-2 pr-6 text-[11px] text-ide-text outline-none transition-colors hover:border-ide-faint focus:border-ide-accent'

function Select({
  value,
  onChange,
  title,
  children
}: {
  value: string
  onChange: (v: string) => void
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="relative shrink-0">
      <select className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)} title={title}>
        {children}
      </select>
      <ChevronDown size={11} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-ide-faint" />
    </div>
  )
}
// Every level the validator accepts, so a value already persisted in a
// project's config always matches an option instead of rendering blank.
const OPT_LEVELS = ['-O0', '-O1', '-O2', '-O3', '-Os', '-Ofast', '-Og', '-O']
const RUST_EDITIONS = ['2015', '2018', '2021', '2024']

export default function TitleBar(): JSX.Element {
  const {
    workspaceName,
    tabs,
    activePath,
    running,
    runActive,
    stopRun,
    compiler,
    setCompiler,
    std,
    setStd,
    optimization,
    setOptimization,
    cStd,
    setCStd,
    rustEdition,
    setRustEdition,
    toolchains,
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
  // The stored `compiler` is always the C++ driver, so the options are C++
  // drivers too - but only ones that were actually PROBED and are host
  // compilers. Mapping an available `gcc` up to `g++` manufactured an option
  // for a compiler that may not exist (the gcc package without g++ is a normal
  // Linux install), and running it produced "spawn g++ ENOENT" for something
  // the IDE had just listed. isHostCpp also keeps avr-g++/arm-none-eabi-g++
  // out: they build firmware, not something this machine can run or debug.
  const cppCompilers = Array.from(
    new Set(toolchains.filter((t) => t.available && isHostCpp(t.command)).map((t) => t.command))
  )

  return (
    <div className="drag flex h-9 items-center gap-2 border-b border-ide-border bg-ide-bar px-2 text-[12px]">
      <div className="row gap-1.5 pl-1 font-semibold">
        <div className="grid h-5 w-5 place-items-center rounded-md bg-cortex-gradient">
          <Cpu size={12} className="text-white" />
        </div>
        {/* Solid text: gradient-clipped text at 12px is unreadable and its
            middle third fails contrast. The gradient lives on the mark. */}
        <span className="text-ide-text">Cortex</span>
      </div>

      {/* File / Edit / Sketch / Tools / Help. Open/Save moved into File. */}
      <MenuBar />

      {workspaceName && (
        <span className="row min-w-0 gap-1.5">
          {/* Theme token, not text-white: on the bar surface white is invisible
              in Cortex Light. Matches the "Cortex" wordmark above. */}
          <span className="truncate text-ide-text">
            {workspaceName}
            {activeTab && <span> / {activeTab.name}</span>}
          </span>
          {activeTab && <FileIcon path={activeTab.path} size={13} />}
        </span>
      )}

      <div className="flex-1" />

      {/* Host C/C++ build options */}
      {isNative && (
        <div className="no-drag flex shrink-0 items-center gap-1.5 text-[11px]">
          {/* Show the driver that will ACTUALLY run. A .c file is built by the
              C counterpart, so displaying "g++" while invoking gcc was a lie. */}
          <Select
            value={isC ? cDriver(compiler) : compiler}
            onChange={(v) => setCompiler(isC ? cppDriver(v) : v)}
            title={isC ? 'C compiler' : 'C++ compiler'}
          >
            {/* Must go through the same mapping as the value above, or the
                controlled select matches no option and renders blank for a .c
                file (value 'gcc' vs a lone option 'g++'). */}
            {cppCompilers.length === 0 && (
              <option value={isC ? cDriver(compiler) : compiler}>{isC ? cDriver(compiler) : compiler}</option>
            )}
            {cppCompilers.map((c) => {
              const shown = isC ? cDriver(c) : c
              return (
                <option key={c} value={shown}>
                  {shown}
                </option>
              )
            })}
          </Select>
          {/* A .c file gets C standards. Offering c++23 there was not just
              cosmetic: gcc rejects `-std=c++23` for C outright. */}
          {isC ? (
            <Select value={cStd} onChange={(v) => setCStd(v as CStandard)} title="C standard">
              {C_STANDARDS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          ) : (
            <Select value={std} onChange={(v) => setStd(v as CppStandard)} title="C++ standard">
              {STANDARDS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          )}
          <Select value={optimization} onChange={setOptimization} title="Optimization level">
            {OPT_LEVELS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* Rust build options. Rust was runnable but had no build settings at all,
          so the edition was hardcoded and unreachable from the UI. */}
      {isRust && (
        <div className="no-drag flex shrink-0 items-center gap-1.5 text-[11px]">
          <Select value={rustEdition} onChange={setRustEdition} title="Rust edition">
            {RUST_EDITIONS.map((e) => (
              <option key={e} value={e}>
                edition {e}
              </option>
            ))}
          </Select>
          {/* One `optimization` field is shared with the C/C++ toolbar, so this
              must write a value that select also offers: a bare '-O' left the
              C++ dropdown matching no option (rendering blank) and, once the
              level was validated, downgraded C++ builds to -O0. */}
          <Select
            value={optimization === '-O0' ? '-O0' : '-O2'}
            onChange={setOptimization}
            title="Build profile"
          >
            <option value="-O0">debug</option>
            <option value="-O2">release</option>
          </Select>
        </div>
      )}

      {/* Action buttons (Verify / Upload / Debug for a sketch; Run / Debug for
          host code), then the Board + Port selector to their right the way
          Arduino IDE lays it out. */}
      <div className="no-drag flex shrink-0 items-center gap-1 pl-1">
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
              className={`no-drag grid h-7 w-7 place-items-center rounded-full border border-ide-border bg-ide-bar text-ide-text transition-colors enabled:hover:bg-ide-hover disabled:cursor-not-allowed disabled:opacity-40 ${
                boardsReady ? '' : 'hidden'
              }`}
              onClick={() => void verifyBoard()}
              disabled={!selectedFqbn}
              title="Verify (compile) for the selected board"
            >
              <CheckCircle2 size={16} />
            </button>
            <button
              className={`no-drag grid h-7 w-7 place-items-center rounded-full bg-ide-accent text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${
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
              className={`no-drag grid h-7 w-7 place-items-center rounded-full border border-ide-border bg-ide-bar text-ide-text transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
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
            <button
              className="btn btn-accent disabled:opacity-40"
              onClick={() => void runActive()}
              disabled={!canRun}
              title={runTitle}
            >
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
      <div className="no-drag flex shrink-0 items-center gap-0.5 pl-1">
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
