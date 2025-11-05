// src/logger.ts
import pino, { LoggerOptions, Logger } from 'pino';

const isDev = (process.env.NODE_ENV ?? 'development') === 'development';
const level = process.env.LOG_LEVEL || (isDev ? 'debug' : 'info');

const baseOptions: LoggerOptions = {
  level,
  timestamp: pino.stdTimeFunctions.isoTime, // ISO8601 timestamps
  redact: {
    paths: [
      // common secrets
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      'config.security.proxyToken',
      'env.JWT_SECRET',
      '*.password',
      '*.token',
      '*.secret',
    ],
    remove: true,
  },
  formatters: {
    level(label) {
      return { level: label }; // keep { level: 'info' }
    },
    bindings(bindings) {
      // keep pid/hostname minimal, attach service if present
      const { pid, hostname } = bindings;
      return { pid, hostname, service: (bindings as any).service };
    },
  },
  serializers: {
    // Better error logs
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          ignore: 'pid,hostname',
          translateTime: 'SYS:standard',
          colorize: true,
          singleLine: false,
        },
      }
    : undefined,
};

const rootLogger = pino(baseOptions);

/**
 * Create a child logger with a name (keeps your getLogger API).
 * Usage: const log = getLogger('api'); log.info('booted');
 */
export function getLogger(name: string): Logger {
  return rootLogger.child({ name });
}

/** Export the root logger for places that don’t need a named child. */
export const logger = rootLogger;

/** Convenience: fastify onRequest/onResponse hooks */
export function withRequestLogging(appName = 'api') {
  const log = getLogger(appName);
  return {
    onRequest(req: any) {
      log.debug(
        { req: { method: req.method, url: req.url, id: req.id } },
        'Incoming request'
      );
    },
    onResponse(req: any, res: any) {
      log.info(
        {
          req: { method: req.method, url: req.url, id: req.id },
          res: { statusCode: res.statusCode },
        },
        'Request completed'
      );
    },
  };
}
