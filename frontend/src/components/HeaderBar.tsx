import { Plus, PowerOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { HealthPill } from '@/components/HealthPill'

interface HeaderBarProps {
  onCreate: () => void
  onStopAll: () => void
  stopAllDisabled?: boolean
}

export function HeaderBar({ onCreate, onStopAll, stopAllDisabled }: HeaderBarProps) {
  return (
    <header className="sticky top-0 z-30 bg-ink/85 backdrop-blur-md border-b border-ink-line">
      <div className="mx-auto max-w-[1200px] px-6 sm:px-10 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <a
            href="/"
            className="inline-flex items-center gap-2.5 group"
            aria-label="VS Code Environment Manager"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center border border-volt">
              <span className="h-2 w-2 bg-volt" />
            </span>
            <span className="font-display text-[13px] font-medium tracking-[-0.01em] text-bone">
              vsenv<span className="text-bone-mute">/manager</span>
            </span>
          </a>
          <span className="hidden sm:inline-block h-3 w-px bg-ink-line" />
          <div className="hidden sm:block">
            <HealthPill />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onStopAll}
            disabled={stopAllDisabled}
            iconLeft={<PowerOff />}
            className="hidden sm:inline-flex"
          >
            Stop all
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onCreate}
            iconLeft={<Plus />}
          >
            New environment
            <kbd className="hidden md:inline-flex ml-2 px-1.5 h-4 items-center font-mono text-[10px] text-ink/70 bg-ink/15 rounded-[2px]">
              N
            </kbd>
          </Button>
        </div>
      </div>
    </header>
  )
}
