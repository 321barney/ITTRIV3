// src/lib/endpoints.ts
let RAW_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '')

// In the browser, never call localhost directly; use same-origin /api
if (typeof window !== 'undefined') {
  const isLocalhost = /^https?:\/\/localhost(:\d+)?$/i.test(RAW_BASE)
  if (isLocalhost) RAW_BASE = '/api'
}

export const API_BASE = RAW_BASE

export const ep = {
  auth: {
    login:    () => `${API_BASE}/auth/login`,
    register: () => `${API_BASE}/auth/register`,
    logout:   () => `${API_BASE}/auth/logout`,
    me:       () => `${API_BASE}/auth/me`,
    refresh:  () => `${API_BASE}/auth/refresh`,
  },
} as const

export async function postJSON<T>(url: string, data: unknown, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    body: JSON.stringify(data),
    credentials: 'include',
    ...init,
  })
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}
