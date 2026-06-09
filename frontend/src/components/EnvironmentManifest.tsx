import { useEnvironments, useRemoveEnvironment, useStopEnvironment } from '@/hooks/api'
import { EmptyState } from '@/components/EmptyState'
import { ManifestRow } from '@/components/ManifestRow'
import { cn } from '@/lib/utils'
import type { EnvironmentSummary } from '@/lib/types'

interface EnvironmentManifestProps {
  onCreate: () => void
  onOpenDetails: (id: string) => void
  onConfirmStop: (env: EnvironmentSummary) => void
  onConfirmRemove: (env: EnvironmentSummary) => void
  onConfirmStart: (env: EnvironmentSummary) => void
  startingMountFolder?: string | null
}

export function EnvironmentManifest({
  onCreate,
  onOpenDetails,
  onConfirmStop,
  onConfirmRemove,
  onConfirmStart,
  startingMountFolder,
}: EnvironmentManifestProps) {
  const { data, isLoading, isError, error, isFetching } = useEnvironments()
  const stopMut = useStopEnvironment()
  const removeMut = useRemoveEnvironment()

  return (
    <section className="border-t border-ink-line">
      <div className="mx-auto max-w-[1200px]">
        <ManifestHeader count={data?.length ?? 0} fetching={isFetching} />

        {isError && (
          <div className="mx-6 sm:mx-10 my-6 border border-fault/30 bg-fault/5 px-4 py-3">
            <div className="label-eyebrow text-fault mb-1">Fetch failed</div>
            <p className="text-[13px] text-bone-dim font-mono">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        )}

        {isLoading && <ManifestSkeleton />}

        {!isLoading && data && data.length === 0 && <EmptyState onCreate={onCreate} />}

        {!isLoading && data && data.length > 0 && (
          <div role="list" aria-label="Environments">
            {data.map((env) => (
              <ManifestRow
                key={env.id}
                env={env}
                onOpenDetails={onOpenDetails}
                onStop={onConfirmStop}
                onRemove={onConfirmRemove}
                onConfirmStart={onConfirmStart}
                isStopping={stopMut.isPending && stopMut.variables === env.id}
                isRemoving={removeMut.isPending && removeMut.variables === env.id}
                isStarting={startingMountFolder === env.mount_folder}
              />
            ))}
            <div className="border-t border-ink-line" aria-hidden />
          </div>
        )}
      </div>
    </section>
  )
}

function ManifestHeader({ count, fetching }: { count: number; fetching: boolean }) {
  return (
    <div className="px-6 sm:px-10 pt-8 pb-3 flex items-center justify-between">
      <div className="flex items-baseline gap-3">
        <h2 className="label-eyebrow text-bone">Manifest</h2>
        <span className="font-mono text-[11px] text-bone-mute tabular-nums">
          [{String(count).padStart(2, '0')}]
        </span>
      </div>
      <div
        className={cn(
          'flex items-center gap-1.5 font-mono text-[10.5px] text-bone-mute uppercase tracking-[0.14em] transition-opacity',
          fetching ? 'opacity-100' : 'opacity-0',
        )}
        aria-live="polite"
      >
        <span className="h-1 w-1 bg-volt animate-pulse" />
        sync
      </div>
    </div>
  )
}

function ManifestSkeleton() {
  return (
    <div className="px-6 sm:px-10 py-8 space-y-3" aria-busy>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-2 w-2 rounded-full bg-ink-line" />
          <div className="h-3 w-40 bg-ink-line" />
          <div className="h-3 w-24 bg-ink-line opacity-50" />
          <div className="h-3 w-60 bg-ink-line opacity-30 hidden sm:block" />
        </div>
      ))}
    </div>
  )
}
