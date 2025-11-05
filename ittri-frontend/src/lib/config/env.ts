// src/lib/config/env.ts - Secure configuration (NO SECRETS)
import { useState, useEffect } from 'react';

// Secure API configuration - NO sensitive data exposed
const getSecureApiConfiguration = () => {
  // Server-side rendering fallback
  if (typeof window === 'undefined') {
    return {
      apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    };
  }

  // Browser environment - secure detection
  const host = window.location.hostname;
  const protocol = window.location.protocol;

  // Use environment variable or detect from current page
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 
                 `${protocol}//${host}:8000`;

  return { apiUrl };
};

// Backend discovery with security validation
export const discoverSecureBackend = async (): Promise<{
  apiUrl: string;
  isSecure: boolean;
  isReachable: boolean;
}> => {
  const config = getSecureApiConfiguration();

  try {
    // Only try the configured URL (don't scan ports for security)
    const response = await fetch(`${config.apiUrl}/health`, { 
      method: 'GET',
      signal: AbortSignal.timeout(5000),
      cache: 'no-cache'
    });

    if (response.ok) {
      return {
        apiUrl: config.apiUrl,
        isSecure: config.apiUrl.startsWith('https'),
        isReachable: true
      };
    }
  } catch (error) {
    console.warn('Backend discovery failed:', error.message);
  }

  // Fallback configuration
  return {
    apiUrl: config.apiUrl,
    isSecure: config.apiUrl.startsWith('https'),
    isReachable: false
  };
};

// Secure environment configuration
const getEnvironmentConfig = () => {
  const baseConfig = getSecureApiConfiguration();
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    development: {
      ...baseConfig,
      debug: true,
      security: {
        strictMode: false,
        allowInsecureHttp: true
      }
    },
    production: {
      ...baseConfig,
      debug: false,
      security: {
        strictMode: true,
        allowInsecureHttp: false,
        requireHttps: true
      }
    }
  };
};

// Main configuration
const envConfig = getEnvironmentConfig();
const currentEnv = process.env.NODE_ENV === 'production' ? 'production' : 'development';

export const env = {
  ...envConfig[currentEnv],

  // API Configuration (public, non-sensitive)
  api: {
    baseUrl: envConfig[currentEnv].apiUrl,
    timeout: parseInt(process.env.NEXT_PUBLIC_API_TIMEOUT || '10000'),
    retries: 3,
    version: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0'
  },

  // Security Configuration (public settings only)
  security: {
    ...envConfig[currentEnv].security,
    tokenStorage: 'sessionStorage', // Never localStorage for security
    autoRefresh: true,
    maxRetries: 3
  },

  // Feature flags (public)
  features: {
    secureMode: currentEnv === 'production',
    debug: envConfig[currentEnv].debug,
    healthCheck: true
  },

  // App configuration
  app: {
    name: process.env.NEXT_PUBLIC_APP_NAME || 'SecureApp',
    version: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
    environment: currentEnv
  }
};

// Security validation
export const validateSecureEnvironment = (): { 
  valid: boolean; 
  errors: string[];
  warnings: string[];
} => {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check API URL
  if (!env.api.baseUrl) {
    errors.push('API base URL is not configured');
  }

  // Production security checks
  if (currentEnv === 'production') {
    if (!env.api.baseUrl.startsWith('https://')) {
      errors.push('HTTPS is required in production');
    }

    if (env.debug) {
      warnings.push('Debug mode should be disabled in production');
    }
  }

  // Development warnings
  if (currentEnv === 'development') {
    if (env.api.baseUrl.startsWith('http://')) {
      warnings.push('Consider using HTTPS even in development');
    }
  }

  // Check for suspicious configurations
  if (env.api.baseUrl.includes('localhost') && currentEnv === 'production') {
    errors.push('Production should not use localhost URLs');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
};

// Safe environment info (no secrets)
export const getEnvironmentInfo = () => {
  const validation = validateSecureEnvironment();

  return {
    environment: currentEnv,
    apiUrl: env.api.baseUrl,
    isSecure: env.api.baseUrl.startsWith('https'),
    version: env.app.version,
    debug: env.debug,
    validation: validation,
    timestamp: new Date().toISOString()
  };
};

// Export main configuration
export const config = env;

// Default export
export default env;

// Type definitions for TypeScript
export interface SecureApiConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
  version: string;
}

export interface SecurityConfig {
  strictMode: boolean;
  allowInsecureHttp: boolean;
  requireHttps?: boolean;
  tokenStorage: 'sessionStorage' | 'none';
  autoRefresh: boolean;
  maxRetries: number;
}

export interface EnvironmentConfig {
  api: SecureApiConfig;
  security: SecurityConfig;
  features: {
    secureMode: boolean;
    debug: boolean;
    healthCheck: boolean;
  };
  app: {
    name: string;
    version: string;
    environment: string;
  };
}