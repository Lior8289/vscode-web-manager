import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { HeaderBar } from '@/components/HeaderBar'
import { TitleBlock } from '@/components/TitleBlock'
import { EnvironmentManifest } from '@/components/EnvironmentManifest'
import { CreateEnvironmentDialog } from '@/components/CreateEnvironmentDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EnvironmentDetailSheet } from '@/components/EnvironmentDetailSheet'
import { ShortcutsHint } from '@/components/ShortcutsHint'
import {
  useCreateEnvironment,
  useEnvironments,
  useRemoveEnvironment,
  useStopAllEnvironments,
  useStopEnvironment,
} from '@/hooks/api'
import type { EnvironmentSummary } from '@/lib/types'

type ConfirmIntent =
  | { kind: 'stop'; env: EnvironmentSummary }
  | { kind: 'remove'; env: EnvironmentSummary }
  | { kind: 'start'; env: EnvironmentSummary }
  | { kind: 'stopAll' }

export function Dashboard() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmIntent | null>(null)

  const { data: envs } = useEnvironments()
  const stopMut = useStopEnvironment()
  const removeMut = useRemoveEnvironment()
  const stopAllMut = useStopAllEnvironments()
  const startMut = useCreateEnvironment()

  const isTypingTarget = (el: EventTarget | null) => {
    if (!(el instanceof HTMLElement)) return false
    const tag = el.tagName.toLowerCase()
    return tag === 'input' || tag === 'textarea' || el.isContentEditable
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'n' && !createOpen) {
        e.preventDefault()
        setCreateOpen(true)
      } else if (k === 'r') {
        e.preventDefault()
        qc.invalidateQueries({ queryKey: ['environments'] })
        qc.invalidateQueries({ queryKey: ['docker', 'info'] })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createOpen, qc])

  const handleConfirm = useCallback(async () => {
    if (!confirm) return
    try {
      if (confirm.kind === 'stop') await stopMut.mutateAsync(confirm.env.id)
      if (confirm.kind === 'remove') await removeMut.mutateAsync(confirm.env.id)
      if (confirm.kind === 'stopAll') await stopAllMut.mutateAsync()
      if (confirm.kind === 'start') {
        const result = await startMut.mutateAsync({ mount_folder: confirm.env.mount_folder })
        window.open(result.url, '_blank', 'noopener,noreferrer')
      }
    } catch {
      // toast surfaces it
    } finally {
      setConfirm(null)
    }
  }, [confirm, stopMut, removeMut, stopAllMut, startMut])

  const runningCount =
    envs?.filter((e) => e.status.toLowerCase().includes('running')).length ?? 0

  return (
    <div className="min-h-screen flex flex-col">
      <HeaderBar
        onCreate={() => setCreateOpen(true)}
        onStopAll={() => setConfirm({ kind: 'stopAll' })}
        stopAllDisabled={runningCount === 0 || stopAllMut.isPending}
      />
      <main className="flex-1">
        <TitleBlock />
        <EnvironmentManifest
          onCreate={() => setCreateOpen(true)}
          onOpenDetails={(id) => setDetailId(id)}
          onConfirmStop={(env) => setConfirm({ kind: 'stop', env })}
          onConfirmRemove={(env) => setConfirm({ kind: 'remove', env })}
          onConfirmStart={(env) => setConfirm({ kind: 'start', env })}
          startingMountFolder={
            startMut.isPending ? (startMut.variables?.mount_folder ?? null) : null
          }
        />
        <ShortcutsHint />
      </main>

      <CreateEnvironmentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => setDetailId(id)}
      />

      <EnvironmentDetailSheet id={detailId} onClose={() => setDetailId(null)} />

      <ConfirmDialog
        open={confirm?.kind === 'stop'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Stop environment"
        description={
          confirm?.kind === 'stop' ? (
            <>
              The container <span className="font-mono text-bone">{confirm.env.container_name}</span>{' '}
              will be stopped. Its workspace folder stays on disk.
            </>
          ) : undefined
        }
        confirmLabel="Stop"
        onConfirm={() => void handleConfirm()}
        loading={stopMut.isPending}
      />

      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Remove environment"
        description={
          confirm?.kind === 'remove' ? (
            <>
              Remove container{' '}
              <span className="font-mono text-bone">{confirm.env.container_name}</span>. The
              workspace folder is preserved on the host.
            </>
          ) : undefined
        }
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => void handleConfirm()}
        loading={removeMut.isPending}
      />

      <ConfirmDialog
        open={confirm?.kind === 'start'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Start environment"
        description={
          confirm?.kind === 'start' ? (
            <>
              The container{' '}
              <span className="font-mono text-bone">{confirm.env.container_name}</span> is{' '}
              <span className="font-mono text-bone">{confirm.env.status}</span>. Start it and open
              the editor in a new tab?
            </>
          ) : undefined
        }
        confirmLabel="Start & open"
        onConfirm={() => void handleConfirm()}
        loading={startMut.isPending}
      />

      <ConfirmDialog
        open={confirm?.kind === 'stopAll'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Stop all running environments"
        description={
          confirm?.kind === 'stopAll' ? (
            <>
              {runningCount} running container{runningCount === 1 ? '' : 's'} will be stopped.
              Workspaces are preserved.
            </>
          ) : undefined
        }
        confirmLabel="Stop all"
        onConfirm={() => void handleConfirm()}
        loading={stopAllMut.isPending}
      />
    </div>
  )
}
