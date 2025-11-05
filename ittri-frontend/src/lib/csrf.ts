// api/_lib/csrf.ts
import crypto from 'node:crypto';

// Double-submit cookie CSRF (lightweight): the app should set a cookie "csrf"
// and send header "x-csrf-token" with the same value on mutating requests.
export function requireCsrf(method: string, headers: Headers, cookies: Map<string, string>): string | null {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return null;
  const header = headers.get('x-csrf-token') || '';
  const cookie = cookies.get('csrf') || '';
  if (!header || !cookie || header !== cookie) return 'csrf_failed';
  return null;
}

// Helper for generating a CSRF token server-side (optional)
export function newCsrfToken() {
  return crypto.randomBytes(16).toString('hex');
}
