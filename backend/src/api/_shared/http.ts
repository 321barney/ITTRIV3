// src/api/_shared/http.ts
export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string; message?: string; details?: unknown };
export type ApiResult<T> = ApiOk<T> | ApiErr;

export function ok<T>(data: T): ApiOk<T> { return { ok: true, data }; }
export function err(code: string, message?: string, details?: unknown): ApiErr {
  return { ok: false, error: code, message, details };
}

// Optional: Fastify-friendly send helpers
import type { FastifyReply } from 'fastify';
export function sendOk<T>(reply: FastifyReply, data: T, status = 200) {
  return reply.code(status).send(ok(data));
}
export function sendErr(reply: FastifyReply, status: number, code: string, message?: string, details?: unknown) {
  return reply.code(status).send(err(code, message, details));
}
