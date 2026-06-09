import { cn } from '@/lib/utils'
import { statusFamily } from '@/lib/utils'

interface StatusDotProps {
  status: string
  size?: 'sm' | 'md'
  withRing?: boolean
  className?: string
}

const COLOR_MAP = {
  live: 'bg-live',
  idle: 'bg-idle',
  fault: 'bg-fault',
  warn: 'bg-warn',
} as const

const RING_MAP = {
  live: 'ring-live/30',
  idle: 'ring-idle/20',
  fault: 'ring-fault/30',
  warn: 'ring-warn/30',
} as const

export function StatusDot({ status, size = 'sm', withRing = false, className }: StatusDotProps) {
  const family = statusFamily(status)
  const dim = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5'
  return (
    <span className={cn('relative inline-flex items-center justify-center', className)}>
      {family === 'live' && (
        <span
          aria-hidden
          className={cn(
            'absolute inline-flex h-2.5 w-2.5 rounded-full opacity-60 pulse-live',
            COLOR_MAP[family],
          )}
        />
      )}
      <span
        className={cn(
          'relative inline-flex rounded-full',
          dim,
          COLOR_MAP[family],
          withRing && `ring-2 ${RING_MAP[family]}`,
        )}
      />
    </span>
  )
}
