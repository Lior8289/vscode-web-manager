import { Activity, AlertTriangle, Loader2 } from 'lucide-react'
import { useDockerInfo } from '@/hooks/api'
import { cn } from '@/lib/utils'

export function HealthPill() {
  const { data, isLoading, isError } = useDockerInfo()

  const state: 'loading' | 'ok' | 'err' = isLoading ? 'loading' : isError ? 'err' : 'ok'

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 px-2.5 h-7',
        'border border-ink-line rounded-xs',
        'font-mono text-[11px] tracking-[0.04em]',
        state === 'err' && 'border-fault/40',
      )}
      title={
        data
          ? `Docker ${data.server_version} · ${data.containers} containers · ${data.images} images`
          : 'Docker daemon'
      }
    >
      {state === 'loading' && (
        <>
          <Loader2 className="h-3 w-3 animate-spin text-bone-mute" />
          <span className="text-bone-mute uppercase">checking</span>
        </>
      )}
      {state === 'ok' && (
        <>
          <span className="relative inline-flex">
            <span className="absolute h-2 w-2 rounded-full bg-live opacity-60 pulse-live" />
            <span className="relative h-2 w-2 rounded-full bg-live" />
          </span>
          <span className="text-bone uppercase">daemon</span>
          <span className="text-bone-mute">·</span>
          <span className="text-bone-dim">{data?.server_version}</span>
        </>
      )}
      {state === 'err' && (
        <>
          <AlertTriangle className="h-3 w-3 text-fault" />
          <span className="text-fault uppercase">unreachable</span>
        </>
      )}
      <Activity className="h-3 w-3 text-bone-mute ml-0.5" aria-hidden />
    </div>
  )
}
