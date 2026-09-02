import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useStore } from '../store/useStore'

/**
 * The one themed confirmation dialog, driven by the store's confirm()/answerConfirm().
 * It replaces native window.confirm - an unthemed OS modal that broke the Cortex
 * identity - so every destructive/blocking prompt matches the app. Mounted once
 * in App. Esc / backdrop cancels; Enter confirms; the confirm button is focused
 * on open so keyboard users can act immediately.
 */
export default function ConfirmDialog(): JSX.Element | null {
  const req = useStore((s) => s.confirmDialog)
  const answer = useStore((s) => s.answerConfirm)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!req) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      // Ignore OS auto-repeat: the same held (or rapidly repeated) Enter that
      // activated the trigger must not also confirm the dialog it just opened -
      // that would defeat the confirmation for an outward-facing or destructive
      // action. A fresh, deliberate keypress still works.
      if (e.repeat) return
      if (e.key === 'Escape') {
        e.preventDefault()
        answer(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        answer(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [req, answer])

  if (!req) return null
  const danger = !!req.danger

  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center bg-black/50"
      onClick={() => answer(false)}
      role="presentation"
    >
      <div
        className="w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl border border-ide-border bg-ide-panel p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={req.title}
      >
        <div className="row items-start gap-3">
          {danger && (
            <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ide-red/15 text-ide-red">
              <AlertTriangle size={17} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-ide-text">{req.title}</div>
            <div className="mt-1 text-[12px] leading-relaxed text-ide-muted">{req.message}</div>
          </div>
        </div>
        <div className="row mt-5 justify-end gap-2">
          <button
            className="btn border border-ide-border text-ide-text hover:bg-ide-hover"
            onClick={() => answer(false)}
          >
            {req.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            className={`btn justify-center text-white ${danger ? 'bg-ide-danger hover:brightness-110' : 'btn-accent'}`}
            onClick={() => answer(true)}
          >
            {req.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
