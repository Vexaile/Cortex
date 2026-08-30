import type { ReactNode } from 'react'

/**
 * The single panel header. There were four implementations of this one role at
 * four heights (29/32/36px) with three different border colors, which is the
 * kind of drift that reads as "unfinished" even when nothing is broken.
 * Every docked panel uses this.
 */
export default function PanelHeader({
  children,
  actions,
  icon
}: {
  children: ReactNode
  actions?: ReactNode
  icon?: ReactNode
}): JSX.Element {
  return (
    <div className="row h-9 shrink-0 items-center justify-between gap-2 border-b border-ide-border px-3">
      <span className="row min-w-0 gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ide-muted">
        {icon}
        <span className="truncate">{children}</span>
      </span>
      {actions && <div className="row shrink-0 gap-0.5 text-ide-muted">{actions}</div>}
    </div>
  )
}
