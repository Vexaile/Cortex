import { Folder, CircleDot, Cpu, Radio, AlertCircle, CheckCircle2, Braces, MemoryStick } from 'lucide-react'
import { useStore } from '../store/useStore'
import { langForFile, LSP_SERVER_LABEL, LSP_INSTALL_HINT, LSP_BUSY_HINT } from '@shared/lsp'

export default function StatusBar(): JSX.Element {
  const {
    tabs,
    activePath,
    running,
    runPhase,
    lastExitCode,
    serialOpen,
    serialPath,
    toolchains,
    workspaceName,
    setSidebar,
    simRunning,
    lspServers,
    lspBusy,
    projectModel
  } = useStore()
  const board = projectModel?.boards[0]
  const activeTab = tabs.find((t) => t.path === activePath)
  const availCount = toolchains.filter((t) => t.available).length
  // Language-server status for the active file. Null for files no server handles
  // (.ino, .md, ...), so the indicator stays out of the way when irrelevant.
  const lspLang = activePath ? langForFile(activePath) : null
  const lspReady = lspLang ? lspServers[lspLang] : false
  // Installed is not the same as ready: rust-analyzer answers with empty
  // results for as long as it is loading the Cargo workspace.
  const lspIndexing = !!(lspLang && lspReady && lspBusy[lspLang])
  // A simulation is work in progress too. Reading only `running` meant the bar
  // sat idle for the whole of it, which is the app's most-used action.
  const busy = running || simRunning

  return (
    <div className="relative row h-6 shrink-0 justify-between border-t border-ide-border bg-ide-bar px-2 text-[11px] text-ide-muted">
      {/* The one expressive moment: a moving gradient line while building/running. */}
      {busy && (
        <div className="absolute inset-x-0 top-0 h-0.5 animate-gradient-slide bg-cortex-gradient bg-[length:200%_100%]" />
      )}
      <div className="row gap-3">
        <span className="row gap-1">
          {/* A folder icon, not a git branch: Cortex has no git integration
              yet, and a branch glyph here read as a branch indicator that
              does not exist. This labels the open workspace, nothing more. */}
          <Folder size={12} /> {workspaceName || 'no folder'}
        </span>
        {/* The running text is cyan, not the identity navy: navy at 11px on
            ide-bar measures 3.59:1 and fails AA, and this is the one status
            text that exists during every build. Cyan is 7.04:1 and is not
            spoken for here (moss is exit 0, red is failure, amber is unsaved). */}
        {busy ? (
          <span className="row gap-1 text-ide-cyan">
            <CircleDot size={12} className="animate-pulse" />
            {running ? (runPhase === 'compile' ? 'Compiling...' : 'Running...') : 'Simulating...'}
          </span>
        ) : lastExitCode !== null ? (
          <span className={`row gap-1 ${lastExitCode === 0 ? 'text-ide-moss' : 'text-ide-red'}`}>
            {lastExitCode === 0 ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            exit {lastExitCode}
          </span>
        ) : null}
      </div>
      <div className="row gap-3">
        {/* These read as controls (they are in every JetBrains IDE), so make them controls. */}
        <button
          className="row gap-1 rounded px-1 hover:bg-ide-hover hover:text-ide-text"
          onClick={() => setSidebar('serial')}
          title="Open Serial & Devices"
        >
          <Radio size={12} className={serialOpen ? 'text-ide-moss' : ''} /> {serialOpen ? serialPath : 'serial off'}
        </button>
        <button
          className="row gap-1 rounded px-1 hover:bg-ide-hover hover:text-ide-text"
          onClick={() => setSidebar('settings')}
          title="Toolchains & Build settings"
        >
          {/* Empty list means detection has not finished yet; "0 toolchains" would read as a failure. */}
          <Cpu size={12} /> {toolchains.length === 0 ? 'detecting toolchains...' : `${availCount} toolchains`}
        </button>
        {/* Read from platformio.ini, not guessed - see projectModelService.
            Absent for a project that doesn't have one, rather than a wrong board. */}
        {board && (
          <span
            className="row gap-1"
            title={`Board: ${board.name}${board.platform ? `\nPlatform: ${board.platform}` : ''}${board.framework ? `\nFramework: ${board.framework}` : ''}\nFrom platformio.ini [env:${board.env}]`}
          >
            <MemoryStick size={12} /> {board.name}
          </span>
        )}
        {lspLang && (
          <span
            className={`row gap-1 ${lspIndexing ? 'text-ide-cyan' : lspReady ? 'text-ide-moss' : 'text-ide-muted'}`}
            title={
              lspIndexing
                ? LSP_BUSY_HINT[lspLang]
                : lspReady
                  ? `${LSP_SERVER_LABEL[lspLang]} is providing code intelligence (completion, hover, diagnostics)`
                  : `${LSP_SERVER_LABEL[lspLang]} is not installed, so this file has basic highlighting only.\n${LSP_INSTALL_HINT[lspLang]}\nThen press Rescan in Settings; no restart needed.`
            }
          >
            <Braces size={12} className={lspIndexing ? 'animate-pulse' : ''} /> {LSP_SERVER_LABEL[lspLang]}
            {lspIndexing ? ' indexing...' : lspReady ? '' : ' off'}
          </span>
        )}
        {activeTab && (
          <>
            <span>{activeTab.language.label}</span>
            <span>UTF-8</span>
            <span className={activeTab.content !== activeTab.savedContent ? 'text-ide-amber' : ''}>
              {activeTab.content !== activeTab.savedContent ? '● unsaved' : 'saved'}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
