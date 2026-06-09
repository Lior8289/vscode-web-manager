import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import type { CreateEnvironmentRequest } from '@/lib/types'

const KEYS = {
  health: ['health'] as const,
  dockerInfo: ['docker', 'info'] as const,
  environments: ['environments'] as const,
  environment: (id: string) => ['environments', id] as const,
}

export function useDockerInfo() {
  return useQuery({
    queryKey: KEYS.dockerInfo,
    queryFn: api.dockerInfo,
    refetchInterval: 10_000,
    retry: false,
  })
}

export function useEnvironments() {
  return useQuery({
    queryKey: KEYS.environments,
    queryFn: api.listEnvironments,
    refetchInterval: 3_000,
    retry: 1,
  })
}

export function useEnvironmentDetail(id: string | null) {
  return useQuery({
    queryKey: KEYS.environment(id ?? ''),
    queryFn: () => api.getEnvironment(id as string),
    enabled: Boolean(id),
    refetchInterval: id ? 5_000 : false,
  })
}

export function useCreateEnvironment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateEnvironmentRequest) => api.createEnvironment(input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: KEYS.environments })
      if (data.reused) {
        toast.success('Environment reused', {
          description: data.container_name,
        })
      } else {
        toast.success('Environment created', {
          description: data.container_name,
        })
      }
    },
    onError: (err) => {
      toast.error('Could not create environment', {
        description: err instanceof ApiError ? err.message : String(err),
      })
    },
  })
}

export function useStopEnvironment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.stopEnvironment(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: KEYS.environments })
      qc.invalidateQueries({ queryKey: KEYS.environment(data.id) })
      toast.success('Environment stopped', { description: data.container_name })
    },
    onError: (err) => {
      toast.error('Could not stop environment', {
        description: err instanceof ApiError ? err.message : String(err),
      })
    },
  })
}

export function useRemoveEnvironment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.removeEnvironment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.environments })
      toast.success('Environment removed')
    },
    onError: (err) => {
      toast.error('Could not remove environment', {
        description: err instanceof ApiError ? err.message : String(err),
      })
    },
  })
}

export function useStopAllEnvironments() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.stopAllEnvironments,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: KEYS.environments })
      if (data.failed_count > 0) {
        toast.warning(`Stopped ${data.stopped_count}, ${data.failed_count} failed`, {
          description: data.failures.map((f) => f.container_name).join(', '),
        })
      } else if (data.stopped_count === 0 && data.skipped_count === 0) {
        toast.info('No environments to stop')
      } else {
        toast.success(`Stopped ${data.stopped_count} environment(s)`, {
          description:
            data.skipped_count > 0 ? `${data.skipped_count} already stopped` : undefined,
        })
      }
    },
    onError: (err) => {
      toast.error('Stop-all failed', {
        description: err instanceof ApiError ? err.message : String(err),
      })
    },
  })
}
