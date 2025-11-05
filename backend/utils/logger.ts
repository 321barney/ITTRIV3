// src/logger/index.ts
import pino, { Logger, LoggerOptions } from 'pino';

const isDev = (process.env.NODE_ENV ?? 'development') === 'development';

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  base: {
    app: process.env.APP_NAME ?? 'backend',
    env: process.env.NODE_ENV ?? 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime, // ISO 8601
  // redact common secrets everywhere (headers, env, payloads)
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.body.password',
      'req.body.token',
      '*.credentials_json',
      '*.key',
      '*.secret',
      '*.password',
      'process.env.JWT_SECRET',
      'process.env.STRIPE_SECRET_KEY',
      'process.env.N8N_TOKEN',
      'process.env.PROXY_TOKEN',
      'process.env.DATABASE_URL',
    ],
    remove: true,
  },
};

const transport =
  isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard', singleLine: false } }
    : undefined;

// Optional file logging (in addition to stdout)
const logToFile = (process.env.LOG_TO_FILE ?? '').trim();
const destination = !logToFile
  ? undefined
  : pino.destination({ dest: logToFile, sync: false, mkdir: true });

export const logger: Logger =
  destination
    ? pino({ ...baseOptions }, destination)
    : pino({ ...baseOptions, transport });

/**
 * Create a child logger tagged with a component/module name.
 * Usage: const log = getLogger('db'); log.info('connected');
 */
export function getLogger(component: string, bindings?: Record<string, unknown>) {
  return logger.child({ component, ...(bindings ?? {}) });
}

/**
 * Fastify helper: build a child logger with request context.
 * Use inside route handlers or hooks.
 */
export function requestChild(req: { id?: any; ip?: any }, extra?: Record<string, unknown>) {
  return logger.child({ reqId: req.id, ip: req.ip, ...(extra ?? {}) });
}
