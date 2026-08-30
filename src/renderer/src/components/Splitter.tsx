import { useRef } from 'react'

/**
 * A thin drag handle between panels. Reports incremental pointer deltas so the
 * caller can clamp; uses pointer capture so the drag survives the cursor
 * leaving the 4px strip.
 *
 * dir 'x' = vertical rule, drag horizontally (resizes a width).
 * dir 'y' = horizontal rule, drag vertically (resizes a height).
 */
export default function Splitter({
  dir,
  onDelta,
  title
}: {
  dir: 'x' | 'y'
  onDelta: (delta: number) => void
  title?: string
}): JSX.Element {
  const last = useRef<number | null>(null)

  const onPointerDown = (e: React.PointerEvent): void => {
    last.current = dir === 'x' ? e.clientX : e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (last.current === null) return
    const cur = dir === 'x' ? e.clientX : e.clientY
    const d = cur - last.current
    if (d !== 0) {
      onDelta(d)
      last.current = cur
    }
  }
  const end = (e: React.PointerEvent): void => {
    last.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  return (
    <div
      role="separator"
      aria-orientation={dir === 'x' ? 'vertical' : 'horizontal'}
      title={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      className={
        // A 1px rule, the same weight as every other border in the app. A 4px
        // filled bar reads as a third panel, not a divider.
        dir === 'x'
          ? 'group relative z-10 w-px shrink-0 cursor-col-resize bg-ide-border transition-colors hover:bg-ide-accent'
          : 'group relative z-10 h-px shrink-0 cursor-row-resize bg-ide-border transition-colors hover:bg-ide-accent'
      }
    >
      {/* The hit area is wider than the rule so it stays easy to grab. */}
      <span
        className={
          dir === 'x'
            ? 'absolute inset-y-0 -left-1 -right-1 block'
            : 'absolute inset-x-0 -top-1 -bottom-1 block'
        }
      />
    </div>
  )
}
