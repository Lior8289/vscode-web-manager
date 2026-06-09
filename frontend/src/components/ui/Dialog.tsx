import * as RDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md'
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
}: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-ink/80 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        />
        <RDialog.Content
          className={cn(
            'fixed left-1/2 top-[18%] z-50 -translate-x-1/2',
            'w-[92vw]',
            size === 'sm' ? 'max-w-[380px]' : 'max-w-[460px]',
            'bg-ink-raised border border-ink-line',
            'rounded-xs',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2',
            'focus:outline-none',
          )}
        >
          <div className="flex items-start justify-between border-b border-ink-line px-5 pt-4 pb-3">
            <div className="space-y-1">
              <RDialog.Title className="text-bone text-[15px] font-medium tracking-[-0.01em]">
                {title}
              </RDialog.Title>
              {description && (
                <RDialog.Description className="text-bone-dim text-[12px] leading-relaxed">
                  {description}
                </RDialog.Description>
              )}
            </div>
            <RDialog.Close
              aria-label="Close"
              className="inline-flex h-7 w-7 items-center justify-center text-bone-mute hover:text-bone transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </RDialog.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-ink-line px-5 py-3">
              {footer}
            </div>
          )}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}
