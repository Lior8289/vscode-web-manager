import { Terminal } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface EmptyStateProps {
  onCreate: () => void
}

export function EmptyState({ onCreate }: EmptyStateProps) {
  return (
    <div className="px-6 sm:px-10 py-24 sm:py-32">
      <div className="mx-auto max-w-md text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center border border-ink-line text-bone-dim mb-6">
          <Terminal className="h-5 w-5" />
        </div>
        <h2 className="font-display text-[20px] tracking-[-0.01em] text-bone font-medium">
          No environments yet
        </h2>
        <p className="mt-2 text-[13px] text-bone-dim leading-relaxed">
          Provision your first openvscode-server container. It will mount a host
          folder under <span className="font-mono text-bone">workspaces/</span> and
          come online at its own subdomain.
        </p>
        <div className="mt-7 flex items-center justify-center gap-2">
          <Button variant="primary" size="md" onClick={onCreate}>
            Provision environment
          </Button>
          <kbd className="px-2 h-7 inline-flex items-center font-mono text-[11px] text-bone-mute border border-ink-line rounded-xs">
            press N
          </kbd>
        </div>
      </div>
    </div>
  )
}
