import { ExternalLink, Loader2 } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { StatusDot } from '@/components/ui/StatusDot'
import { useEnvironmentDetail } from '@/hooks/api'
import { cn, shortId, statusLabel } from '@/lib/utils'
import type { EnvironmentMount, EnvironmentNetwork } from '@/lib/types'

interface EnvironmentDetailSheetProps {
  id: string | null
  onClose: () => void
}

export function EnvironmentDetailSheet({ id, onClose }: EnvironmentDetailSheetProps) {
  const { data, isLoading, isError, error } = useEnvironmentDetail(id)

  return (
    <Sheet
      open={Boolean(id)}
      onOpenChange={(o) => !o && onClose()}
      eyebrow="Environment"
      title={data?.container_name ?? (id ? shortId(id) : '')}
    >
      {isLoading && (
        <div className="flex items-center gap-2 text-bone-dim text-[12px] font-mono">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          loading manifest…
        </div>
      )}

      {isError && (
        <div className="border border-fault/30 bg-fault/5 px-4 py-3">
          <div className="label-eyebrow text-fault mb-1">Fetch failed</div>
          <p className="text-[12px] text-bone-dim font-mono">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      )}

      {data && (
        <div className="space-y-8 text-[12px]">
          <Section title="Identity">
            <KV label="id" value={<span className="font-mono">{data.id}</span>} />
            <KV
              label="status"
              value={
                <span className="inline-flex items-center gap-2">
                  <StatusDot status={data.status} />
                  <span className="font-mono">{statusLabel(data.status)}</span>
                </span>
              }
            />
            <KV label="image" value={<span className="font-mono">{data.image}</span>} />
          </Section>

          <Section title="Labels">
            {Object.keys(data.labels).length === 0 ? (
              <p className="font-mono text-bone-mute">none</p>
            ) : (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-5 gap-y-1.5">
                {Object.entries(data.labels).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-mono text-bone-mute truncate">{k}</dt>
                    <dd className="font-mono text-bone break-all">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>

          <Section title="Mounts">
            {data.mounts.length === 0 ? (
              <p className="font-mono text-bone-mute">none</p>
            ) : (
              <ul className="space-y-3">
                {data.mounts.map((m, i) => (
                  <li key={i} className="border border-ink-line px-3 py-2.5">
                    <MountRow mount={m} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Networks">
            {Object.keys(data.networks).length === 0 ? (
              <p className="font-mono text-bone-mute">none</p>
            ) : (
              <ul className="space-y-3">
                {Object.entries(data.networks).map(([name, net]) => (
                  <li key={name} className="border border-ink-line px-3 py-2.5">
                    <NetworkRow name={name} net={net} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {data.status.toLowerCase().includes('running') && (
            <div className="border-t border-ink-line pt-5">
              <a
                href={`http://${data.container_name}.localhost:8080/?folder=/home/workspace`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'inline-flex items-center gap-2 px-3 h-9',
                  'border border-volt/40 text-volt hover:bg-volt/5',
                  'font-mono text-[12px] tracking-[0.04em] uppercase',
                  'transition-colors',
                )}
              >
                Open editor
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label-eyebrow mb-3">{title}</div>
      {children}
    </div>
  )
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-1.5 border-b border-ink-line/60 last:border-0">
      <span className="w-24 shrink-0 font-mono text-[11px] text-bone-mute uppercase tracking-[0.12em]">
        {label}
      </span>
      <span className="text-bone min-w-0 break-all">{value}</span>
    </div>
  )
}

function MountRow({ mount }: { mount: EnvironmentMount }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono">
      {mount.Type && (
        <>
          <dt className="text-bone-mute">type</dt>
          <dd className="text-bone-dim">{mount.Type}</dd>
        </>
      )}
      <dt className="text-bone-mute">src</dt>
      <dd className="text-bone break-all">{mount.Source}</dd>
      <dt className="text-bone-mute">dst</dt>
      <dd className="text-bone break-all">{mount.Destination}</dd>
      {mount.Mode && (
        <>
          <dt className="text-bone-mute">mode</dt>
          <dd className="text-bone-dim">{mount.Mode}</dd>
        </>
      )}
      {typeof mount.RW === 'boolean' && (
        <>
          <dt className="text-bone-mute">rw</dt>
          <dd className="text-bone-dim">{String(mount.RW)}</dd>
        </>
      )}
    </dl>
  )
}

function NetworkRow({ name, net }: { name: string; net: EnvironmentNetwork }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono">
      <dt className="text-bone-mute">name</dt>
      <dd className="text-bone break-all">{name}</dd>
      {net.IPAddress && (
        <>
          <dt className="text-bone-mute">ip</dt>
          <dd className="text-bone-dim">{net.IPAddress}</dd>
        </>
      )}
      {net.Gateway && (
        <>
          <dt className="text-bone-mute">gw</dt>
          <dd className="text-bone-dim">{net.Gateway}</dd>
        </>
      )}
      {net.MacAddress && (
        <>
          <dt className="text-bone-mute">mac</dt>
          <dd className="text-bone-dim">{net.MacAddress}</dd>
        </>
      )}
    </dl>
  )
}
