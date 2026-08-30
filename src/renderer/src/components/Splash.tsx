import { Cpu } from 'lucide-react'

/**
 * The loading screen. Renders on top of the (already laid-out) app and fades
 * away once boot finishes, so there is never a flash of unstyled or half-built
 * UI underneath. The logo breathes while the app initializes.
 *
 * `leaving` starts the fade; `onExited` fires when it completes so the parent
 * can unmount this entirely (an invisible full-screen overlay would still eat
 * clicks).
 */
export default function Splash({ leaving, onExited }: { leaving: boolean; onExited: () => void }): JSX.Element {
  return (
    <div
      className={`fixed inset-0 z-[100] grid place-items-center bg-ide-bg transition-opacity duration-500 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
      aria-hidden={leaving}
      onTransitionEnd={(e) => {
        // Only the opacity transition on THIS element ends the splash; a child's
        // transition bubbling up must not tear it down early.
        if (leaving && e.target === e.currentTarget && e.propertyName === 'opacity') onExited()
      }}
    >
      <div className="relative flex flex-col items-center">
        {/* Soft radial glow, pulsing wider than the logo. */}
        <div className="cortex-glow pointer-events-none absolute top-2 h-40 w-40 rounded-full bg-cortex-gradient blur-3xl" />

        <div className="cortex-breathe relative flex flex-col items-center gap-6">
          <div className="grid h-24 w-24 place-items-center rounded-[1.6rem] bg-cortex-gradient shadow-2xl shadow-ide-navy/40">
            <Cpu size={54} strokeWidth={1.5} className="text-white" />
          </div>
          <div className="text-center">
            <div className="text-[26px] font-semibold leading-none tracking-tight text-ide-text">Cortex</div>
            <div className="mt-2 text-[10px] font-medium uppercase tracking-[0.32em] text-ide-faint">
              Embedded IDE
            </div>
          </div>
        </div>

        {/* Indeterminate loader: says "working" without faking a percentage. */}
        <div className="absolute -bottom-16 h-0.5 w-40 overflow-hidden rounded-full bg-ide-border">
          <div className="cortex-sweep h-full w-1/3 rounded-full bg-cortex-gradient" />
        </div>
      </div>
    </div>
  )
}
