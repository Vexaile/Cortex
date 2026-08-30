import type { ReactNode } from 'react'

/**
 * The single empty state. There were five patterns across six surfaces (three
 * alignments, two fonts, none with an icon), which is exactly the drift that
 * reads as unfinished. Centered, icon above, one line of guidance, optional action.
 */
export default function EmptyState({
  icon,
  children,
  action,
  mono
}: {
  icon?: ReactNode
  children: ReactNode
  action?: ReactNode
  mono?: boolean
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      {icon && <div className="text-ide-faint opacity-70">{icon}</div>}
      <p className={`max-w-[46ch] text-[12px] leading-relaxed text-ide-faint ${mono ? 'mono' : ''}`}>{children}</p>
      {action}
    </div>
  )
}
