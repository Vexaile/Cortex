import { useEffect, useMemo, useState } from 'react'
import { Usb, ChevronDown, Search, X, Check } from 'lucide-react'
import { useStore } from '../store/useStore'

// Fallback board list so board selection is usable before `arduino-cli board
// listall` populates (e.g. no cores installed yet).
const COMMON_BOARDS = [
  { name: 'Arduino Uno', fqbn: 'arduino:avr:uno' },
  { name: 'Arduino Nano', fqbn: 'arduino:avr:nano' },
  { name: 'Arduino Mega', fqbn: 'arduino:avr:mega' },
  { name: 'Arduino Leonardo', fqbn: 'arduino:avr:leonardo' },
  { name: 'ESP32 Dev Module', fqbn: 'esp32:esp32:esp32' },
  { name: 'ESP32-S3 Dev Module', fqbn: 'esp32:esp32:esp32s3' },
  { name: 'ESP8266 NodeMCU', fqbn: 'esp8266:esp8266:nodemcuv2' },
  { name: 'Raspberry Pi Pico', fqbn: 'rp2040:rp2040:rpipico' }
]

/**
 * The Arduino-style Board + Port control: one button showing the chosen board
 * and its port, a quick dropdown of detected boards, and a "Select other board
 * and port" dialog (searchable board list + detected ports). One selection
 * drives both upload and the serial monitor.
 */
export default function BoardPortSelect(): JSX.Element {
  const {
    selectedFqbn,
    serialPath,
    boards,
    boardTargets,
    ports,
    refreshPorts,
    refreshBoards,
    setBoardAndPort
  } = useStore()
  const [menu, setMenu] = useState(false)
  const [dialog, setDialog] = useState(false)

  const allBoards = boardTargets.length ? boardTargets : COMMON_BOARDS
  const boardName = useMemo(() => {
    if (!selectedFqbn) return ''
    return (
      allBoards.find((b) => b.fqbn === selectedFqbn)?.name ??
      boards.find((b) => b.fqbn === selectedFqbn)?.boardName ??
      selectedFqbn.split(':').pop() ??
      selectedFqbn
    )
  }, [selectedFqbn, allBoards, boards])

  const refresh = (): void => {
    void refreshPorts()
    void refreshBoards()
  }

  return (
    <div className="no-drag relative shrink-0">
      <button
        className="row h-7 max-w-[220px] items-center gap-1.5 rounded border border-ide-border bg-ide-bar px-2 text-[11px] text-ide-text transition-colors hover:border-ide-faint"
        onClick={() => {
          refresh()
          setMenu((m) => !m)
        }}
        title="Select board and port"
      >
        <Usb size={13} className="shrink-0 text-ide-accent" />
        <span className="truncate">{boardName || 'Select board'}</span>
        {serialPath && <span className="shrink-0 text-ide-faint">· {serialPath}</span>}
        <ChevronDown size={12} className="shrink-0 text-ide-faint" />
      </button>

      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
          <div className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-ide-border bg-ide-panel py-1 shadow-xl">
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-ide-faint">
              Detected boards
            </div>
            {boards.filter((b) => b.address).length === 0 ? (
              <div className="px-3 py-1.5 text-[11px] text-ide-faint">No boards detected.</div>
            ) : (
              boards
                .filter((b) => b.address)
                .map((b) => (
                  <button
                    key={b.address}
                    className="row w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-ide-hover"
                    onClick={() => {
                      setBoardAndPort(b.fqbn ?? selectedFqbn, b.address)
                      setMenu(false)
                    }}
                  >
                    <span className="truncate text-ide-text">{b.boardName ?? 'Unknown board'}</span>
                    <span className="mono shrink-0 text-[10px] text-ide-muted">{b.address}</span>
                  </button>
                ))
            )}
            <div className="my-1 border-t border-ide-border" />
            <button
              className="w-full px-3 py-1.5 text-left text-[12px] text-ide-accent hover:bg-ide-hover"
              onClick={() => {
                setMenu(false)
                setDialog(true)
              }}
            >
              Select other board and port...
            </button>
          </div>
        </>
      )}

      {dialog && (
        <BoardPortDialog
          boards={allBoards}
          ports={ports}
          initialFqbn={selectedFqbn}
          initialPort={serialPath}
          onRefresh={refresh}
          onClose={() => setDialog(false)}
          onConfirm={(fqbn, port) => {
            setBoardAndPort(fqbn, port)
            setDialog(false)
          }}
        />
      )}
    </div>
  )
}

function BoardPortDialog({
  boards,
  ports,
  initialFqbn,
  initialPort,
  onRefresh,
  onClose,
  onConfirm
}: {
  boards: { name: string; fqbn: string }[]
  ports: { path: string; manufacturer?: string }[]
  initialFqbn: string
  initialPort: string
  onRefresh: () => void
  onClose: () => void
  onConfirm: (fqbn: string, port: string) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [fqbn, setFqbn] = useState(initialFqbn)
  const [port, setPort] = useState(initialPort)

  useEffect(() => {
    onRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return boards
    return boards.filter((b) => b.name.toLowerCase().includes(q) || b.fqbn.toLowerCase().includes(q))
  }, [query, boards])

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-[640px] max-w-[92vw] flex-col rounded-lg border border-ide-border bg-ide-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row items-center justify-between border-b border-ide-border px-4 py-3">
          <h2 className="text-[14px] font-semibold text-ide-text">Select Other Board and Port</h2>
          <button className="rounded p-1 text-ide-muted hover:bg-ide-hover hover:text-ide-text" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p className="px-4 pt-3 text-[12px] leading-relaxed text-ide-muted">
          Select both a Board and a Port to upload. Selecting only a Board lets you compile (Verify) but not upload.
        </p>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 p-4">
          <div className="flex min-h-0 flex-col">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ide-faint">Boards</div>
            <div className="mb-2 row gap-1.5 rounded border border-ide-border bg-ide-bg px-2">
              <Search size={13} className="shrink-0 text-ide-faint" />
              <input
                autoFocus
                className="h-7 w-full bg-transparent text-[12px] text-ide-text outline-none placeholder:text-ide-faint"
                placeholder="Search board"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded border border-ide-border">
              {filtered.length === 0 ? (
                <div className="p-3 text-[12px] text-ide-faint">No boards found for &quot;{query}&quot;</div>
              ) : (
                filtered.map((b) => (
                  <button
                    key={b.fqbn}
                    className={`row w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-ide-hover ${
                      fqbn === b.fqbn ? 'bg-ide-accent/15 text-ide-text' : 'text-ide-muted'
                    }`}
                    onClick={() => setFqbn(b.fqbn)}
                  >
                    <span className="truncate">{b.name}</span>
                    {fqbn === b.fqbn && <Check size={13} className="shrink-0 text-ide-accent" />}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ide-faint">Ports</div>
            <div className="min-h-0 flex-1 overflow-auto rounded border border-ide-border">
              {ports.length === 0 ? (
                <div className="p-3 text-[12px] text-ide-faint">No ports detected. Connect a board over USB.</div>
              ) : (
                ports.map((p) => (
                  <button
                    key={p.path}
                    className={`row w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-ide-hover ${
                      port === p.path ? 'bg-ide-accent/15 text-ide-text' : 'text-ide-muted'
                    }`}
                    onClick={() => setPort(p.path)}
                  >
                    <span className="row min-w-0 gap-1.5">
                      <span className="mono shrink-0 text-ide-text">{p.path}</span>
                      {p.manufacturer && <span className="truncate text-[10px] text-ide-faint">{p.manufacturer}</span>}
                    </span>
                    {port === p.path && <Check size={13} className="shrink-0 text-ide-accent" />}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
        <div className="row items-center justify-end gap-2 border-t border-ide-border px-4 py-3">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-accent disabled:opacity-40" disabled={!fqbn} onClick={() => onConfirm(fqbn, port)}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
