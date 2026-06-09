export interface HealthResponse {
  status: string
}

export interface DockerInfo {
  docker: string
  server_version: string
  containers: number
  images: number
}

export interface EnvironmentSummary {
  id: string
  container_name: string
  status: string
  url: string
  mount_folder: string
}

export interface CreateEnvironmentResponse {
  id: string
  container_name: string
  status: string
  url: string
  workspace_path: string
  reused: boolean
}

export interface EnvironmentMount {
  Type?: string
  Source: string
  Destination: string
  Mode?: string
  RW?: boolean
  Propagation?: string
  Name?: string
  Driver?: string
}

export interface EnvironmentNetwork {
  IPAddress?: string
  Gateway?: string
  MacAddress?: string
  NetworkID?: string
  EndpointID?: string
  [key: string]: unknown
}

export interface EnvironmentDetail {
  id: string
  container_name: string
  status: string
  image: string
  labels: Record<string, string>
  mounts: EnvironmentMount[]
  networks: Record<string, EnvironmentNetwork>
}

export interface StopResponse {
  id: string
  container_name: string
  status: string
}

export interface RemoveResponse {
  id: string
  removed: boolean
}

export interface StopAllEnvironmentResult {
  id: string
  container_name: string
  previous_status: string
  status: string
  skipped: boolean
}

export interface StopAllFailure {
  id: string
  container_name: string
  error: string
}

export interface StopAllResponse {
  stopped_count: number
  skipped_count: number
  failed_count: number
  environments: StopAllEnvironmentResult[]
  failures: StopAllFailure[]
}

export interface CreateEnvironmentRequest {
  mount_folder: string
}

export interface ApiErrorBody {
  detail?: string | Array<{ msg: string; loc?: (string | number)[] }>
}
