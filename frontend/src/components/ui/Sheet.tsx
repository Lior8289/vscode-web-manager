import * as RDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  eyebrow?: ReactNode
  children: ReactNode
}

export function Sheet({ open, onOpenChange, title, eyebrow, children }: SheetProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-ink/60 backdrop-blur-[1px]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        />
        <RDialog.Content
          className={cn(
            'fixed right-0 top-0 z-50 h-full',
            'w-full sm:w-[440px]',
            'bg-ink-raised border-l border-ink-line',
            'flex flex-col',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right',
            'duration-200',
            'focus:outline-none',
          )}
        >
          <div className="flex items-start justify-between border-b border-ink-line px-6 pt-5 pb-4">
            <div className="space-y-1 min-w-0">
              {eyebrow && (
                <div className="label-eyebrow">{eyebrow}</div>
              )}
              <RDialog.Title className="text-bone text-[16px] font-medium tracking-[-0.01em] truncate">
                {title}
              </RDialog.Title>
            </div>
            <RDialog.Close
              aria-label="Close"
              className="inline-flex h-7 w-7 items-center justify-center text-bone-mute hover:text-bone transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </RDialog.Close>
          </div>
          <RDialog.Description className="sr-only">Details panel</RDialog.Description>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}
