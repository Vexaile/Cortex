import { useEffect, useState } from 'react'
import { useStore, LAST_WORKSPACE_KEY } from './store/useStore'
import CommandPalette, { type PaletteMode } from './components/CommandPalette'
import Splitter from './components/Splitter'
import TitleBar from './components/TitleBar'
import ActivityBar from './components/ActivityBar'
import SideBar from './components/SideBar'
import EditorArea from './components/EditorArea'
import BottomPanel from './components/BottomPanel'
import StatusBar from './components/StatusBar'
import AiPanel from './components/AiPanel'
import SimulatorView from './components/SimulatorView'
import Welcome from './components/Welcome'
import Splash from './components/Splash'

export default function App(): JSX.Element {
  const {
    workspaceRoot,
    mainView,
    sidebarVisible,
    bottomVisible,
    aiVisible,
    appendOutput,
    handleRunExit,
    handleDiagnostics,
    handleSimEvent,
    handleSimExit,
    appendSerial,
    appendAiDelta,
    finishAi,
    loadSettings,
    detectToolchains,
    refreshBoardStatus,
    refreshTree,
    saveActive,
    runActive,
    toggleSidebar,
    toggleBottom,
    sidebarWidth,
    aiWidth,
    bottomHeight,
    setSidebarWidth,
    setAiWidth,
    setBottomHeight,
    openWorkspace,
    removeRecent
  } = useStore()

  const [palette, setPalette] = useState<PaletteMode | null>(null)
  // booting drives the splash's fade; splashMounted keeps it in the tree until
  // the fade finishes (an invisible full-screen overlay still eats clicks).
  const [booting, setBooting] = useState(true)
  const [splashMounted, setSplashMounted] = useState(true)

  // Subscribe to streamed events from the main process.
  useEffect(() => {
    const unsubs = [
      window.api.onRunOutput(appendOutput),
      window.api.onRunExit(handleRunExit),
      window.api.onRunDiagnostics(handleDiagnostics),
      window.api.onSimEvent(handleSimEvent),
      window.api.onSimExit(handleSimExit),
      window.api.onDebugState((s) => useStore.getState().setDebug(s)),
      window.api.onDebugOutput((o) => useStore.getState().appendDebugOutput(o)),
      window.api.onSerialData((d) => appendSerial(d.data)),
      // Keep s.message: "Access is denied" / "port not found" is the whole
      // explanation, and discarding it left the user with a toggle that did nothing.
      window.api.onSerialStatus((s) =>
        useStore.setState({
          serialOpen: s.open,
          serialError: s.open ? null : (s.message ?? null)
        })
      ),
      window.api.onAiStream((s) => {
        if (s.delta) appendAiDelta(s.delta)
        if (s.done) finishAi(s.error)
      }),
      window.api.onFsEvent(() => {
        void refreshTree()
      })
    ]
    return () => unsubs.forEach((u) => u())
  }, [
    appendOutput,
    handleRunExit,
    handleDiagnostics,
    handleSimEvent,
    handleSimExit,
    appendSerial,
    appendAiDelta,
    finishAi,
    refreshTree
  ])

  // Initial load.
  useEffect(() => {
    // Toolchain and board detection are slow (cold process spawns, up to the
    // probe timeout) and the status bar already narrates them, so they must not
    // hold the splash. They keep running behind it.
    void detectToolchains()
    void refreshBoardStatus()

    // Settings (theme, compiler) and the last workspace DO gate a clean first
    // paint, so the splash waits for them. The minimum duration is so the
    // breathing is seen rather than flashing past on a fast machine.
    const minSplash = new Promise((r) => setTimeout(r, 1200))
    const boot = (async () => {
      await loadSettings()
      // Reopen the last workspace: an IDE that forgets your project every launch
      // makes you re-pick it forever. If it has since moved, forget it quietly.
      const last = localStorage.getItem(LAST_WORKSPACE_KEY)
      if (last) {
        try {
          await openWorkspace(last)
        } catch {
          localStorage.removeItem(LAST_WORKSPACE_KEY)
          removeRecent(last)
        }
      }
    })()
    void Promise.all([minSplash, boot]).then(() => setBooting(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPalette('commands')
      } else if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPalette('files')
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveActive()
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebar()
      } else if (mod && e.key === '`') {
        e.preventDefault()
        toggleBottom()
      } else if (e.key === 'F5') {
        e.preventDefault()
        void runActive()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveActive, toggleSidebar, toggleBottom, runActive])

  // The menu bar lives in the title bar and cannot reach this component's
  // palette state directly, so its Command Palette / Quick Open items post an
  // event here.
  useEffect(() => {
    const onPalette = (e: Event): void => {
      const mode = (e as CustomEvent<PaletteMode>).detail
      if (mode === 'commands' || mode === 'files') setPalette(mode)
    }
    window.addEventListener('cortex:palette', onPalette)
    return () => window.removeEventListener('cortex:palette', onPalette)
  }, [])

  return (
    <div className="flex h-full flex-col bg-ide-bg text-ide-text">
      {splashMounted && <Splash leaving={!booting} onExited={() => setSplashMounted(false)} />}
      {palette && <CommandPalette mode={palette} onClose={() => setPalette(null)} />}
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        {sidebarVisible && (
          <>
            <SideBar />
            <Splitter dir="x" title="Resize sidebar" onDelta={(d) => setSidebarWidth(sidebarWidth + d)} />
          </>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {mainView === 'simulator' ? (
            <SimulatorView />
          ) : workspaceRoot ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <EditorArea />
              {bottomVisible && (
                <>
                  <Splitter dir="y" title="Resize panel" onDelta={(d) => setBottomHeight(bottomHeight - d)} />
                  <BottomPanel />
                </>
              )}
            </div>
          ) : (
            <Welcome />
          )}
        </div>
        {aiVisible && (
          <>
            <Splitter dir="x" title="Resize AI panel" onDelta={(d) => setAiWidth(aiWidth - d)} />
            <AiPanel />
          </>
        )}
      </div>
      <StatusBar />
    </div>
  )
}
