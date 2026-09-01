import { Sparkles, FileText, type LucideIcon } from 'lucide-react'
import { useStore } from '../store/useStore'

/**
 * The right-edge rail: the home of the assist and reference tools that dock on
 * the right, beside the editor. It mirrors the left ActivityBar but sits flush
 * to the window's right edge and toggles what the right dock shows (the Cortex
 * Agent or the Datasheets). Notifications will join here once there is a
 * notifications center (Phase 8); a dead bell now would be dishonest.
 */
export default function RightRail(): JSX.Element {
  const rightView = useStore((s) => s.rightView)
  const setRightView = useStore((s) => s.setRightView)

  const railButton = (active: boolean, label: string, Icon: LucideIcon, onClick: () => void): JSX.Element => (
    <button
      key={label}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`relative flex h-11 w-full items-center justify-center transition-colors ${
        active ? 'text-ide-text' : 'text-ide-faint hover:text-ide-text'
      }`}
    >
      {/* Accent bar on the outer (window) edge, mirroring the left rail's. */}
      {active && <span className="absolute right-0 top-2 bottom-2 w-0.5 rounded bg-cortex-gradient-v" />}
      <Icon size={22} strokeWidth={1.6} />
    </button>
  )

  return (
    <div className="flex w-12 shrink-0 flex-col items-center border-l border-ide-border bg-ide-bar py-2">
      {railButton(rightView === 'agent', 'Cortex Agent', Sparkles, () => setRightView('agent'))}
      {railButton(rightView === 'datasheets', 'Datasheets', FileText, () => setRightView('datasheets'))}
    </div>
  )
}
