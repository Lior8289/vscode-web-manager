import { useEnvironments } from '@/hooks/api'

export function TitleBlock() {
  const { data } = useEnvironments()
  const total = data?.length ?? 0
  const running = data?.filter((e) => e.status.toLowerCase().includes('running')).length ?? 0

  return (
    <section className="relative">
      <div className="absolute inset-x-0 top-0 h-48 grid-bg opacity-40 pointer-events-none" aria-hidden />
      <div className="relative mx-auto max-w-[1200px] px-6 sm:px-10 pt-16 pb-12 sm:pt-24 sm:pb-16">
        <div className="grid grid-cols-12 gap-8 items-end">
          <div className="col-span-12 lg:col-span-8">
            <div className="label-eyebrow mb-5">Control plane · v1</div>
            <h1 className="font-display text-bone text-[44px] sm:text-[60px] leading-[1.02] tracking-[-0.03em] font-light">
              On-demand <span className="text-volt">VS Code</span> environments,
              <br />
              <span className="text-bone-dim font-extralight">routed through nginx.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[14px] leading-relaxed text-bone-dim font-light">
              Spin up isolated browser-based editors that mount a host directory,
              live on their own subdomain, and shut down on command. Built on Docker,
              FastAPI, and openvscode-server.
            </p>
          </div>

          <aside className="col-span-12 lg:col-span-4 lg:justify-self-end">
            <dl className="grid grid-cols-2 gap-x-10 gap-y-1 lg:text-right">
              <dt className="label-eyebrow col-span-2 mb-2 lg:text-right">Roster</dt>
              <div className="lg:order-1">
                <dd className="font-mono text-bone text-[28px] font-light tabular-nums leading-none">
                  {String(total).padStart(2, '0')}
                </dd>
                <dt className="mt-1.5 text-[11px] text-bone-mute uppercase tracking-[0.16em]">
                  Total
                </dt>
              </div>
              <div className="lg:order-2">
                <dd className="font-mono text-volt text-[28px] font-light tabular-nums leading-none">
                  {String(running).padStart(2, '0')}
                </dd>
                <dt className="mt-1.5 text-[11px] text-bone-mute uppercase tracking-[0.16em]">
                  Running
                </dt>
              </div>
            </dl>
          </aside>
        </div>
      </div>
    </section>
  )
}
