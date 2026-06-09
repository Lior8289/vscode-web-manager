import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-volt text-ink hover:bg-volt-dim active:bg-volt/90 disabled:bg-bone-mute disabled:text-ink-raised',
  secondary:
    'bg-ink-raised text-bone border border-ink-line hover:border-ink-line-hot hover:bg-ink-raised/70',
  ghost:
    'bg-transparent text-bone-dim hover:text-bone hover:bg-ink-raised',
  outline:
    'bg-transparent text-bone border border-ink-line hover:border-ink-line-hot hover:bg-ink-raised/40',
  danger:
    'bg-transparent text-bone-dim border border-ink-line hover:text-fault hover:border-fault/60 hover:bg-fault/5',
}

const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5',
  md: 'h-9 px-3.5 text-[13px] gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
  icon: 'h-9 w-9',
  'icon-sm': 'h-7 w-7',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, children, loading, iconLeft, iconRight, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center font-medium tracking-[-0.005em] select-none',
        'transition-[background-color,border-color,color,opacity] duration-150 ease-out',
        'rounded-xs whitespace-nowrap',
        'disabled:opacity-60 disabled:pointer-events-none',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span className="inline-flex h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
      ) : (
        iconLeft && <span className="inline-flex shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5">{iconLeft}</span>
      )}
      {children && <span>{children}</span>}
      {iconRight && <span className="inline-flex shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5">{iconRight}</span>}
    </button>
  )
})
