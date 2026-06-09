import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { useCreateEnvironment } from '@/hooks/api'
import { cn } from '@/lib/utils'

const schema = z.object({
  mount_folder: z
    .string()
    .min(1, 'Required')
    .max(80, '80 character maximum')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Letters, numbers, hyphen, underscore only'),
})

type FormValues = z.infer<typeof schema>

interface CreateEnvironmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (id: string) => void
}

export function CreateEnvironmentDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateEnvironmentDialogProps) {
  const create = useCreateEnvironment()

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    reset,
    control,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { mount_folder: '' },
  })

  useEffect(() => {
    if (!open) reset({ mount_folder: '' })
  }, [open, reset])

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await create.mutateAsync(values)
      onOpenChange(false)
      onCreated?.(result.id)
    } catch {
      // toast already fired
    }
  })

  const value = useWatch({ control, name: 'mount_folder' }) ?? ''

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Provision environment"
      description="Pick a workspace name. A folder of that name is created under HOST_WORKSPACES_ROOT and bind-mounted into the container."
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void onSubmit()}
            disabled={!isValid}
            loading={create.isPending}
          >
            Provision
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => void onSubmit(e)}
        className="space-y-3"
      >
        <label className="block">
          <span className="label-eyebrow mb-2 block">mount_folder</span>
          <div
            className={cn(
              'flex items-stretch border bg-ink',
              errors.mount_folder
                ? 'border-fault/60'
                : 'border-ink-line focus-within:border-ink-line-hot',
              'transition-colors',
            )}
          >
            <span className="inline-flex items-center px-3 font-mono text-[12px] text-bone-mute border-r border-ink-line">
              /workspaces/
            </span>
            <input
              {...register('mount_folder')}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="demo-project"
              className={cn(
                'flex-1 px-3 py-2.5 bg-transparent',
                'font-mono text-[13px] text-bone placeholder:text-bone-mute',
                'outline-none',
              )}
            />
          </div>
        </label>

        <div className="flex items-center justify-between min-h-[16px]">
          {errors.mount_folder ? (
            <p className="text-[11.5px] font-mono text-fault">
              {errors.mount_folder.message}
            </p>
          ) : value ? (
            <p className="text-[11px] font-mono text-bone-mute">
              opens at <span className="text-bone-dim">vscode-env-&lt;hex&gt;.localhost</span>
            </p>
          ) : (
            <span />
          )}
          <span className="text-[11px] font-mono text-bone-mute tabular-nums">
            {value.length}/80
          </span>
        </div>
      </form>
    </Dialog>
  )
}
