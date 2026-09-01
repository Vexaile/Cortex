import { useEffect, useState } from 'react'
import { FileText, RefreshCw, FilePlus, Search, Cpu } from 'lucide-react'
import { useStore } from '../store/useStore'
import type { DocCitation } from '@shared/datasheet'
import PanelHeader from './PanelHeader'
import EmptyState from './EmptyState'

/**
 * The datasheet / document intelligence view: import engineering documents and
 * search them for cited passages. Retrieval, not chat - every result is a
 * verbatim excerpt with a citation back to the source doc/section/line, opened
 * in the editor on click. The BM25 scoring and citations come from the pure
 * @shared/datasheet engine; nothing here is summarized or invented.
 */

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }): JSX.Element | null {
  if (count === 0) return null
  return (
    <div className="pb-1">
      <div className="row gap-1.5 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-ide-muted">
        {title} <span className="text-ide-faint">· {count}</span>
      </div>
      {children}
    </div>
  )
}

/** A clickable citation that opens the stored document at its cited line. */
function CitationLink({ citation }: { citation: DocCitation }): JSX.Element {
  const workspaceRoot = useStore((s) => s.workspaceRoot)
  const revealLocation = useStore((s) => s.revealLocation)
  const open = (): void => {
    if (!workspaceRoot) return
    const sep = workspaceRoot.includes('\\') ? '\\' : '/'
    const root = workspaceRoot.replace(/[\\/]+$/, '')
    void revealLocation(`${root}${sep}${citation.path.replace(/\//g, sep)}`, citation.line, 1)
  }
  const loc = [citation.page != null ? `p.${citation.page}` : '', `L:${citation.line}`].filter(Boolean).join(' ')
  return (
    <button
      onClick={open}
      className="mono text-left text-[10px] text-ide-faint hover:text-ide-cyan"
      title={`Open ${citation.path} at line ${citation.line}`}
    >
      {citation.docName}
      {citation.title ? ` > ${citation.title}` : ''} [{loc}]
    </button>
  )
}

export default function DatasheetsPanel(): JSX.Element {
  const workspaceRoot = useStore((s) => s.workspaceRoot)
  const datasheets = useStore((s) => s.datasheets)
  const results = useStore((s) => s.datasheetResults)
  const busy = useStore((s) => s.datasheetBusy)
  const importDatasheet = useStore((s) => s.importDatasheet)
  const refreshDatasheets = useStore((s) => s.refreshDatasheets)
  const queryDatasheets = useStore((s) => s.queryDatasheets)
  const [q, setQ] = useState('')

  // Load the imported-document list on open and when the project changes.
  useEffect(() => {
    if (workspaceRoot) void refreshDatasheets()
  }, [workspaceRoot, refreshDatasheets])

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    void queryDatasheets(q)
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        icon={<FileText size={13} />}
        actions={
          <>
            <button
              title="Import a datasheet or document"
              onClick={() => void importDatasheet()}
              disabled={!workspaceRoot || busy}
              className="rounded p-1 hover:bg-ide-hover hover:text-ide-text disabled:opacity-40"
            >
              <FilePlus size={13} />
            </button>
            <button
              title="Reload imported documents"
              onClick={() => void refreshDatasheets()}
              disabled={!workspaceRoot}
              className="rounded p-1 hover:bg-ide-hover hover:text-ide-text disabled:opacity-40"
            >
              <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
            </button>
          </>
        }
      >
        Datasheets
      </PanelHeader>

      {!workspaceRoot ? (
        <EmptyState icon={<FileText size={22} />}>
          Open a folder, then import datasheets, reference manuals, or app notes to search them with citations.
        </EmptyState>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Query box */}
          <form onSubmit={submit} className="row gap-1.5 border-b border-ide-border/60 px-3 py-2">
            <Search size={13} className="shrink-0 text-ide-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the documents (e.g. PWR_MGMT_1, I2C address, wake from sleep)"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ide-text placeholder:text-ide-faint focus:outline-none"
            />
          </form>

          <div className="flex-1 overflow-auto py-1 text-[12.5px]">
            {/* Retrieved passages with citations */}
            <Section title="Results" count={results.length}>
              {results.map((h, i) => (
                <div key={`${h.citation.docId}-${h.citation.line}-${i}`} className="px-3 py-1.5 pl-4">
                  <CitationLink citation={h.citation} />
                  <div className="mt-0.5 whitespace-pre-wrap text-[11px] leading-snug text-ide-muted">
                    {h.text.length > 320 ? h.text.slice(0, 320) + ' ...' : h.text}
                  </div>
                </div>
              ))}
            </Section>

            {q.trim() && results.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-ide-faint">
                No passage in the imported documents matches that query.
              </div>
            )}

            {/* The imported corpus */}
            <Section title="Documents" count={datasheets.length}>
              {datasheets.map((d) => (
                <div key={d.id} className="row items-center gap-2 px-3 py-1 pl-4">
                  <FileText size={12} className="shrink-0 text-ide-muted" />
                  <span className="min-w-0 flex-1 truncate text-ide-text" title={d.name}>
                    {d.name}
                  </span>
                  {d.deviceKey && (
                    <span
                      className="row shrink-0 items-center gap-1 rounded bg-ide-bar px-1.5 py-0.5 text-[10px] text-ide-faint"
                      title={`Linked to the ${d.deviceKey} device used in this project`}
                    >
                      <Cpu size={10} /> {d.deviceKey}
                    </span>
                  )}
                </div>
              ))}
            </Section>

            {datasheets.length === 0 && (
              <EmptyState icon={<FilePlus size={22} />}>
                No documents imported yet. Use the Import button above to add a PDF, markdown, or text datasheet.
              </EmptyState>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
