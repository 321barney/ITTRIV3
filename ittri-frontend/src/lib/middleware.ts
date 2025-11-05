import { NextRequest, NextResponse } from 'next/server';

export interface ApiContext {
  req: NextRequest;
  operation: string;
  ip: string;
  userAgent: string;
  timestamp: string;
}

export class ApiMiddleware {
  // Rate limiting store (in production, use Redis)
  private static rateLimitStore = new Map<string, { count: number; resetTime: number }>();

  // Create context for request
  static createContext(req: NextRequest, operation: string): ApiContext {
    return {
      req,
      operation,
      ip: req.ip || req.headers.get('x-forwarded-for') || 'unknown',
      userAgent: req.headers.get('user-agent') || 'unknown',
      timestamp: new Date().toISOString(),
    };
  }

  // Rate limiting
  static checkRateLimit(ctx: ApiContext, maxRequests = 10, windowMs = 60000): boolean {
    const key = `${ctx.ip}:${ctx.operation}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    const current = this.rateLimitStore.get(key);

    if (!current || current.resetTime < windowStart) {
      this.rateLimitStore.set(key, { count: 1, resetTime: now });
      return true;
    }

    if (current.count >= maxRequests) {
      return false;
    }

    current.count++;
    return true;
  }

  // Logging
  static log(ctx: ApiContext, level: 'info' | 'error' | 'warn', message: string, data?: any) {
    const logEntry = {
      timestamp: ctx.timestamp,
      level,
      operation: ctx.operation,
      ip: ctx.ip,
      message,
      ...(data && { data }),
    };

    console[level](`[API] ${message}`, logEntry);
  }

  // Security headers
  static getSecurityHeaders(): Record<string, string> {
    return {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
  }

  // CORS headers
  static getCorsHeaders(): Record<string, string> {
    return {
      'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Allow-Credentials': 'true',
    };
  }
}