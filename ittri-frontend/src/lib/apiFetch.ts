// lib/apiFetch.ts
export async function apiFetch(input: RequestInfo, init?: RequestInit) {
  const doFetch = () => fetch(input, { ...init, credentials: 'include', cache: 'no-store' });
  let res = await doFetch();
  if (res.status !== 401) return res;

  const refresh = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', cache: 'no-store' });
  if (!refresh.ok) return res; // still unauthorized → caller decides (logout/redirect)

  res = await doFetch();
  return res;
}
