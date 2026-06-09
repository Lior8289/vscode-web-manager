import type {
  CreateEnvironmentRequest,
  CreateEnvironmentResponse,
  DockerInfo,
  EnvironmentDetail,
  EnvironmentSummary,
  HealthResponse,
  RemoveResponse,
  StopAllResponse,
  StopResponse,
} from './types'

const BASE = '/api'

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.status = status
    this.body = body
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = await response.text().catch(() => null)
    }
    const detail =
      (body && typeof body === 'object' && 'detail' in body
        ? formatDetail((body as { detail: unknown }).detail)
        : null) ?? response.statusText
    throw new ApiError(response.status, detail, body)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function formatDetail(detail: unknown): string | null {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) =>
        typeof item === 'object' && item && 'msg' in item
          ? String((item as { msg: unknown }).msg)
          : JSON.stringify(item),
      )
      .join('; ')
  }
  return null
}

export const api = {
  health: () => request<HealthResponse>('/health'),
  dockerInfo: () => request<DockerInfo>('/docker/info'),
  listEnvironments: () => request<EnvironmentSummary[]>('/environments'),
  getEnvironment: (id: string) => request<EnvironmentDetail>(`/environments/${id}`),
  createEnvironment: (input: CreateEnvironmentRequest) =>
    request<CreateEnvironmentResponse>('/environments', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  stopEnvironment: (id: string) =>
    request<StopResponse>(`/environments/${id}/stop`, { method: 'POST' }),
  stopAllEnvironments: () =>
    request<StopAllResponse>('/environments/stop-all', { method: 'POST' }),
  removeEnvironment: (id: string) =>
    request<RemoveResponse>(`/environments/${id}`, { method: 'DELETE' }),
}
