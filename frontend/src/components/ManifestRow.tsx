import { ExternalLink, Info, Play, PowerOff, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { StatusDot } from '@/components/ui/StatusDot'
import { cn, shortId, statusLabel } from '@/lib/utils'
import type { EnvironmentSummary } from '@/lib/types'

interface ManifestRowProps {
  env: EnvironmentSummary
  onOpenDetails: (id: string) => void
  onStop: (env: EnvironmentSummary) => void
  onRemove: (env: EnvironmentSummary) => void
  onConfirmStart: (env: EnvironmentSummary) => void
  isStopping?: boolean
  isRemoving?: boolean
  isStarting?: boolean
}

export function ManifestRow({
  env,
  onOpenDetails,
  onStop,
  onRemove,
  onConfirmStart,
  isStopping,
  isRemoving,
  isStarting,
}: ManifestRowProps) {
  const isRunning = env.status.toLowerCase().includes('running')

  return (
    <div
      className={cn(
        'group relative grid items-center',
        'grid-cols-[auto_1fr_auto] sm:grid-cols-[24px_minmax(0,1fr)_minmax(0,1.1fr)_auto]',
        'gap-x-4 sm:gap-x-6',
        'px-6 sm:px-10 py-4 sm:py-5',
        'border-t border-ink-line',
        'transition-colors duration-150',
        'hover:bg-ink-raised/40',
      )}
    >
      {/* Status dot */}
      <div className="flex items-center justify-center">
        <StatusDot status={env.status} />
      </div>

      {/* Name + ID block */}
      <div className="min-w-0">
        <div className="flex items-baseline gap-3 min-w-0">
          <button
            type="button"
            onClick={() => onOpenDetails(env.id)}
            className={cn(
              'truncate text-left text-bone font-medium text-[15px] tracking-[-0.005em]',
              'hover:text-volt transition-colors',
              'focus-visible:text-volt',
            )}
          >
            {env.mount_folder}
          </button>
          <span className="hidden sm:inline-flex font-mono text-[10.5px] text-bone-mute uppercase tracking-[0.14em]">
            {statusLabel(env.status)}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 font-mono text-[11.5px] text-bone-dim">
          <span className="truncate">{env.container_name}</span>
          <span className="text-ink-line-hot">·</span>
          <span className="text-bone-mute">id {shortId(env.id)}</span>
        </div>
      </div>

      {/* URL row — desktop only */}
      <div className="hidden sm:flex items-center min-w-0">
        {isRunning ? (
          <a
            href={env.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center gap-2 max-w-full',
              'font-mono text-[11.5px] text-bone-dim hover:text-bone',
              'transition-colors group/url',
            )}
          >
            <span className="truncate">{prettyUrl(env.url)}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-50 group-hover/url:opacity-100" />
          </a>
        ) : (
          <button
            type="button"
            onClick={() => onConfirmStart(env)}
            disabled={isStarting}
            title="Start environment and open editor"
            className={cn(
              'inline-flex items-center gap-2 max-w-full text-left',
              'font-mono text-[11.5px] text-bone-mute hover:text-volt',
              'transition-colors group/url',
              'disabled:opacity-60 disabled:cursor-progress',
            )}
          >
            <span className="truncate line-through decoration-ink-line-hot/60">
              {prettyUrl(env.url)}
            </span>
            <Play
              className={cn(
                'h-3 w-3 shrink-0 opacity-60 group-hover/url:opacity-100',
                isStarting && 'animate-pulse',
              )}
            />
          </button>
        )}
      </div>

      {/* Action cluster */}
      <div
        className={cn(
          'flex items-center gap-1',
          'opacity-100 sm:opacity-60 sm:group-hover:opacity-100',
          'transition-opacity duration-150',
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onOpenDetails(env.id)}
          aria-label="Details"
          title="Details"
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
        {isRunning && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onStop(env)}
            aria-label="Stop"
            title="Stop"
            loading={isStopping}
          >
            {!isStopping && <PowerOff className="h-3.5 w-3.5" />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onRemove(env)}
          aria-label="Remove"
          title="Remove"
          loading={isRemoving}
          className="hover:text-fault"
        >
          {!isRemoving && <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  )
}

function prettyUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}${u.search}`
  } catch {
    return url
  }
}
