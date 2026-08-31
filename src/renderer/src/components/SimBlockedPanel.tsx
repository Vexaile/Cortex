import { useState } from 'react'
import { AlertTriangle, RefreshCw, Copy, Check, ExternalLink, FileWarning } from 'lucide-react'
import { useStore } from '../store/useStore'
import { detectOS, compilerInstallHelp } from '@shared/compilerHelp'

const OS_LABEL: Record<ReturnType<typeof detectOS>, string> = {
  windows: 'Windows',
  mac: 'macOS',
  linux: 'Linux'
}

/**
 * The friendly, actionable state shown on the simulator stage when the sim
 * cannot run: a missing host C++ compiler (with a per-OS install command and a
 * Recheck button) or a file that is not an Arduino sketch. Replaces the old
 * five-cryptic-lines-in-the-serial-pane behavior. Returns null when unblocked.
 */
export default function SimBlockedPanel(): JSX.Element | null {
  const simBlock = useStore((s) => s.simBlock)
  const simRechecking = useStore((s) => s.simRechecking)
  const recheckCompiler = useStore((s) => s.recheckCompiler)
  const [copied, setCopied] = useState(false)

  if (!simBlock) return null

  if (simBlock.reason === 'not-sketch') {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md space-y-2 text-center">
          <FileWarning size={28} className="mx-auto text-ide-amber" />
          <div className="text-[14px] font-semibold text-ide-text">{simBlock.lines[0]}</div>
          {simBlock.lines.slice(1).map((l, i) => (
            <p key={i} className="text-[12.5px] leading-relaxed text-ide-muted">
              {l}
            </p>
          ))}
        </div>
      </div>
    )
  }

  const os = detectOS(navigator.userAgent)
  const help = compilerInstallHelp(os)
  const copy = (): void => {
    void navigator.clipboard
      .writeText(help.command)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  return (
    <div className="grid h-full place-items-center overflow-auto p-6">
      <div className="w-full max-w-lg space-y-4">
        <div className="row gap-2.5">
          <AlertTriangle size={22} className="shrink-0 text-ide-amber" />
          <div>
            <div className="text-[15px] font-semibold text-ide-text">No C++ compiler found</div>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ide-muted">
              The simulator builds your sketch on this machine with g++ or clang++. Install one to run simulations. Your
              sketch is saved and waiting.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ide-faint">Install on {OS_LABEL[os]}</div>
          <div className="row items-stretch gap-1.5">
            <code className="mono min-w-0 flex-1 truncate rounded border border-ide-border bg-ide-bar px-2.5 py-2 text-[12px] text-ide-text" title={help.command}>
              {help.command}
            </code>
            <button
              className="btn shrink-0 whitespace-nowrap border border-ide-border text-[11px]"
              onClick={copy}
              title="Copy command"
            >
              {copied ? <Check size={13} className="text-ide-moss" /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-ide-faint">{help.note}</p>
        </div>

        <div className="row gap-2 pt-1">
          <button className="btn btn-accent whitespace-nowrap disabled:opacity-40" onClick={() => void recheckCompiler()} disabled={simRechecking}>
            <RefreshCw size={14} className={simRechecking ? 'animate-spin' : ''} />
            {simRechecking ? 'Checking...' : 'Recheck'}
          </button>
          <a
            className="row gap-1 text-[12px] text-ide-accent hover:underline"
            href={help.docUrl}
            target="_blank"
            rel="noreferrer"
          >
            {help.docLabel} <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  )
}
