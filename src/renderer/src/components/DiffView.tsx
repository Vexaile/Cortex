import { useMemo } from 'react'
import { diffLines, hunksFromLines, isDiffTooLarge } from '@shared/diff'

/**
 * A compact unified diff for reviewing a staged whole-file edit. Renders only
 * the changed regions (plus a little context) so a big file with a small change
 * reads as a focused diff, and degrades to a summary when a file is too large to
 * diff line by line. The (O(n*m)) line diff is memoized on the content and run
 * once, since the panel re-renders on every streamed agent event.
 */
export default function DiffView({ oldContent, newContent }: { oldContent: string; newContent: string }): JSX.Element {
  const model = useMemo(() => {
    if (isDiffTooLarge(oldContent, newContent)) {
      const oldN = oldContent ? oldContent.split('\n').length : 0
      const newN = newContent ? newContent.split('\n').length : 0
      return { tooLarge: true as const, added: Math.max(0, newN), removed: Math.max(0, oldN) }
    }
    const lines = diffLines(oldContent, newContent)
    return {
      tooLarge: false as const,
      hunks: hunksFromLines(lines),
      added: lines.filter((l) => l.type === 'add').length,
      removed: lines.filter((l) => l.type === 'del').length
    }
  }, [oldContent, newContent])

  if (model.tooLarge) {
    return (
      <div className="mono px-3 py-2 text-[11px] text-ide-amber">
        Too large to diff inline (<span className="text-ide-moss">+{model.added}</span>{' '}
        <span className="text-ide-red">-{model.removed}</span> lines). Review carefully: a large deletion here may mean
        the model dropped part of the file.
      </div>
    )
  }

  if (model.hunks.length === 0) {
    // Line contents match; if the raw bytes still differ it is only the final
    // newline (splitLines is EOL and trailing-newline tolerant).
    const note = oldContent !== newContent ? 'Only the final newline differs.' : 'No textual change.'
    return <div className="mono px-3 py-2 text-[11px] text-ide-faint">{note}</div>
  }

  return (
    <div className="mono max-h-72 overflow-auto text-[11px] leading-[1.45]">
      {model.hunks.map((h, hi) => (
        <div key={hi}>
          {hi > 0 && <div className="select-none bg-ide-bar/60 px-2 py-0.5 text-[10px] text-ide-faint">...</div>}
          {h.lines.map((l, li) => (
            <div
              key={li}
              className={`flex whitespace-pre ${
                l.type === 'add'
                  ? 'bg-ide-moss/15 text-ide-text'
                  : l.type === 'del'
                    ? 'bg-ide-red/15 text-ide-text'
                    : 'text-ide-muted'
              }`}
            >
              <span
                className={`w-10 shrink-0 select-none px-1 text-right ${
                  l.type === 'add' ? 'text-ide-moss/70' : l.type === 'del' ? 'text-ide-red/70' : 'text-ide-faint/60'
                }`}
              >
                {l.type === 'add' ? l.newLine : l.oldLine}
              </span>
              <span
                className={`w-4 shrink-0 select-none text-center ${
                  l.type === 'add' ? 'text-ide-moss' : l.type === 'del' ? 'text-ide-red' : 'text-ide-faint/50'
                }`}
              >
                {l.type === 'add' ? '+' : l.type === 'del' ? '-' : ''}
              </span>
              <span className="min-w-0 flex-1 pr-2">{l.text || ' '}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
