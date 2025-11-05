export function ok<T>(data: T) { return { ok: true, data }; }
export function err(code: string, message?: string, details?: unknown) { return { ok: false, error: code, message, details }; }
