/**
 * Unified API Client
 * 
 * Central client for all backend services (REST + gRPC).
 * Provides a simple interface for frontend components to interact with the backend.
 */

import { AdminServiceClient, AIServiceClient } from './grpc/index';

/**
 * API Client Configuration
 */
export interface ApiClientConfig {
  token?: string;
  baseUrl?: string;
}

/**
 * Main API Client
 */
export class ApiClient {
  public admin: AdminServiceClient;
  public ai: AIServiceClient;
  
  private token?: string;
  private baseUrl: string;

  constructor(config: ApiClientConfig = {}) {
    this.token = config.token;
    this.baseUrl = config.baseUrl || '/api/v1';
    
    this.admin = new AdminServiceClient(this.token);
    this.ai = new AIServiceClient(this.token, `${this.baseUrl}/ai`);
  }

  /**
   * Update authentication token for all services
   */
  setToken(token: string) {
    this.token = token;
    this.admin = new AdminServiceClient(token);
    this.ai = new AIServiceClient(token, `${this.baseUrl}/ai`);
  }

  /**
   * Clear authentication
   */
  clearAuth() {
    this.token = undefined;
    this.admin = new AdminServiceClient();
    this.ai = new AIServiceClient();
  }

  /**
   * Generic fetch helper for custom endpoints
   */
  async fetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': this.token ? `Bearer ${this.token}` : '',
        'Content-Type': 'application/json',
        ...options.headers,
      },
      credentials: 'include',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error [${response.status}]: ${errorText}`);
    }

    return await response.json();
  }

  /**
   * GET request helper
   */
  async get<T = any>(path: string, params?: Record<string, any>): Promise<T> {
    const url = new URL(path.startsWith('http') ? path : `${this.baseUrl}${path}`, window.location.origin);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    return this.fetch(url.toString(), { method: 'GET' });
  }

  /**
   * POST request helper
   */
  async post<T = any>(path: string, data?: any): Promise<T> {
    return this.fetch(path, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * PATCH request helper
   */
  async patch<T = any>(path: string, data?: any): Promise<T> {
    return this.fetch(path, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * DELETE request helper
   */
  async delete<T = any>(path: string): Promise<T> {
    return this.fetch(path, { method: 'DELETE' });
  }
}

/**
 * Create a new API client instance
 */
export function createApiClient(config?: ApiClientConfig): ApiClient {
  return new ApiClient(config);
}

/**
 * Default API client instance
 */
export const apiClient = createApiClient();

export default apiClient;
