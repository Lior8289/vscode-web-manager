import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function shortId(id: string, length = 8): string {
  if (id.length <= length) return id
  return id.slice(0, length)
}

export function statusFamily(status: string): 'live' | 'idle' | 'fault' | 'warn' {
  const s = status.toLowerCase()
  if (s.includes('running')) return 'live'
  if (s.includes('exited') || s.includes('stopped') || s.includes('dead')) return 'idle'
  if (s.includes('created') || s.includes('paused')) return 'warn'
  if (s.includes('restart') || s.includes('error') || s.includes('fail')) return 'fault'
  return 'idle'
}

export function statusLabel(status: string): string {
  const s = status.toLowerCase()
  if (s.includes('running')) return 'Running'
  if (s.includes('exited')) return 'Exited'
  if (s.includes('stopped')) return 'Stopped'
  if (s.includes('created')) return 'Created'
  if (s.includes('paused')) return 'Paused'
  if (s.includes('restart')) return 'Restarting'
  if (s.includes('dead')) return 'Dead'
  return status.charAt(0).toUpperCase() + status.slice(1)
}
