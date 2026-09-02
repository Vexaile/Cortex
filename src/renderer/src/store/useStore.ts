import { create } from 'zustand'
import type {
  FileNode,
  ToolchainInfo,
  RunOutputChunk,
  RunExit,
  RunDiagnostics,
  Diagnostic,
  SerialPortDescriptor,
  CppStandard,
  CStandard,
  ProjectConfig,
  ProjectModel,
  BoardStatus,
  BoardPort,
  BoardTarget,
  SimEvent,
  SimExit,
  AgentEvent
} from '@shared/ipc'
import { langFromPath, isHeaderPath, cDriver, cppDriver, type LanguageDef } from '@shared/languages'
import { normalizeEol, detectEol, withEol } from '@shared/diff'
import { extractMissingHeaders, type EnvironmentReport } from '@shared/environment'
import { restorePlan, type LockCheck } from '@shared/lockfile'
import type { DatasheetHit, DatasheetDocMeta } from '@shared/datasheet'
import type { LspAvailability } from '@shared/lsp'
import type { DebugState, DebugOutput } from '@shared/ipc'

const IDLE_DEBUG: DebugState = { status: 'idle', stack: [], frame: 0, variables: [] }
import { extractSeries } from '@shared/serialPlot'
import { isHostCpp, hostCppOrNull } from '@shared/security'
import { freeSpawnPoint, clampToSpace, W as SIM_W, H as SIM_H, V1_SPACE } from '@shared/simLayout'
import {
  resolve as resolveGroups,
  addTab as addTabToGroups,
  focusPath as focusPathInGroups,
  focusInGroup as focusPathInGroup,
  focusGroup as focusGroupLayout,
  removeTab as removeTabFromGroups,
  moveTab as moveTabBetweenGroups,
  reorderTab as reorderTabInGroup,
  type ResolvedGroups
} from '@shared/editorGroups'

/** Spread only the store fields a group transition touches (drop the derived
 *  `split` flag, which the UI recomputes). */
function groupPatch(r: ResolvedGroups<Tab>): Pick<State, 'tabs' | 'activePath' | 'activeGroup' | 'groupActive'> {
  return { tabs: r.tabs, activePath: r.activePath, activeGroup: r.activeGroup, groupActive: r.groupActive }
}

/** Languages Cortex builds before it runs, so the status bar shows "Compiling"
 * first. Python/JS go straight to 'run'. */
const COMPILED_LANGS = new Set(['cpp', 'c', 'rust'])

export const isSketch = (path: string | null): boolean => !!path && path.toLowerCase().endsWith('.ino')

export type MainView = 'editor' | 'simulator' | 'settings'

/** Which board the 3D simulator view renders. A view preference, not project
 *  data, so it is not workspace-scoped. The engine still models an Uno. */
export type Sim3dBoardId = 'uno' | 'esp32' | 'pi'

export type SimPartType =
  | 'led'
  | 'rgb'
  | 'button'
  | 'buzzer'
  | 'resistor'
  | 'potentiometer'
  | 'servo'
  | 'ldr'
  | 'thermistor'
  | 'sevenseg'

/** Parts whose value the user drives to feed analogRead/digitalRead. */
export const INPUT_PARTS: SimPartType[] = ['potentiometer', 'ldr', 'thermistor']

/** Named pins each part exposes (order matters for connector layout). */
export const PART_PINS: Record<SimPartType, string[]> = {
  led: ['sig'],
  rgb: ['r', 'g', 'b'],
  button: ['sig'],
  buzzer: ['sig'],
  resistor: ['sig'],
  potentiometer: ['sig'],
  servo: ['sig'],
  ldr: ['sig'],
  thermistor: ['sig'],
  sevenseg: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp']
}

export interface SimPart {
  id: string
  type: SimPartType
  x: number
  y: number
  rotation: number
  color?: string
  /** Named pin -> board pin (null = unconnected). Single-pin parts use 'sig'. */
  pins: Record<string, number | null>
}

export interface WiringTarget {
  partId: string
  pinName: string
}

/**
 * The live pin snapshot. The canvas paints these with no simRunning gate, so
 * every path that ends a run must clear them or the board keeps asserting the
 * pin state of a process that no longer exists (a stopped blink left its LED
 * lit, and whether it did was a coin flip on where loop() happened to be).
 * Shared because there are three such paths and only startSim used to do it.
 */
const SIM_PIN_RESET = { simPinStates: {}, simPinPwm: {}, simPinModes: {} } as const

/**
 * Part ids must be unique across sessions, not just within one. A per-session
 * counter minted `led-1` again after a restore of a saved `led-1`, and every
 * mutator matches by id across the whole array, so the duplicate broadcast:
 * dragging one LED moved both, deleting one deleted both. The default parts
 * used a third scheme (`led-13` = type-pin), which collided with the 13th LED
 * added in a fresh session.
 */
export const mintPartId = (type: string): string => `${type}-${crypto.randomUUID().slice(0, 8)}`

/**
 * A fresh rig: the onboard LED and a button, the two parts a blink or a
 * debounce sketch needs. A function, not a const, because opening another
 * workspace must reset to a new copy rather than share one mutable array.
 */
export const defaultSimParts = (): SimPart[] => [
  { id: mintPartId('led'), type: 'led', x: 470, y: 110, rotation: 0, color: '#E05561', pins: { sig: 13 } },
  { id: mintPartId('button'), type: 'button', x: 175, y: 110, rotation: 0, pins: { sig: 2 } }
]

/**
 * Everything that belongs to one project and must not survive into the next.
 *
 * Exported and named so it can be tested, because the bug this replaces was not
 * a mistake in the reset: it was that the reset listed seven keys and every
 * workspace-scoped key added afterwards was never added here. Opening a second
 * folder carried the first project's circuit, tabs, board target and live
 * processes into it, and saveDiagram then wrote project A's rig into project
 * B's .cortex/diagram.json.
 *
 * Add a key here whenever you add workspace-scoped state. The test in
 * test/workspaceReset.test.ts is what makes forgetting it fail loudly.
 */
export function workspaceScopedReset(): Record<string, unknown> {
  return {
    // tree
    childrenCache: {},
    expanded: new Set<string>(),
    // editor: tabs point at files under the old root, and fsService repoints
    // its write confinement on watchStart, so saving a carried tab is refused.
    tabs: [],
    activePath: null,
    activeGroup: 0,
    groupActive: {},
    reveal: null,
    // simulator
    simParts: defaultSimParts(),
    simSerial: [],
    simInputs: {},
    simWiring: null,
    simBlock: null,
    ...SIM_PIN_RESET,
    simRunning: false,
    simRunId: null,
    // run
    running: false,
    runId: null,
    runPhase: 'idle' as const,
    runAction: null,
    lastExitCode: null,
    output: [],
    diagnostics: [],
    // board target is per project (.cortex/config.json)
    selectedFqbn: '',
    // Derived from the old project's includes + board; re-inspected on demand.
    environmentReport: null,
    envLoading: false,
    // The lock belongs to the old project's .cortex; re-read on demand. lockBusy
    // and lockRestoring are cleared too, so a snapshot/restore in flight during a
    // switch cannot leave the new project's buttons stuck disabled.
    lockCheck: null,
    lockBusy: false,
    lockRestoring: false,
    // The imported document corpus and any query results belong to the old
    // project's .cortex; a switch must not carry them into the next project.
    datasheets: [],
    datasheetResults: [],
    datasheetQuery: '',
    datasheetBusy: false,
    // The agent transcript, staged edits, and conversation all reference the old
    // project's files, so a switch must not carry them (and any in-flight run's
    // events are dropped once agentRunId is cleared).
    agentRunning: false,
    agentRunId: null,
    agentStatus: '',
    agentLog: [],
    agentEdits: [],
    agentMessages: [],
    // Derived from the OLD workspace's files; refreshProjectModel rebuilds it
    // for the new one from openWorkspace, but a switch that never gets there
    // (an early return, a thrown readDir) should not leave the previous
    // project's board/pins showing under the new project's name.
    projectModel: null,
    // Also per project. loadProjectConfig reassigns it, but that returns early
    // when there is no workspace root, and a venv interpreter carried into the
    // next project would run its code under the wrong Python.
    projectPython: '',
    // NOT lspServers/lspBusy. Availability is a property of what is INSTALLED,
    // not of the project, and nothing re-probes it on a plain state reset: the
    // client probes once at startup, so zeroing it here left every language
    // badge reading "off" for the rest of the session after one workspace
    // switch. openWorkspace re-probes explicitly instead, which also clears a
    // crash lockout in main.
    debugRunId: null,
    // A gdb session belongs to the project that started it. Leaving it meant the
    // new runActive guard read a stale 'stopped' and refused every Run in the
    // NEW project, with the offending session belonging to a closed one.
    debug: { status: 'idle' as const, stack: [], frame: 0, variables: [] },
    breakpoints: {},
    // serial payloads are per session, not per project; the port itself is not
    serialLines: [],
    serialCarry: '',
    serialError: null,
    plotSeries: {}
  }
}

export interface RevealLocation {
  path: string
  line: number
  column: number
}

export type RunAction = 'run' | 'verify' | 'upload'

export interface Tab {
  path: string
  name: string
  content: string
  savedContent: string
  language: LanguageDef
  /**
   * Set when the file is not editable text (binary, or too large). The tab
   * shows a placeholder instead of mounting Monaco, which also means it can
   * never be dirtied and so can never be saved back over the original.
   */
  readOnlyReason?: string
  /** Which editor group (pane) this tab lives in: 0 (left, default) or 1
   *  (right, present only while the editor is split). See shared/editorGroups.ts. */
  group: number
}

export interface OutputLine {
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

export interface SerialLine {
  text: string
  ts: number
}

/** A simulator console line. `system` lines are ours (build errors, status),
 *  `serial` lines came from the sketch's Serial.print. Rendering a compile
 *  error as green Serial output is a lie about where it came from. */
export interface SimLine {
  text: string
  kind: 'serial' | 'system'
}

/** Why the simulator is blocked from running: a missing host C++ compiler (the
 *  simulator compiles on this machine), or a file that is not an Arduino sketch.
 *  `path` is the file the block was raised for, so the panel follows that file:
 *  switching to another tab reveals the canvas, and switching back shows the same
 *  (still-accurate) message rather than a stale one naming the wrong file. */
export type SimBlock =
  | { reason: 'compiler'; path: string }
  | { reason: 'not-sketch'; path: string; lines: string[] }

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// ---- AI engineering agent (renderer view of a tool-loop run) --------------

/** One staged, not-yet-applied edit plus its review state. */
export interface AgentEdit {
  id: string
  path: string
  oldContent: string
  newContent: string
  summary?: string
  error?: string
  status: 'pending' | 'applying' | 'approved' | 'rejected' | 'failed' | 'stale'
}

/** An ordered transcript entry the agent panel renders. Tool calls are shown so
 *  the run is auditable; edits reference an entry in `agentEdits`. */
export type AgentEntry =
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'tool'; tool: string; input: string; ok: boolean; result: string }
  | { type: 'edit'; editId: string }
  | { type: 'error'; text: string }

export interface AppSettings {
  theme: 'dark' | 'light'
  defaultCppCompiler: string
  defaultCppStandard: string
  pythonPath: string
  ai: {
    provider: 'anthropic' | 'openai' | 'gemini' | 'local' | 'custom' | 'none'
    model: string
    apiKey: string
    baseUrl: string
    apiKeySet?: boolean
  }
  serial: { baudRate: number }
  boards: { additionalUrls: string[] }
}

export type SidebarView =
  | 'explorer'
  | 'search'
  | 'boards'
  | 'libraries'
  | 'hardware'
  | 'environment'
  | 'debug'
  | 'serial'
  | 'ai'

// What the right dock shows. Datasheets and the Agent are reference/assist
// surfaces that belong on the right, next to the editor; the right-edge rail
// toggles between them (or hides the dock with null).
export type RightView = 'agent' | 'datasheets' | null
export type BottomView = 'output' | 'serial' | 'problems' | 'terminal'

let runCounter = 0
const nextRunId = (): string => `run-${++runCounter}`

// Promise resolver for the themed confirm dialog. Kept module-level (not in the
// store snapshot) so the store never holds a function; the host answers via
// answerConfirm(). Replaces native window.confirm, which renders an unthemed OS
// modal that breaks the Cortex identity.
let confirmResolver: ((ok: boolean) => void) | null = null

/** A pending themed confirmation. `danger` styles the confirm button as a
 *  destructive action. */
export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}
export type ConfirmOptions = ConfirmRequest

// Latest-wins guard for environment inspects: a slow earlier inspect must not
// clobber the report of a newer one (e.g. after a board change).
let envInspectSeq = 0
// Same guard for lock checks, which also re-run on a board change.
let lockCheckSeq = 0
// Latest-wins for datasheet queries, so a slow earlier query cannot clobber a
// newer one's results.
let datasheetQuerySeq = 0
/** Set when an upload closed the serial monitor, so we can reopen it after. */
let reopenSerialAfterUpload = false

/**
 * Shared setup for a streamed arduino-cli package operation (core/lib install,
 * remove, update-index): reveal the Output panel, mark the app busy, then run.
 * Completion arrives via handleRunExit (phase 'run'), which clears `running`.
 */
// A package op streams asynchronously: fn(id) only STARTS it, and completion
// arrives later as a RUN_EXIT event handled by handleRunExit. These waiters let
// runPackageOp resolve when the op actually FINISHES (not when it starts), so a
// caller can sequence several installs - handleRunExit resolves the waiter for
// the run id on every terminal exit.
const pkgOpWaiters = new Map<string, () => void>()
function resolvePkgOp(id: string): void {
  const w = pkgOpWaiters.get(id)
  if (w) {
    pkgOpWaiters.delete(id)
    w()
  }
}

async function runPackageOp(
  get: () => State,
  set: (partial: Partial<State>) => void,
  fn: (id: string) => Promise<void>
): Promise<void> {
  if (get().running) return
  const id = nextRunId()
  set({
    runId: id,
    running: true,
    runAction: null,
    runPhase: 'run',
    lastExitCode: null,
    output: [],
    diagnostics: [],
    bottomView: 'output',
    bottomVisible: true
  })
  const done = new Promise<void>((resolve) => pkgOpWaiters.set(id, resolve))
  try {
    await fn(id)
  } catch (err) {
    // The op never started, so no RUN_EXIT will come: resolve the waiter here so
    // a sequencing caller is not left hanging.
    resolvePkgOp(id)
    set({
      running: false,
      runPhase: 'idle',
      lastExitCode: 1,
      output: [{ stream: 'stderr', text: `Operation failed: ${String(err)}\n` }]
    })
    return
  }
  // Resolve on actual completion (RUN_EXIT), so `await installLib(...)` means the
  // install finished, not merely began.
  await done
}

interface State {
  // workspace / tree
  workspaceRoot: string | null
  workspaceName: string
  recents: RecentWorkspace[]
  removeRecent: (path: string) => void
  tree: FileNode[]
  childrenCache: Record<string, FileNode[]>
  expanded: Set<string>

  // editor
  tabs: Tab[]
  activePath: string | null
  /** 1-based cursor position in the focused editor, or null when none is focused. */
  cursorPos: { line: number; column: number } | null
  /** Which editor group has focus (0 or 1). activePath is always the active
   *  tab of this group. */
  activeGroup: number
  /** The active tab path within each group, so both panes remember their
   *  selection while the editor is split. */
  groupActive: Record<number, string | null>

  // layout
  mainView: MainView
  sim3dBoard: Sim3dBoardId
  sidebarView: SidebarView
  sidebarVisible: boolean
  bottomView: BottomView
  bottomVisible: boolean
  /** Which tool the right dock shows (Agent / Datasheets), or null when hidden. */
  rightView: RightView
  sidebarWidth: number
  aiWidth: number
  bottomHeight: number

  // simulator
  simRunId: string | null
  simRunning: boolean
  simPinStates: Record<number, number>
  simPinPwm: Record<number, boolean>
  simPinModes: Record<number, number>
  simParts: SimPart[]
  simWiring: WiringTarget | null // (part, pin) awaiting a board-pin click, or null
  simInputs: Record<number, number> // user-driven pin inputs (buttons, pots)
  simSerial: SimLine[]
  /** Why the simulator cannot run this sketch, shown as a friendly full-stage
   *  state (a missing host compiler, or a non-sketch file) instead of a cryptic
   *  serial line. Null when the sim can run. */
  simBlock: SimBlock | null
  /** True while recheckCompiler is re-scanning after a "no compiler" block. */
  simRechecking: boolean

  // toolchains + build config
  toolchains: ToolchainInfo[]
  compiler: string
  std: CppStandard
  optimization: string

  // derived project model: languages, board/platform, GPIO usage
  projectModel: ProjectModel | null

  // run
  runId: string | null
  running: boolean
  runPhase: 'idle' | 'compile' | 'run'
  runAction: RunAction | null
  lastExitCode: number | null
  output: OutputLine[]
  diagnostics: Diagnostic[]
  reveal: RevealLocation | null

  // language servers (which are installed; set once the editor initialises LSP)
  lspServers: LspAvailability
  setLspServers: (a: LspAvailability) => void
  /** Servers still loading/indexing: installed, but cannot answer yet. */
  lspBusy: Partial<Record<string, boolean>>
  setLspBusy: (lang: string, busy: boolean) => void

  // embedded boards
  boardStatus: BoardStatus | null
  environmentReport: EnvironmentReport | null
  envLoading: boolean
  /** A pending themed confirmation dialog, or null. Driven by confirm(). */
  confirmDialog: ConfirmRequest | null
  /** Show a themed confirm dialog and resolve true (confirmed) / false. Replaces
   *  window.confirm so destructive prompts match the Cortex identity. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  /** The dialog host calls this with the user's choice. */
  answerConfirm: (ok: boolean) => void

  /** The stored environment lock paired with its drift, or null when there is
   *  no lock (reproducibility: see @shared/lockfile). */
  lockCheck: LockCheck | null
  lockBusy: boolean
  /** True while a restore-from-lock is installing the locked versions. */
  lockRestoring: boolean

  // datasheet / document intelligence
  /** Imported documents in this project (.cortex/datasheets manifest). */
  datasheets: DatasheetDocMeta[]
  /** The latest query's retrieved passages with citations. */
  datasheetResults: DatasheetHit[]
  datasheetQuery: string
  datasheetBusy: boolean
  boards: BoardPort[]
  boardTargets: BoardTarget[]
  selectedFqbn: string

  // serial
  ports: SerialPortDescriptor[]
  serialOpen: boolean
  serialPlot: boolean
  serialPath: string
  serialBaud: number
  serialLines: SerialLine[]
  serialCarry: string
  serialError: string | null
  plotSeries: Record<string, number[]>

  // ai
  chat: ChatMessage[]
  aiStreaming: boolean

  // ai engineering agent
  agentMode: boolean // panel shows the agent (task) view vs plain chat
  agentRunning: boolean
  agentRunId: string | null
  agentStatus: string // transient "Thinking..." line while running
  agentLog: AgentEntry[]
  agentEdits: AgentEdit[]
  agentMessages: ChatMessage[] // the conversation sent to the model

  // settings
  settings: AppSettings | null

  // ---- actions ----
  openWorkspace: (path: string) => Promise<void>
  /** Close the current folder and return to the Welcome screen, saving dirty
   *  tabs and tearing down the workspace's processes, watchers, and servers. */
  closeWorkspace: () => Promise<void>
  refreshTree: () => Promise<void>
  toggleDir: (node: FileNode) => Promise<void>
  openFile: (path: string) => Promise<void>
  setActive: (path: string) => void
  closeTab: (path: string) => void
  /** Focus a tab within a specific editor group (a tab-strip click). */
  setActiveInGroup: (group: number, path: string) => void
  /** Make an editor group the focused one (a click inside its pane). */
  focusGroup: (group: number) => void
  /** Move a tab into another editor group. Moving to group 1 when it does not
   *  exist yet splits the editor; moving the last tab out of a group collapses
   *  it. This is the drag-to-split action. */
  moveTabToGroup: (path: string, group: number) => void
  /** Reorder a tab within its own group (drag-to-reorder). */
  reorderTab: (path: string, toIndex: number) => void
  updateContent: (path: string, content: string) => void
  /** Report the focused editor's cursor position for the status bar. */
  setCursor: (pos: { line: number; column: number } | null) => void
  /** Reflect a change made to a file outside the editor (e.g. a rename
   *  refactor that already rewrote it on disk): set the tab's content AND
   *  savedContent to the new text, so it shows the change and is not falsely
   *  marked dirty. No-op if the file has no open tab. */
  applyExternalEdit: (path: string, content: string) => void
  saveActive: () => Promise<void>
  saveAll: () => Promise<void>
  renameEntry: (path: string, newName: string) => Promise<void>
  deleteEntry: (path: string) => Promise<void>
  createNewFile: (dir: string, name: string) => Promise<void>
  createNewFolder: (dir: string, name: string) => Promise<void>

  setMainView: (v: MainView) => void
  setSim3dBoard: (b: Sim3dBoardId) => void
  setSidebarWidth: (w: number) => void
  setAiWidth: (w: number) => void
  setBottomHeight: (h: number) => void
  setSidebar: (v: SidebarView) => void
  toggleSidebar: () => void
  setBottom: (v: BottomView) => void
  openTerminal: () => void
  toggleBottom: () => void
  setSerialPlot: (on: boolean) => void
  /** Toggle the Agent in the right dock (kept as toggleAi for its many callers). */
  toggleAi: () => void
  /** Show a tool in the right dock, or hide it when it is already showing. */
  setRightView: (v: 'agent' | 'datasheets') => void

  // simulator
  startSim: () => Promise<void>
  stopSim: () => Promise<void>
  /** Re-scan the toolchains after a "no compiler" block and, if one is now
   *  found, run the simulation. */
  recheckCompiler: () => Promise<void>
  handleSimEvent: (e: SimEvent) => void
  handleSimExit: (e: SimExit) => void
  addPart: (type: SimPartType) => void
  movePart: (id: string, x: number, y: number) => void
  rotatePart: (id: string) => void
  setPartColor: (id: string, color: string) => void
  removePart: (id: string) => void
  beginWire: (partId: string, pinName: string) => void
  attachWire: (boardPin: number) => void
  cancelWire: () => void
  detachWire: (partId: string, pinName: string) => void
  setSimInput: (pin: number, value: number) => void
  saveDiagram: () => Promise<void>
  loadDiagram: () => Promise<void>

  detectToolchains: (force?: boolean) => Promise<void>
  refreshProjectModel: () => Promise<void>
  setCompiler: (c: string) => void
  setStd: (s: CppStandard) => void
  setOptimization: (o: string) => void
  rustEdition: string
  setRustEdition: (e: string) => void
  cStd: CStandard
  setCStd: (s: CStandard) => void
  /** Per-project extra compiler flags from .cortex/config.json. */
  extraArgs: string[]
  /** Per-project Python interpreter (a venv), '' when the project pins none. */
  projectPython: string
  /** Id the debug build's diagnostics arrive under, so Problems accepts them. */
  debugRunId: string | null

  runActive: () => Promise<void>
  stopRun: () => Promise<void>
  clearOutput: () => void
  appendOutput: (c: RunOutputChunk) => void
  handleRunExit: (e: RunExit) => void
  handleDiagnostics: (d: RunDiagnostics) => void
  sendRunInput: (text: string) => Promise<void>
  revealLocation: (path: string, line: number, column: number) => Promise<void>
  clearReveal: () => void

  // project config
  loadProjectConfig: () => Promise<void>
  persistProjectConfig: (patch: ProjectConfig) => Promise<void>

  // embedded boards
  refreshBoardStatus: () => Promise<void>
  inspectEnvironment: (refresh?: boolean) => Promise<void>
  /** Load the stored lock and its drift against the current environment. */
  checkLock: () => Promise<void>
  /** Snapshot the current installed environment to the lockfile, then re-check. */
  snapshotEnvironment: () => Promise<void>
  /** Install the locked versions of every drifted core/library (through the same
   *  gated, streamed path as a user-triggered install), then re-check. */
  restoreFromLock: () => Promise<void>
  /** Open a native dialog to import a document into the project's corpus. */
  importDatasheet: () => Promise<void>
  /** Reload the imported-document list for the open project. */
  refreshDatasheets: () => Promise<void>
  /** Retrieve cited passages for a query (latest-wins). */
  queryDatasheets: (query: string) => Promise<void>
  refreshBoards: () => Promise<void>
  refreshBoardTargets: () => Promise<void>
  setFqbn: (fqbn: string) => void
  /** Pick a board and its upload/monitor port together (the toolbar selector). */
  setBoardAndPort: (fqbn: string, port: string) => void
  verifyBoard: () => Promise<void>
  uploadBoard: () => Promise<void>

  // Boards Manager (cores) + Library Manager. Search/list are read directly from
  // window.api by the panels; these run the streamed install/remove operations.
  installCore: (name: string, version?: string) => Promise<void>
  uninstallCore: (coreId: string) => Promise<void>
  updateCoreIndex: () => Promise<void>
  installLib: (name: string, version?: string) => Promise<void>
  uninstallLib: (name: string) => Promise<void>

  // debugger (gdb, host C/C++)
  debug: DebugState
  breakpoints: Record<string, number[]> // file path -> line numbers
  setDebug: (s: DebugState) => void
  appendDebugOutput: (o: DebugOutput) => void
  startDebug: () => Promise<void>
  stopDebug: () => void
  debugContinue: () => void
  debugStepOver: () => void
  debugStepInto: () => void
  debugStepOut: () => void
  debugPause: () => void
  selectDebugFrame: (level: number) => void
  toggleBreakpoint: (file: string, line: number) => void

  refreshPorts: () => Promise<void>
  toggleSerial: () => Promise<void>
  setSerialPath: (p: string) => void
  setSerialBaud: (b: number) => Promise<void>
  appendSerial: (data: string) => void
  clearSerial: () => void

  sendChat: (text: string, context?: string) => Promise<void>
  appendAiDelta: (delta: string) => void
  finishAi: (error?: string) => void

  setAgentMode: (on: boolean) => void
  runAgent: (text: string) => Promise<void>
  cancelAgent: () => void
  clearAgent: () => void
  handleAgentEvent: (e: AgentEvent) => void
  approveAgentEdit: (id: string) => Promise<void>
  rejectAgentEdit: (id: string) => void

  loadSettings: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  /** Switch and persist the app theme. App applies it to <html data-theme>. */
  setTheme: (theme: 'dark' | 'light') => Promise<void>
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() || p

// ---- resizable layout -----------------------------------------------------
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))
export const LAYOUT_LIMITS = {
  sidebar: { min: 180, max: 560 },
  ai: { min: 260, max: 620 },
  bottom: { min: 120, max: 640 }
}
function lsNum(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : fallback
  } catch {
    return fallback
  }
}
function lsSet(key: string, v: number): void {
  try {
    localStorage.setItem(key, String(v))
  } catch {
    /* storage unavailable */
  }
}
function lsBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}
function lsSetBool(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
}

/** A workspace the user has opened before. An IDE that forgets your project on
 *  every launch makes you re-pick it forever, and pushes your hand onto whatever
 *  button is nearest. */
export interface RecentWorkspace {
  path: string
  name: string
  ts: number
}
const RECENTS_KEY = 'cortex.recents'
export const LAST_WORKSPACE_KEY = 'cortex.lastWorkspace'
function loadRecents(): RecentWorkspace[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
/** Normalize a path for cross-source comparison (case + separators on Windows). */
export const normPath = (p: string): string => p.toLowerCase().replace(/\\/g, '/')

export const useStore = create<State>((set, get) => ({
  workspaceRoot: null,
  workspaceName: '',
  recents: loadRecents(),
  tree: [],
  childrenCache: {},
  expanded: new Set(),

  tabs: [],
  activePath: null,
  cursorPos: null,
  activeGroup: 0,
  groupActive: {},

  mainView: 'editor',
  sim3dBoard: 'uno',
  sidebarView: 'explorer',
  sidebarVisible: true,
  bottomView: 'output',
  bottomVisible: true,
  // JetBrains-style: the AI assistant is a tool window you opt into, not
  // something that claims editor width before you've asked for it. Remembered
  // per-machine after that, the same way its width already is.
  rightView: ((): RightView => {
    const v = localStorage.getItem('cortex.rightView')
    if (v === 'agent' || v === 'datasheets') return v
    // A stored value that is neither (the '' written on close) is an explicit
    // "hidden" and must win, or a closed dock would never stick. Only when the
    // key was never written do we fall back to the legacy aiVisible flag,
    // carrying a previously-open AI panel over to the Agent dock.
    if (v !== null) return null
    return lsBool('cortex.aiVisible', false) ? 'agent' : null
  })(),
  sidebarWidth: lsNum('cortex.sidebarWidth', 256),
  aiWidth: lsNum('cortex.aiWidth', 320),
  bottomHeight: lsNum('cortex.bottomHeight', 256),

  simRunId: null,
  simRunning: false,
  simPinStates: {},
  simPinPwm: {},
  simPinModes: {},
  // Positions live in the SimCanvas design space (see W/H there).
  simParts: defaultSimParts(),
  simWiring: null,
  simInputs: {},
  simSerial: [],
  simBlock: null,
  simRechecking: false,

  toolchains: [],
  projectModel: null,
  compiler: 'g++',
  std: 'c++23',
  rustEdition: '2021',
  cStd: 'c17',
  extraArgs: [],
  projectPython: '',
  debugRunId: null,
  optimization: '-O0',

  runId: null,
  running: false,
  runPhase: 'idle',
  runAction: null,
  lastExitCode: null,
  output: [],
  diagnostics: [],
  reveal: null,

  lspServers: { cpp: false, python: false, rust: false },
  // NOT workspace-scoped: dispose() pushes busy:false for a server it kills, and
  // a server KEPT across a re-open of the same folder is still indexing. Wiping
  // this here made the renderer disagree with main, with no resync path.
  lspBusy: {},
  setLspBusy: (lang, busy) => set({ lspBusy: { ...get().lspBusy, [lang]: busy } }),
  setLspServers: (lspServers) => set({ lspServers }),

  debug: IDLE_DEBUG,
  breakpoints: {},

  boardStatus: null,
  boards: [],
  boardTargets: [],
  confirmDialog: null,
  environmentReport: null,
  envLoading: false,
  lockCheck: null,
  lockBusy: false,
  lockRestoring: false,
  datasheets: [],
  datasheetResults: [],
  datasheetQuery: '',
  datasheetBusy: false,
  selectedFqbn: '',

  ports: [],
  serialOpen: false,
  serialPlot: false,
  serialPath: '',
  serialBaud: 115200,
  serialLines: [],
  serialCarry: '',
  serialError: null,
  plotSeries: {},

  chat: [],
  aiStreaming: false,

  agentMode: lsBool('cortex.agentMode', true),
  agentRunning: false,
  agentRunId: null,
  agentStatus: '',
  agentLog: [],
  agentEdits: [],
  agentMessages: [],

  settings: null,

  async openWorkspace(path) {
    // Kill anything belonging to the old project first. Both guards return
    // silently when their flag is set, so a surviving simRunning made the
    // Simulator's Run button dead in the new project (loop() never ends, so
    // this is the normal case, not a race).
    await get().stopRun()
    await get().stopSim()
    // A debug session holds a gdb process and the old project's executable, and
    // nothing else stops it: the state reset alone would leave that gdb running.
    get().stopDebug()
    get().cancelAgent() // stop an in-flight agent task bound to the old project
    await window.api.watchStop()
    const tree = await window.api.readDir(path)
    set({
      ...workspaceScopedReset(),
      workspaceRoot: path,
      workspaceName: baseName(path),
      tree
    })
    await window.api.watchStart(path)
    // The old project's shell is rooted in a folder the user has left, so tear
    // it down like the other project processes. Done AFTER watchStart (which
    // sets the main-process workspace root) and the store update above, so when
    // a visible terminal respawns it does so in the NEW workspace, never racing
    // ahead of the root switch. No-op if the terminal was never opened.
    window.__cortexTerminal?.dispose()
    // Free the previous project's language servers (each holds a background
    // index in memory); keep only this root's.
    void window.api.lspDisposeRoot(path)

    // Remember it: reopened on next launch, and listed on Welcome.
    const entry: RecentWorkspace = { path, name: baseName(path), ts: Date.now() }
    const recents = [entry, ...get().recents.filter((r) => normPath(r.path) !== normPath(path))].slice(0, 8)
    set({ recents })
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
      localStorage.setItem(LAST_WORKSPACE_KEY, path)
    } catch {
      /* storage unavailable */
    }

    await get().loadProjectConfig()
    await get().loadDiagram()
    void get().refreshBoardStatus()
    void get().refreshProjectModel()
    // Re-probe language servers for the new root. The `true` also clears a
    // crash lockout in main, so a server that kept dying on the PREVIOUS
    // project gets a fresh chance in this one rather than staying off.
    void window.api.lspServers(true).then((a) => set({ lspServers: a }))
  },
  async closeWorkspace() {
    if (!get().workspaceRoot) return
    // Save first: closing must never silently drop a dirty tab. saveAll skips
    // binary/oversized tabs, which cannot be dirty anyway.
    await get().saveAll()
    // Same teardown as switching projects (openWorkspace does this before
    // opening the next one), just with no next one to open.
    await get().stopRun()
    await get().stopSim()
    get().stopDebug()
    get().cancelAgent()
    await window.api.watchStop()
    const root = get().workspaceRoot
    if (root) void window.api.lspDisposeRoot(root)
    set({
      ...workspaceScopedReset(),
      workspaceRoot: null,
      workspaceName: '',
      tree: [],
      // App shows Welcome only when the main view is not the simulator; a folder
      // closed from the simulator would otherwise leave a blank canvas.
      mainView: 'editor'
    })
    // Kill the shell AFTER clearing workspaceRoot, so the terminal panel (which
    // guards respawn on an open workspace) tears down to Welcome without
    // spawning a stray shell in the home directory.
    window.__cortexTerminal?.dispose()
    // Do not reopen this folder on next launch now that it was deliberately closed.
    try {
      localStorage.removeItem(LAST_WORKSPACE_KEY)
    } catch {
      /* storage unavailable */
    }
  },
  removeRecent(path) {
    const recents = get().recents.filter((r) => normPath(r.path) !== normPath(path))
    set({ recents })
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
    } catch {
      /* storage unavailable */
    }
  },

  async refreshTree() {
    const { workspaceRoot, expanded } = get()
    if (!workspaceRoot) return
    const tree = await window.api.readDir(workspaceRoot)
    const cache: Record<string, FileNode[]> = {}
    for (const dir of expanded) {
      try {
        cache[dir] = await window.api.readDir(dir)
      } catch {
        /* directory may have been removed */
      }
    }
    set({ tree, childrenCache: cache })
  },

  async toggleDir(node) {
    const { expanded, childrenCache } = get()
    const next = new Set(expanded)
    if (next.has(node.path)) {
      next.delete(node.path)
      set({ expanded: next })
    } else {
      next.add(node.path)
      const cache = { ...childrenCache }
      if (!cache[node.path]) cache[node.path] = await window.api.readDir(node.path)
      set({ expanded: next, childrenCache: cache })
    }
  },

  async openFile(path) {
    const { tabs } = get()
    // Match case-insensitively / separator-insensitively so a diagnostic path
    // (forward slashes, from gcc) focuses the existing tab instead of duplicating.
    const existing = tabs.find((t) => normPath(t.path) === normPath(path))
    if (existing) {
      // Focus it in whichever group already holds it, and show the editor.
      set({ ...groupPatch(focusPathInGroups(get(), existing.path)), mainView: 'editor' })
      return
    }
    const read = await window.api.readFile(path)
    const content = read.kind === 'text' ? read.content : ''
    const readOnlyReason =
      read.kind === 'binary'
        ? 'This is a binary file, so Cortex will not open it as text.'
        : read.kind === 'too-large'
          ? `This file is ${(read.size / (1024 * 1024)).toFixed(1)} MB, too large to open in the editor.`
          : undefined
    // Re-read tabs AFTER the await: the captured list is stale if another file
    // was opened while this read was in flight, which would drop that tab.
    const raced = get().tabs.find((t) => normPath(t.path) === normPath(path))
    if (raced) {
      // Activate the tab's OWN path string. Consumers look tabs up with strict
      // equality, so activating a differently-spelled path (gcc's forward
      // slashes vs the explorer's backslashes) would blank the editor pane.
      set({ ...groupPatch(focusPathInGroups(get(), raced.path)), mainView: 'editor' })
      return
    }
    // addTab assigns the tab to (and focuses) whichever group is active, so a
    // file opened while the right pane has focus opens there.
    set({
      ...groupPatch(
        addTabToGroups(get(), { path, name: baseName(path), content, savedContent: content, language: langFromPath(path), readOnlyReason })
      ),
      // Opening a file shows it: leave the Settings surface / Simulator.
      mainView: 'editor'
    })
  },

  setActive(path) {
    // Focusing a file returns to the editor: a file click from the explorer
    // while the Settings surface (or the Simulator) is up should show the file.
    set({ ...groupPatch(focusPathInGroups(get(), path)), mainView: 'editor' })
  },
  setCursor(pos) {
    // Skip no-op writes so a click that lands on the same spot does not churn
    // the store (the status bar subscribes to this).
    const cur = get().cursorPos
    if (cur?.line === pos?.line && cur?.column === pos?.column) return
    set({ cursorPos: pos })
  },

  setActiveInGroup(group, path) {
    set(groupPatch(focusPathInGroup(get(), group, path)))
  },

  focusGroup(group) {
    set(groupPatch(focusGroupLayout(get(), group)))
  },

  moveTabToGroup(path, group) {
    set(groupPatch(moveTabBetweenGroups(get(), path, group)))
  },

  reorderTab(path, toIndex) {
    set(groupPatch(reorderTabInGroup(get(), path, toIndex)))
  },

  async closeTab(path) {
    const closing = get().tabs.find((t) => t.path === path)
    // Guard against silent data loss on unsaved edits (themed confirm).
    if (closing && closing.content !== closing.savedContent) {
      const ok = await get().confirm({
        title: 'Discard unsaved changes?',
        message: `"${closing.name}" has changes that haven't been saved. Discard them?`,
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        danger: true
      })
      if (!ok) return
    }
    set(groupPatch(removeTabFromGroups(get(), path)))
  },

  updateContent(path, content) {
    set({ tabs: get().tabs.map((t) => (t.path === path ? { ...t, content } : t)) })
  },

  applyExternalEdit(path, content) {
    set({
      tabs: get().tabs.map((t) =>
        normPath(t.path) === normPath(path) ? { ...t, content, savedContent: content } : t
      )
    })
  },

  async saveActive() {
    const { tabs, activePath } = get()
    const tab = tabs.find((t) => t.path === activePath)
    if (!tab) return
    // A binary/oversized tab holds '' (there is no editor to hold anything
    // else), so saving it would truncate the real file to zero bytes. Ctrl+S,
    // the File menu, the palette and every run/debug/upload path call this, so
    // the refusal has to live here rather than in the editor.
    if (tab.readOnlyReason) return
    // Mark clean against the content we actually WROTE. Reading t.content after
    // the await would mark keystrokes made during the write as saved, and the
    // dirty-close guard would then stay silent while they are lost.
    const written = tab.content
    await window.api.writeFile(tab.path, written)
    set({ tabs: get().tabs.map((t) => (t.path === tab.path ? { ...t, savedContent: written } : t)) })
  },

  async saveAll() {
    const written = get()
      .tabs.filter((t) => t.content !== t.savedContent)
      .map((t) => ({ path: t.path, content: t.content }))
    await Promise.all(written.map((w) => window.api.writeFile(w.path, w.content)))
    // Only mark the tabs we actually wrote, against what we wrote.
    set({
      tabs: get().tabs.map((t) => {
        const w = written.find((x) => x.path === t.path)
        return w ? { ...t, savedContent: w.content } : t
      })
    })
  },

  async renameEntry(path, newName) {
    const sep = path.includes('\\') ? '\\' : '/'
    const dir = path.replace(/[\\/][^\\/]+$/, '')
    const newPath = dir + sep + newName
    await window.api.rename(path, newPath)
    // Update any open tabs for the renamed file, or files under a renamed folder.
    const tabs = get().tabs.map((t) => {
      if (normPath(t.path) === normPath(path)) return { ...t, path: newPath, name: newName }
      if (normPath(t.path).startsWith(normPath(path) + '/')) {
        const np = newPath + t.path.slice(path.length)
        return { ...t, path: np, name: baseName(np) }
      }
      return t
    })
    // The panes render groupActive, not activePath, so the per-group active
    // paths have to follow the rename too. Remap them (file and files under a
    // renamed folder) and re-resolve so both panes point at the renamed tabs.
    const remap = (p: string | null): string | null => {
      if (!p) return p
      if (normPath(p) === normPath(path)) return newPath
      if (normPath(p).startsWith(normPath(path) + '/')) return newPath + p.slice(path.length)
      return p
    }
    const groupActive = { 0: remap(get().groupActive[0] ?? null), 1: remap(get().groupActive[1] ?? null) }
    set(groupPatch(resolveGroups({ tabs, activeGroup: get().activeGroup, groupActive })))
    await get().refreshTree()
  },
  async deleteEntry(path) {
    await window.api.deletePath(path)
    const remaining = get().tabs.filter(
      (t) => normPath(t.path) !== normPath(path) && !normPath(t.path).startsWith(normPath(path) + '/')
    )
    // Re-resolve so a deleted active tab, an emptied group, or a stale
    // active-group index are all repaired (rather than resurfacing as a blank
    // pane or a phantom re-split on the next open).
    set(groupPatch(resolveGroups({ tabs: remaining, activeGroup: get().activeGroup, groupActive: get().groupActive })))
    await get().refreshTree()
  },
  async createNewFile(dir, name) {
    const sep = dir.includes('\\') ? '\\' : '/'
    const p = dir + sep + name
    await window.api.createFile(p)
    await get().refreshTree()
    await get().openFile(p)
  },
  async createNewFolder(dir, name) {
    const sep = dir.includes('\\') ? '\\' : '/'
    await window.api.createDir(dir + sep + name)
    await get().refreshTree()
  },

  setMainView(v) {
    set({ mainView: v })
  },
  setSim3dBoard(b) {
    set({ sim3dBoard: b })
  },
  setSidebarWidth(w) {
    const v = clamp(Math.round(w), LAYOUT_LIMITS.sidebar.min, LAYOUT_LIMITS.sidebar.max)
    set({ sidebarWidth: v })
    lsSet('cortex.sidebarWidth', v)
  },
  setAiWidth(w) {
    const v = clamp(Math.round(w), LAYOUT_LIMITS.ai.min, LAYOUT_LIMITS.ai.max)
    set({ aiWidth: v })
    lsSet('cortex.aiWidth', v)
  },
  setBottomHeight(h) {
    const v = clamp(Math.round(h), LAYOUT_LIMITS.bottom.min, LAYOUT_LIMITS.bottom.max)
    set({ bottomHeight: v })
    lsSet('cortex.bottomHeight', v)
  },
  setSidebar(v) {
    const { sidebarView, sidebarVisible } = get()
    // The sidebar is a column of its own: App renders it next to whichever main
    // view is up, so it is on screen in the Simulator too and its visibility has
    // nothing to do with mainView. Clicking the panel you are already looking at
    // collapses it; anything else opens that panel where you are, without
    // yanking you back to the editor.
    if (sidebarView === v && sidebarVisible) set({ sidebarVisible: false })
    else set({ sidebarView: v, sidebarVisible: true })
  },
  toggleSidebar() {
    set({ sidebarVisible: !get().sidebarVisible })
  },
  setSerialPlot(on) {
    set({ serialPlot: on })
  },
  setBottom(v) {
    // The bottom dock only renders in the editor view, so every entry point that
    // reveals a dock tab (rail Problems, the serial accelerator, the toolbar
    // chips) must leave the Settings surface / Simulator first, the way
    // openTerminal already does - otherwise the click silently flips state with
    // nothing on screen.
    set({ mainView: 'editor', bottomView: v, bottomVisible: true })
  },
  openTerminal() {
    // The bottom dock (and the terminal) only render in the editor view of an
    // open workspace, so every terminal entry point routes through here: leave
    // the simulator first, and no-op with no workspace (the menu item that
    // advertises it is disabled in that state). Without this, Ctrl+`, the Tools
    // item, and the palette command silently did nothing from the simulator or
    // the Welcome screen.
    if (!get().workspaceRoot) return
    set({ mainView: 'editor', bottomView: 'terminal', bottomVisible: true })
  },
  toggleBottom() {
    set({ bottomVisible: !get().bottomVisible })
  },
  toggleAi() {
    const v: RightView = get().rightView === 'agent' ? null : 'agent'
    set({ rightView: v })
    localStorage.setItem('cortex.rightView', v ?? '')
  },
  setRightView(v) {
    const next: RightView = get().rightView === v ? null : v
    set({ rightView: next })
    localStorage.setItem('cortex.rightView', next ?? '')
  },

  async startSim() {
    const { tabs, activePath, workspaceRoot, simRunning, compiler } = get()
    if (simRunning || !activePath) return
    const tab = tabs.find((t) => t.path === activePath)
    if (!tab) return
    // The simulator compiles on the host, so without a C++ toolchain it would
    // die as "spawn g++ ENOENT" in the serial pane. detectToolchains already
    // knows; ask it and give a real remedy instead.
    // Await detection rather than skipping the check when it has not finished:
    // Welcome -> New sketch -> folder pick -> startSim beats the on-mount probe
    // on a cold machine, which is precisely the case this remedy exists for.
    if (get().toolchains.length === 0) await get().detectToolchains()
    const cpp = get().toolchains.find((t) => t.available && isHostCpp(t.command))
    if (!cpp) {
      // A friendly full-stage state with a per-OS install command and a Recheck
      // button, not five cryptic lines in the serial pane. This is the single
      // most common first-run wall: New Sketch -> blinking LED silently needs a
      // host compiler.
      set({ mainView: 'simulator', simBlock: { reason: 'compiler', path: activePath }, simSerial: [] })
      return
    }
    // The simulator appends its own main(), so a plain C++ file that already has
    // one fails with "multiple definition of main". Only run real sketches.
    const hasMain = /^\s*(int|void)\s+main\s*\(/m.test(tab.content)
    const hasSetupLoop = /\bvoid\s+setup\s*\(/.test(tab.content) && /\bvoid\s+loop\s*\(/.test(tab.content)
    if (!isSketch(activePath) && (hasMain || !hasSetupLoop)) {
      set({
        mainView: 'simulator',
        simSerial: [],
        simBlock: {
          reason: 'not-sketch',
          path: activePath,
          lines: [
            `Cannot simulate ${tab.name}.`,
            'The simulator runs Arduino sketches: a file with setup() and loop() and no main().',
            // Points at a control the user can reach. The old text named
            // examples/blink/blink.ino, a path that exists in the Cortex repo and
            // not in the workspace they have open.
            'Open a .ino sketch and press Run, or use New sketch on the Welcome screen to get one.'
          ]
        }
      })
      return
    }
    await get().saveActive()
    const id = `sim-${crypto.randomUUID()}`
    const cwd = workspaceRoot || activePath.replace(/[\\/][^\\/]+$/, '')
    set({
      simRunId: id,
      simRunning: true,
      ...SIM_PIN_RESET,
      simInputs: {},
      simSerial: [],
      simBlock: null,
      mainView: 'simulator'
    })
    try {
      await window.api.simStart({ id, filePath: activePath, cwd, compiler })
    } catch (err) {
      set({ simRunning: false, simSerial: [{ text: `Failed to start simulation: ${String(err)}`, kind: 'system' }] })
    }
  },
  async recheckCompiler() {
    set({ simRechecking: true })
    // Force a fresh scan: a user who just installed a compiler needs the cached
    // detection cleared, exactly what Rescan does.
    await get().detectToolchains(true)
    set({ simRechecking: false })
    const cpp = get().toolchains.find((t) => t.available && isHostCpp(t.command))
    // Found one: clear the block and run. Still missing: leave the guidance up.
    if (cpp) {
      set({ simBlock: null })
      await get().startSim()
    }
  },
  async stopSim() {
    const { simRunId } = get()
    if (simRunId) await window.api.simStop(simRunId)
    // simRunId deliberately survives: the sketch is still flushing its last
    // Serial output in response to @stop, and handleSimEvent/handleSimExit both
    // drop events whose id does not match, so clearing it here threw that
    // output away. handleSimExit clears it when the process is actually gone.
    set({ simRunning: false, ...SIM_PIN_RESET })
  },
  handleSimEvent(e) {
    if (e.id !== get().simRunId) return
    if (e.kind === 'mode') {
      set({ simPinModes: { ...get().simPinModes, [e.pin]: e.value } })
    } else if (e.kind === 'pin') {
      set({
        simPinStates: { ...get().simPinStates, [e.pin]: e.value },
        simPinPwm: { ...get().simPinPwm, [e.pin]: false }
      })
    } else if (e.kind === 'pwm') {
      set({
        simPinStates: { ...get().simPinStates, [e.pin]: e.value },
        simPinPwm: { ...get().simPinPwm, [e.pin]: true }
      })
    } else if (e.kind === 'tone') {
      // Buzzer: nonzero frequency = sounding.
      set({ simPinStates: { ...get().simPinStates, [e.pin]: e.value > 0 ? 1 : 0 } })
    } else if (e.kind === 'serial' || e.kind === 'system') {
      set({ simSerial: [...get().simSerial, { text: e.text, kind: e.kind }].slice(-500) })
    }
  },
  handleSimExit(e) {
    if (e.id !== get().simRunId) return
    // This is the common path (natural exit and compile failure both land
    // here), so it must clear everything stopSim does.
    set({ simRunning: false, simRunId: null, ...SIM_PIN_RESET })
  },
  addPart(type) {
    const id = mintPartId(type)
    const color = type === 'led' ? '#6FB65A' : type === 'rgb' ? '#C58BE6' : undefined
    const pins = Object.fromEntries(PART_PINS[type].map((name) => [name, null]))
    set({
      simParts: [
        ...get().simParts,
        { id, type, ...freeSpawnPoint(get().simParts), rotation: 0, color, pins }
      ]
    })
  },
  movePart(id, x, y) {
    // Clamped like every other producer of a part position. Pointer capture
    // keeps a drag alive outside the SVG, so raw coordinates could strand a
    // part where it is invisible and unclickable, and saveDiagram would then
    // write that to disk.
    const at = clampToSpace({ x, y })
    set({ simParts: get().simParts.map((p) => (p.id === id ? { ...p, ...at } : p)) })
  },
  rotatePart(id) {
    set({ simParts: get().simParts.map((p) => (p.id === id ? { ...p, rotation: (p.rotation + 90) % 360 } : p)) })
  },
  setPartColor(id, color) {
    set({ simParts: get().simParts.map((p) => (p.id === id ? { ...p, color } : p)) })
  },
  removePart(id) {
    set({
      simParts: get().simParts.filter((p) => p.id !== id),
      simWiring: get().simWiring?.partId === id ? null : get().simWiring
    })
  },
  beginWire(partId, pinName) {
    const w = get().simWiring
    set({ simWiring: w && w.partId === partId && w.pinName === pinName ? null : { partId, pinName } })
  },
  attachWire(boardPin) {
    const w = get().simWiring
    if (!w) return
    set({
      simParts: get().simParts.map((p) =>
        p.id === w.partId ? { ...p, pins: { ...p.pins, [w.pinName]: boardPin } } : p
      ),
      simWiring: null
    })
  },
  cancelWire() {
    set({ simWiring: null })
  },
  detachWire(partId, pinName) {
    set({
      simParts: get().simParts.map((p) =>
        p.id === partId ? { ...p, pins: { ...p.pins, [pinName]: null } } : p
      )
    })
  },
  setSimInput(pin, value) {
    set({ simInputs: { ...get().simInputs, [pin]: value } })
    const { simRunId, simRunning } = get()
    if (simRunning && simRunId) void window.api.simInput(simRunId, pin, value)
  },
  async saveDiagram() {
    const root = get().workspaceRoot
    if (!root) return
    const sep = root.includes('\\') ? '\\' : '/'
    const dir = `${root}${sep}.cortex`
    await window.api.createDir(dir)
    // version 2 = the 660x520 design space. v1 files used 920x640 and must be
    // scaled on load, so the version MUST be written or they are indistinguishable.
    await window.api.writeFile(`${dir}${sep}diagram.json`, JSON.stringify({ version: 2, parts: get().simParts }, null, 2))
  },
  async loadDiagram() {
    const root = get().workspaceRoot
    if (!root) return
    const sep = root.includes('\\') ? '\\' : '/'
    const file = `${root}${sep}.cortex${sep}diagram.json`
    // Authoritative: every path must land on a definite set of parts. Returning
    // early left whatever the previous project had on the canvas, and
    // saveDiagram would then write those parts into this project's file.
    // A workspace with no diagram is the common case, not an error. Probing
    // first keeps it off the throw path (and out of the main process log).
    if (!(await window.api.exists(file))) return set({ simParts: defaultSimParts() })
    try {
      const read = await window.api.readFile(file)
      if (read.kind !== 'text') return set({ simParts: defaultSimParts() })
      const data = JSON.parse(read.content)
      if (!Array.isArray(data.parts)) return set({ simParts: defaultSimParts() })
      {
        // v1 coordinates were authored in the old 920x640 space. Applying them
        // verbatim in the 660x520 space strands parts outside the viewBox, where
        // they are invisible AND unclickable, so they can never be dragged back.
        const oldSpace = !data.version || data.version < 2
        const sx = SIM_W / V1_SPACE.w
        const sy = SIM_H / V1_SPACE.h
        const parts: SimPart[] = data.parts.map((p: SimPart & { pin?: number | null }) => {
          const withPins = p.pins ? p : { ...p, pins: { sig: p.pin ?? null } }
          return oldSpace
            ? { ...withPins, ...clampToSpace({ x: Math.round(withPins.x * sx), y: Math.round(withPins.y * sy) }) }
            : withPins
        })
        set({ simParts: parts })
      }
    } catch {
      // Corrupt or unreadable: a definite empty canvas beats the last
      // project's parts silently masquerading as this one's.
      set({ simParts: defaultSimParts() })
    }
  },

  async detectToolchains(force) {
    const chains = await window.api.detectToolchains(force)
    const cppAvail = chains.find((c) => c.available && isHostCpp(c.command))
    set({ toolchains: chains })
    // A rescan is exactly when a language server the user just installed should
    // become visible; without re-probing, availability stayed cached from
    // startup and only a full restart picked it up.
    if (force) {
      void window.api.lspServers(true).then((a) => set({ lspServers: a }))
    }
    if (cppAvail && !chains.find((c) => c.command === get().compiler && c.available)) {
      set({ compiler: cppAvail.command })
    }
  },
  async refreshProjectModel() {
    const root = get().workspaceRoot
    if (!root) return
    const model = await window.api.buildProjectModel(root)
    // The workspace can have changed while the scan was running (it walks up
    // to 8000 files); only apply a result that's still for the current one.
    if (get().workspaceRoot === root) set({ projectModel: model })
  },
  setCompiler(c) {
    set({ compiler: c })
    void get().persistProjectConfig({ compiler: c })
  },
  setStd(s) {
    set({ std: s })
    void get().persistProjectConfig({ std: s })
  },
  setCStd(v) {
    set({ cStd: v })
    void get().persistProjectConfig({ cStd: v })
  },
  setRustEdition(e) {
    set({ rustEdition: e })
    void get().persistProjectConfig({ rustEdition: e })
  },
  setOptimization(o) {
    set({ optimization: o })
    void get().persistProjectConfig({ optimization: o })
  },

  async runActive() {
    const { tabs, activePath, workspaceRoot, running, compiler, std, optimization, settings } = get()
    if (running) return
    const tab = tabs.find((t) => t.path === activePath)
    if (!tab) return
    // F5, the Monaco keybinding, the palette and the Sketch menu all reach here
    // without the toolbar's gating, so a bare `return` made Run look broken:
    // zero pixels changed. Always say why instead.
    const say = (text: string): void => {
      set({ bottomVisible: true, bottomView: 'output', output: [{ stream: 'system', text }] })
    }
    if (!tab.language.runnable) {
      say(`Cortex has no runner for ${tab.language.label} files. They are edit-only here.\n`)
      return
    }
    // startDebug refuses while a run is active; the reverse was never enforced,
    // so Run during a debug session started a second process against the same
    // build directory while the debugger's stack and variables stayed on screen.
    const dbg = get().debug.status
    if (dbg !== 'idle' && dbg !== 'exited') {
      say('A debug session is running. Stop it before running this file.\n')
      return
    }
    // A header is not a program: `g++ util.hpp -o util.exe` exits 0 and writes a
    // precompiled header, which then fails to execute.
    if (isHeaderPath(tab.path)) {
      say('A header is not a program. Open the .cpp/.c that includes it and run that.\n')
      return
    }
    // An Arduino sketch must never be handed to the host compiler: `g++ blink.ino`
    // fails with "file format not recognized". F5 / the command palette reach this
    // path even though the toolbar hides Run for sketches, so route them properly.
    if (isSketch(activePath)) {
      const { boardStatus, selectedFqbn } = get()
      if (boardStatus?.available && selectedFqbn) return get().verifyBoard()
      return get().startSim()
    }
    await get().saveActive()
    const id = nextRunId()
    const cwd = workspaceRoot || tab.path.replace(/[\\/][^\\/]+$/, '')
    set({
      runId: id,
      running: true,
      runAction: 'run',
      // Languages that build before they run. Rust was missing, so the status
      // bar claimed "Running..." for the whole rustc/cargo compile.
      runPhase: COMPILED_LANGS.has(tab.language.id) ? 'compile' : 'run',
      lastExitCode: null,
      output: [],
      diagnostics: [],
      bottomView: 'output',
      bottomVisible: true
    })
    try {
      await window.api.runStart({
        id,
        filePath: tab.path,
        language: tab.language.id,
        cwd,
        // A .c file must go to the C driver. runnerService has an `isC ? 'gcc'`
        // fallback, but it is dead code because this field is always populated,
        // so g++ silently compiled C as C++ (rejecting valid void* conversions).
        compiler: tab.language.id === 'c' ? cDriver(compiler) : compiler,
        std: tab.language.id === 'c' ? get().cStd : std,
        optimization,
        rustEdition: get().rustEdition,
        // Per-project extra compiler flags. Parsed from .cortex/config.json into
        // the store but never forwarded, so setting them did nothing.
        extraArgs: get().extraArgs,
        // Fall back to whichever interpreter was actually probed. `python` does
        // not exist on most macOS/Linux hosts, where only `python3` is on PATH,
        // and Settings would show a green check while Run failed with ENOENT.
        // A repo's venv beats the app-wide interpreter, but it is sent in its
        // own field: main trusts these two differently.
        projectPython: get().projectPython,
        pythonPath:
          settings?.pythonPath ||
          get().toolchains.find((t) => t.id === 'python' && t.available)?.command ||
          get().toolchains.find((t) => t.id === 'python3' && t.available)?.command ||
          'python'
      })
    } catch (err) {
      set({
        running: false,
        runPhase: 'idle',
        runAction: null,
        output: [{ stream: 'stderr', text: `Failed to start run: ${String(err)}\n` }]
      })
    }
  },
  async stopRun() {
    const { runId } = get()
    if (runId) await window.api.runStop(runId)
    // Clear runId so late output/exit/diagnostics for the stopped run are ignored.
    set({ running: false, runPhase: 'idle', runAction: null, runId: null })
  },
  clearOutput() {
    set({ output: [] })
  },
  appendOutput(c) {
    if (c.id !== get().runId) return
    // Cap the buffer so a runaway program (e.g. while(1) printf) can't grow it
    // without bound and exhaust memory.
    const next = [...get().output, { stream: c.stream, text: c.data }]
    set({ output: next.length > 5000 ? next.slice(-5000) : next })
  },
  handleRunExit(e) {
    // Resolve a package-op sequencing waiter for this run id first, independent
    // of the runId guard below (a package op is the only thing that registers a
    // waiter, and it emits exactly one terminal RUN_EXIT).
    resolvePkgOp(e.id)
    if (e.id !== get().runId) return
    const { runAction } = get()
    // Board verify/upload: the compile step is terminal (no run phase follows).
    if (runAction === 'verify' || runAction === 'upload') {
      set({ running: false, runPhase: 'idle', runAction: null, lastExitCode: e.code })
      if (runAction === 'upload' && reopenSerialAfterUpload) {
        reopenSerialAfterUpload = false
        void get().toggleSerial() // reopen the monitor we closed for the flash
      }
      return
    }
    if (e.phase === 'compile' && e.code !== 0) {
      set({ running: false, runPhase: 'idle', runAction: null, lastExitCode: e.code })
    } else if (e.phase === 'run') {
      set({ running: false, runPhase: 'idle', runAction: null, lastExitCode: e.code })
    } else if (e.phase === 'compile') {
      // compile succeeded → the run phase begins
      set({ runPhase: 'run' })
    }
  },
  handleDiagnostics(d) {
    // Sim compile errors arrive under simRunId; they belong in Problems too.
    // Sim compile errors arrive under simRunId and debug build errors under
    // debugRunId; both belong in Problems. Omitting debugRunId here made the
    // whole debug-diagnostics path dead code, and since startDebug also clears
    // `diagnostics`, a previous Run's errors were wiped with nothing replacing
    // them - strictly worse than not having tried.
    if (d.id !== get().runId && d.id !== get().simRunId && d.id !== get().debugRunId) return
    set({ diagnostics: d.diagnostics })
    if (d.diagnostics.length > 0 && d.id === get().simRunId) {
      // The simulator view does not render the bottom panel, so surfacing
      // Problems there would show nothing. Return to the editor, where the
      // clickable diagnostics and Monaco markers actually live.
      set({ mainView: 'editor', bottomView: 'problems', bottomVisible: true })
    }
  },
  async sendRunInput(text) {
    const { runId, running } = get()
    if (!runId || !running) return
    await window.api.runInput(runId, text + '\n')
    set({ output: [...get().output, { stream: 'system', text: `> ${text}\n` }] })
  },
  async revealLocation(path, line, column) {
    await get().openFile(path)
    set({ reveal: { path, line, column } })
  },
  clearReveal() {
    set({ reveal: null })
  },

  async refreshPorts() {
    const ports = await window.api.serialList()
    set({ ports })
    if (!get().serialPath && ports.length) set({ serialPath: ports[0].path })
  },
  async toggleSerial() {
    const { serialOpen, serialPath, serialBaud } = get()
    if (serialOpen) {
      await window.api.serialClose()
      // The carry is a partial line from this session. Left behind, it gets
      // glued onto the first line of the next one and plotted as a fused value.
      set({ serialOpen: false, serialCarry: '' })
    } else if (serialPath) {
      const ok = await window.api.serialOpen({ path: serialPath, baudRate: serialBaud })
      set({ serialOpen: ok, serialCarry: '' })
    }
  },
  setSerialPath(p) {
    set({ serialPath: p })
  },
  async setSerialBaud(b) {
    set({ serialBaud: b })
    // The rate is read only when the port opens, so changing it mid-session
    // used to move the dropdown and nothing else: the SerialPort kept its
    // constructor-time rate and the user watched the garbage that produces.
    void get().updateSettings({ serial: { baudRate: b } })
    if (get().serialOpen && get().serialPath) {
      await window.api.serialClose()
      const ok = await window.api.serialOpen({ path: get().serialPath, baudRate: b })
      set({ serialOpen: ok, serialCarry: '' })
    }
  },
  appendSerial(data) {
    // Buffer across chunk boundaries; only COMPLETE lines are shown and plotted
    // (parsing raw chunks would split a value like `24` + `.5` across reads).
    const buf = get().serialCarry + data
    const parts = buf.split(/\r?\n/)
    const carry = parts.pop() ?? ''
    const plot = { ...get().plotSeries }
    const newLines = [...get().serialLines]
    for (const line of parts) {
      newLines.push({ text: line, ts: performance.now() })
      const series = extractSeries(line)
      for (const key of Object.keys(series)) {
        plot[key] = [...(plot[key] || []), series[key]].slice(-200)
      }
    }
    set({ serialLines: newLines.slice(-2000), serialCarry: carry, plotSeries: plot })
  },
  clearSerial() {
    set({ serialLines: [], serialCarry: '', plotSeries: {} })
  },

  async sendChat(text, context) {
    const chat = [...get().chat, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: '' }]
    set({ chat, aiStreaming: true, rightView: 'agent' })
    const id = `ai-${performance.now()}`
    await window.api.aiComplete({
      id,
      messages: chat.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
      context
    })
  },
  appendAiDelta(delta) {
    const chat = [...get().chat]
    if (chat.length) chat[chat.length - 1] = { ...chat[chat.length - 1], content: chat[chat.length - 1].content + delta }
    set({ chat })
  },
  finishAi(error) {
    if (error) {
      const chat = [...get().chat]
      if (chat.length) chat[chat.length - 1] = { role: 'assistant', content: `⚠️ ${error}` }
      set({ chat })
    }
    set({ aiStreaming: false })
  },

  setAgentMode(on) {
    set({ agentMode: on })
    lsSetBool('cortex.agentMode', on)
  },

  async runAgent(text) {
    if (!text.trim() || get().agentRunning) return
    const root = get().workspaceRoot
    if (!root) return
    const messages = [...get().agentMessages, { role: 'user' as const, content: text }]
    const id = `agent-${performance.now()}`
    set({
      agentRunning: true,
      agentRunId: id,
      agentMessages: messages,
      rightView: 'agent',
      agentStatus: 'Thinking...',
      agentLog: [...get().agentLog, { type: 'user', text }]
    })
    try {
      await window.api.agentRun({
        id,
        messages,
        workspaceRoot: root,
        activePath: get().activePath ?? undefined,
        diagnostics: get().diagnostics
      })
    } catch (e) {
      get().handleAgentEvent({ id, kind: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },

  cancelAgent() {
    const id = get().agentRunId
    if (id) window.api.agentCancel(id)
    // Clear the run id too, so late events from the in-flight request (which the
    // main process cannot interrupt) are dropped by handleAgentEvent's id gate
    // rather than streaming text, tool chips, or an approvable edit into a run
    // the user stopped.
    set({ agentRunning: false, agentStatus: '', agentRunId: null })
  },

  clearAgent() {
    if (get().agentRunning) return
    set({ agentLog: [], agentEdits: [], agentMessages: [], agentStatus: '' })
  },

  handleAgentEvent(e) {
    // Drop events from a superseded run (a workspace switch clears agentRunId).
    if (e.id !== get().agentRunId) return
    if (e.kind === 'status') {
      set({ agentStatus: e.text })
    } else if (e.kind === 'text') {
      const log = [...get().agentLog]
      const last = log[log.length - 1]
      // Coalesce consecutive text into one assistant bubble; a tool call between
      // two text blocks starts a fresh bubble.
      if (last && last.type === 'assistant') log[log.length - 1] = { type: 'assistant', text: last.text + e.delta }
      else log.push({ type: 'assistant', text: e.delta })
      set({ agentLog: log })
    } else if (e.kind === 'tool') {
      set({ agentLog: [...get().agentLog, { type: 'tool', tool: e.tool, input: e.input, ok: e.ok, result: e.result }] })
    } else if (e.kind === 'edit') {
      const editId = `edit-${get().agentEdits.length}-${Math.round(performance.now())}`
      const edit: AgentEdit = { id: editId, ...e.edit, status: e.edit.error ? 'failed' : 'pending' }
      set({ agentEdits: [...get().agentEdits, edit], agentLog: [...get().agentLog, { type: 'edit', editId }] })
    } else if (e.kind === 'error') {
      set({ agentLog: [...get().agentLog, { type: 'error', text: e.error }], agentRunning: false, agentStatus: '' })
    } else if (e.kind === 'done') {
      // Fold THIS run's assistant text (after the last user entry) into the
      // conversation so a follow-up task has context.
      const log = get().agentLog
      let from = 0
      for (let i = log.length - 1; i >= 0; i--) if (log[i].type === 'user') { from = i; break }
      const answer = log
        .slice(from)
        .filter((x): x is Extract<AgentEntry, { type: 'assistant' }> => x.type === 'assistant')
        .map((x) => x.text)
        .join('\n')
      const messages = answer.trim()
        ? [...get().agentMessages, { role: 'assistant' as const, content: answer }]
        : get().agentMessages
      set({ agentRunning: false, agentStatus: '', agentMessages: messages })
    }
  },

  async approveAgentEdit(id) {
    const edit = get().agentEdits.find((e) => e.id === id)
    if (!edit || edit.status !== 'pending') return
    const setStatus = (patch: Partial<AgentEdit>): void =>
      set({ agentEdits: get().agentEdits.map((e) => (e.id === id ? { ...e, ...patch } : e)) })

    // Reconcile against reality before clobbering: the file may have changed
    // since the agent proposed this (a prior approved edit, an external tool, or
    // unsaved edits in its open tab). The reviewed diff was oldContent ->
    // newContent, so applying blindly would silently discard those changes.
    const tab = get().tabs.find((t) => normPath(t.path) === normPath(edit.path))
    if (tab && tab.content !== tab.savedContent) {
      setStatus({ status: 'stale', error: `${tab.name} has unsaved edits. Save or reject, then re-run the agent.` })
      return
    }
    let current = ''
    try {
      const r = await window.api.readFile(edit.path)
      if (r.kind !== 'text' && (await window.api.exists(edit.path))) {
        setStatus({ status: 'stale', error: 'The file is no longer a text file.' })
        return
      }
      current = r.kind === 'text' ? r.content : ''
    } catch {
      current = '' // gone since propose: treated as a new file below
    }
    if (normalizeEol(current) !== normalizeEol(edit.oldContent)) {
      setStatus({ status: 'stale', error: 'The file changed since this was proposed. Re-run the agent to see a fresh diff.' })
      return
    }

    // Flip status BEFORE the await so a fast second click cannot write twice.
    setStatus({ status: 'applying' })
    try {
      // Preserve the file's existing line endings so approving does not silently
      // rewrite a CRLF file to LF. writeFile is workspace-confined in main, so
      // the edit passes the same boundary a user edit does; an open tab is
      // synced (undoable via Monaco's controlled value).
      const toWrite = withEol(edit.newContent, detectEol(edit.oldContent || current))
      await window.api.writeFile(edit.path, toWrite)
      if (tab) get().applyExternalEdit(edit.path, toWrite)
      setStatus({ status: 'approved' })
      // Surface a newly created file; a refresh failure must NOT flip an
      // already-applied edit to failed.
      void get().refreshTree()
    } catch (err) {
      setStatus({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  },

  rejectAgentEdit(id) {
    set({
      agentEdits: get().agentEdits.map((e) => (e.id === id && e.status === 'pending' ? { ...e, status: 'rejected' } : e))
    })
  },

  async loadSettings() {
    const s = (await window.api.getSettings()) as AppSettings
    set({
      settings: s,
      compiler: s.defaultCppCompiler || get().compiler,
      std: (s.defaultCppStandard as CppStandard) || get().std,
      serialBaud: s.serial?.baudRate || get().serialBaud
    })
  },
  async updateSettings(patch) {
    const s = (await window.api.setSettings(patch)) as AppSettings
    set({ settings: s })
  },

  async setTheme(theme) {
    await get().updateSettings({ theme })
  },

  async loadProjectConfig() {
    const { workspaceRoot } = get()
    if (!workspaceRoot) return
    const cfg = await window.api.getProjectConfig(workspaceRoot)
    // Authoritative: every one of these is per project (.cortex/config.json), so
    // falling back to get().X carried the previous project's build settings into
    // this one. They resolve here rather than in workspaceScopedReset because
    // that is a pure function with no access to settings or detection.
    //
    // compiler and std are two-level (project, then app default), so an empty
    // project value must land on the app default, not on a literal: hardcoding
    // 'g++' would clobber a clang++ that detection correctly chose on a machine
    // with no g++. boardFqbn has no app-level default, so '' is its floor.
    const s = get().settings
    const detected = get().toolchains.find((t) => t.available && isHostCpp(t.command))?.command
    set({
      // The stored compiler is the canonical C++ driver, and this file is
      // untrusted: normalize it (a project may legitimately write 'gcc') and
      // require a HOST C++ driver. Without the host check a cloned repo could
      // pin 'arm-none-eabi-g++' and Run would exec firmware, or pin 'gcc' and
      // every C++ build would fail to link libstdc++. `detected` one line up is
      // filtered exactly this way already.
      compiler: hostCppOrNull(cfg.compiler) || s?.defaultCppCompiler || detected || 'g++',
      std: ((cfg.std || s?.defaultCppStandard) as CppStandard) || 'c++23',
      optimization: cfg.optimization || '-O0',
      cStd: (cfg.cStd as CStandard) || 'c17',
      rustEdition: cfg.rustEdition || '2021',
      extraArgs: Array.isArray(cfg.extraArgs) ? cfg.extraArgs : [],
      // A per-project interpreter is how a venv is expressed
      // (.venv/Scripts/python.exe). It was in the config schema and in the
      // ProjectConfig type but was never read back, so setting it did nothing.
      // '' means "not set", so the app-level interpreter still applies.
      projectPython: typeof cfg.pythonPath === 'string' ? cfg.pythonPath : '',
      selectedFqbn: cfg.boardFqbn || ''
    })
  },
  async persistProjectConfig(patch) {
    const { workspaceRoot } = get()
    if (!workspaceRoot) return
    await window.api.setProjectConfig(workspaceRoot, patch)
  },

  async refreshBoardStatus() {
    const status = await window.api.boardStatus()
    set({ boardStatus: status })
    if (status.available) {
      void get().refreshBoards()
      // Without this the dropdown never lists installed cores and always falls
      // back to the small hardcoded COMMON_BOARDS list.
      void get().refreshBoardTargets()
    }
  },

  async inspectEnvironment(refresh = false) {
    const root = get().workspaceRoot
    if (!root) {
      set({ environmentReport: null })
      return
    }
    const seq = ++envInspectSeq
    set({ envLoading: true })
    // The last build's compiler diagnostics are certain evidence of missing
    // headers; pass them so the report can confirm 'missing'.
    const buildMissingHeaders = extractMissingHeaders(get().diagnostics)
    try {
      const report = await window.api.envInspect(root, get().selectedFqbn || null, refresh, buildMissingHeaders)
      // Apply only if still the latest inspect, so a slower earlier run cannot
      // overwrite a newer report.
      if (seq === envInspectSeq) set({ environmentReport: report })
    } catch {
      if (seq === envInspectSeq) set({ environmentReport: null })
    } finally {
      if (seq === envInspectSeq) set({ envLoading: false })
    }
  },

  confirm(opts) {
    // Resolve any prior pending confirm as cancelled before opening a new one,
    // so a stale promise never dangles.
    confirmResolver?.(false)
    return new Promise<boolean>((resolve) => {
      confirmResolver = resolve
      set({ confirmDialog: opts })
    })
  },
  answerConfirm(ok) {
    const resolve = confirmResolver
    confirmResolver = null
    set({ confirmDialog: null })
    resolve?.(ok)
  },

  async checkLock() {
    const root = get().workspaceRoot
    if (!root) {
      set({ lockCheck: null })
      return
    }
    const seq = ++lockCheckSeq
    try {
      const lockCheck = await window.api.envLockCheck(root, get().selectedFqbn || null)
      if (seq === lockCheckSeq) set({ lockCheck })
    } catch {
      if (seq === lockCheckSeq) set({ lockCheck: null })
    }
  },

  async snapshotEnvironment() {
    const root = get().workspaceRoot
    if (!root || get().lockBusy) return
    set({ lockBusy: true })
    try {
      await window.api.envLockWrite(root, get().selectedFqbn || null)
      // Re-check so the panel reflects the just-written lock (now in sync).
      await get().checkLock()
    } catch {
      // A failed write leaves the previous lock state untouched.
    } finally {
      set({ lockBusy: false })
    }
  },

  async restoreFromLock() {
    const lc = get().lockCheck
    // Nothing to do if there is no lock, it is already in sync, or an op is
    // already running. Board changes and extras are shown as drift but are
    // deliberately NOT restored (see restorePlan): only installable
    // missing/changed cores and libraries are brought back to the locked version.
    if (!lc || lc.drift.inSync || get().running || get().lockBusy || get().lockRestoring) return
    const plan = restorePlan(lc.drift)
    if (plan.length === 0) return
    set({ lockRestoring: true })
    try {
      for (const step of plan) {
        // runPackageOp now resolves on completion, so these run one at a time
        // through the same gated, streamed path as a user-triggered install.
        if (step.kind === 'core') await get().installCore(step.target, step.version)
        else await get().installLib(step.target, step.version)
        // Stop on the first failed install rather than blindly pressing on: the
        // remaining steps may depend on it, and a half-applied restore should not
        // be silently reported as done.
        if (get().lastExitCode !== 0) break
      }
    } finally {
      set({ lockRestoring: false })
      // Reflect the new reality: the package cache was invalidated at each op's
      // completion, so re-check drift and re-inspect the environment.
      await get().checkLock()
      void get().inspectEnvironment(false)
    }
  },

  async importDatasheet() {
    const root = get().workspaceRoot
    if (!root || get().datasheetBusy) return
    set({ datasheetBusy: true })
    try {
      const res = await window.api.datasheetImport(root)
      if (res.ok) await get().refreshDatasheets()
      // A canceled dialog or a rejected file is a no-op (res.ok false); the panel
      // surfaces res.error transiently through the action's return if needed.
    } catch {
      /* import failed; leave the corpus unchanged */
    } finally {
      set({ datasheetBusy: false })
    }
  },

  async refreshDatasheets() {
    const root = get().workspaceRoot
    if (!root) {
      set({ datasheets: [] })
      return
    }
    try {
      const datasheets = await window.api.datasheetList(root)
      set({ datasheets })
    } catch {
      set({ datasheets: [] })
    }
  },

  async queryDatasheets(query) {
    const root = get().workspaceRoot
    set({ datasheetQuery: query })
    if (!root || !query.trim()) {
      set({ datasheetResults: [] })
      return
    }
    const seq = ++datasheetQuerySeq
    try {
      const results = await window.api.datasheetQuery(root, query)
      if (seq === datasheetQuerySeq) set({ datasheetResults: results })
    } catch {
      if (seq === datasheetQuerySeq) set({ datasheetResults: [] })
    }
  },

  async refreshBoards() {
    const boards = await window.api.boardListConnected()
    set({ boards })
    // Auto-select a detected board's fqbn if we don't have one yet.
    if (!get().selectedFqbn) {
      const detected = boards.find((b) => b.fqbn)
      if (detected?.fqbn) set({ selectedFqbn: detected.fqbn })
    }
  },
  async refreshBoardTargets() {
    const boardTargets = await window.api.boardListAll()
    set({ boardTargets })
  },
  setFqbn(fqbn) {
    // A board change invalidates the previous target's build diagnostics: they
    // describe a different toolchain/core, so they must not linger in Problems
    // or be reused as missing-dependency evidence for the new board.
    const changed = fqbn !== get().selectedFqbn
    set(changed ? { selectedFqbn: fqbn, diagnostics: [] } : { selectedFqbn: fqbn })
    void get().persistProjectConfig({ boardFqbn: fqbn })
  },
  setBoardAndPort(fqbn, port) {
    // One port drives both upload and the serial monitor, the way Arduino's
    // single Board+Port selection does. serialPath is that shared port.
    if (fqbn) {
      const changed = fqbn !== get().selectedFqbn
      set(changed ? { selectedFqbn: fqbn, diagnostics: [] } : { selectedFqbn: fqbn })
      void get().persistProjectConfig({ boardFqbn: fqbn })
    }
    if (port) set({ serialPath: port })
  },

  async verifyBoard() {
    const { tabs, activePath, running, selectedFqbn } = get()
    if (running || !activePath || !selectedFqbn) return
    const tab = tabs.find((t) => t.path === activePath)
    if (!tab) return
    await get().saveActive()
    const id = nextRunId()
    set({
      runId: id,
      running: true,
      runAction: 'verify',
      runPhase: 'compile',
      lastExitCode: null,
      output: [],
      diagnostics: [],
      bottomView: 'output',
      bottomVisible: true
    })
    try {
      await window.api.boardCompile({ id, sketchPath: activePath, fqbn: selectedFqbn })
    } catch (err) {
      set({ running: false, runPhase: 'idle', runAction: null, output: [{ stream: 'stderr', text: `Verify failed: ${String(err)}\n` }] })
    }
  },
  async uploadBoard() {
    const { tabs, activePath, running, selectedFqbn, serialPath, boards, serialOpen } = get()
    if (running || !activePath || !selectedFqbn) return
    const tab = tabs.find((t) => t.path === activePath)
    if (!tab) return
    // Never fall back to boards[0]: with two boards plugged in that silently
    // flashes whichever enumerated first. Require an explicit or unambiguous port.
    const port = serialPath || boards.find((b) => b.fqbn === selectedFqbn)?.address
    if (!port) {
      set({
        output: [
          {
            stream: 'system',
            text:
              boards.length > 1
                ? 'Multiple boards detected. Pick a port in Serial & Devices before uploading.\n'
                : 'No serial port selected. Connect a board and pick a port in Serial & Devices.\n'
          }
        ],
        bottomView: 'output',
        bottomVisible: true
      })
      return
    }
    // arduino-cli needs the port; our own monitor holding it open fails the
    // upload with "Access is denied". Close it first and reopen afterwards.
    if (serialOpen) {
      await window.api.serialClose()
      set({ serialOpen: false })
      reopenSerialAfterUpload = true
    }
    await get().saveActive()
    const id = nextRunId()
    set({
      runId: id,
      running: true,
      runAction: 'upload',
      runPhase: 'compile',
      lastExitCode: null,
      output: [],
      diagnostics: [],
      bottomView: 'output',
      bottomVisible: true
    })
    try {
      await window.api.boardUpload({ id, sketchPath: activePath, fqbn: selectedFqbn, port })
    } catch (err) {
      set({ running: false, runPhase: 'idle', runAction: null, output: [{ stream: 'stderr', text: `Upload failed: ${String(err)}\n` }] })
    }
  },

  // Package operations stream to the Output panel and finish through
  // handleRunExit (phase 'run'). The managers watch `running` to refresh once
  // an operation completes.
  async installCore(name, version) {
    await runPackageOp(get, set, (id) => window.api.coreInstall({ id, name, version }))
  },
  async uninstallCore(coreId) {
    await runPackageOp(get, set, (id) => window.api.coreUninstall(id, coreId))
  },
  async updateCoreIndex() {
    await runPackageOp(get, set, (id) => window.api.coreUpdateIndex(id))
  },
  async installLib(name, version) {
    await runPackageOp(get, set, (id) => window.api.libInstall({ id, name, version }))
  },
  async uninstallLib(name) {
    await runPackageOp(get, set, (id) => window.api.libUninstall(id, name))
  },

  // ---- debugger (gdb) ----
  setDebug(s) {
    set({ debug: s })
    // A stopped session jumps the editor to the current line.
    if (s.status === 'stopped' && s.currentFile && s.currentLine) {
      void get().revealLocation(s.currentFile, s.currentLine, 1)
    }
  },
  appendDebugOutput(o: DebugOutput) {
    const stream: 'stdout' | 'stderr' | 'system' =
      o.stream === 'program' ? 'stdout' : o.stream === 'gdb' ? 'stderr' : 'system'
    set((st) => ({ output: [...st.output, { stream, text: o.text }].slice(-5000) }))
  },
  async startDebug() {
    const { activePath, tabs, workspaceRoot, running, debug, compiler, std, breakpoints } = get()
    if (!activePath || !workspaceRoot || running || debug.status === 'running' || debug.status === 'stopped') return
    const tab = tabs.find((t) => t.path === activePath)
    if (!tab) return
    // DebugPanel's button reaches here without the toolbar's gating, so refuse
    // with a reason rather than a bare return that changes nothing on screen.
    const refuse = (error: string): void => set({ debug: { ...IDLE_DEBUG, status: 'exited', error } })
    if (!tab.language.debuggable) {
      refuse(`Cortex debugs C and C++ with gdb. ${tab.language.label} debugging is not supported yet.`)
      return
    }
    // .ino maps to cpp, so the language check alone would let a sketch through
    // to `g++ blink.ino` and a confusing build failure.
    if (isSketch(activePath)) {
      refuse('Arduino sketches cannot be debugged with host gdb. Use Simulate, or upload to the board.')
      return
    }
    if (isHeaderPath(activePath)) {
      refuse('A header is not a program. Open the .cpp/.c that includes it and debug that.')
      return
    }
    await get().saveActive()
    const bps = Object.entries(breakpoints).flatMap(([file, lines]) => lines.map((line) => ({ file, line })))
    // The debug build's diagnostics travel on the run-diagnostics channel, so
    // it needs an id the renderer will accept. `diagnostics: []` matters as much
    // as `output: []`: every other build-initiating action clears both, and
    // without it a previous Run's errors stayed listed (and stayed applied as
    // Monaco markers) over lines that now compile.
    const debugRunId = nextRunId()
    set({
      debug: { ...IDLE_DEBUG, status: 'starting' },
      debugRunId,
      output: [],
      diagnostics: [],
      bottomView: 'output',
      bottomVisible: true,
      sidebarView: 'debug',
      sidebarVisible: true
    })
    // Same C mapping as the Run path. Sending the canonical C++ driver here
    // meant debugging a .c file compiled it with g++ (as C++), so it could fail
    // to build code that Run builds fine.
    const isCFile = tab.language.id === 'c'
    await window.api.debugStart({
      runId: debugRunId,
      filePath: activePath,
      cwd: workspaceRoot,
      compiler: isCFile ? cDriver(compiler) : compiler,
      std: isCFile ? get().cStd : std,
      // Run sends these; Debug did not, so a project whose flags carry -I/-D
      // built under Run and failed under Debug with a missing-header error that
      // blamed the user's source.
      extraArgs: get().extraArgs,
      breakpoints: bps
    })
  },
  stopDebug() {
    void window.api.debugStop()
    set({ debug: IDLE_DEBUG })
  },
  debugContinue() {
    set((st) => ({ debug: { ...st.debug, status: 'running' } }))
    void window.api.debugContinue()
  },
  debugStepOver() {
    void window.api.debugStepOver()
  },
  debugStepInto() {
    void window.api.debugStepInto()
  },
  debugStepOut() {
    void window.api.debugStepOut()
  },
  debugPause() {
    void window.api.debugPause()
  },
  selectDebugFrame(level) {
    void window.api.debugSelectFrame(level)
  },
  toggleBreakpoint(file, line) {
    const cur = get().breakpoints[file] ?? []
    const next = cur.includes(line) ? cur.filter((l) => l !== line) : [...cur, line].sort((a, b) => a - b)
    set({ breakpoints: { ...get().breakpoints, [file]: next } })
    // Push live to a running session so it takes effect without a restart.
    if (get().debug.status !== 'idle') void window.api.debugSetBreakpoints(file, next)
  }
}))
