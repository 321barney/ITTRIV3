/**
 * gRPC-Web Client Configuration
 * 
 * Simplified client that uses HTTP/JSON via Envoy transcoding.
 * Works with the existing API proxy infrastructure.
 */

export interface GrpcMetadata {
  [key: string]: string;
}

export interface GrpcCallOptions {
  metadata?: GrpcMetadata;
  timeout?: number;
}

/**
 * Create metadata headers for gRPC calls
 */
export function createMetadata(token?: string): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
}

/**
 * Base gRPC client for making HTTP/JSON calls to gRPC services via Envoy
 */
export class GrpcClient {
  private token?: string;

  constructor(token?: string) {
    this.token = token;
  }

  /**
   * Make a unary gRPC call (single request/response)
   */
  async unaryCall<TRequest, TResponse>(
    path: string,
    request: TRequest,
    options?: GrpcCallOptions
  ): Promise<TResponse> {
    const headers = createMetadata(this.token);
    
    // Add custom metadata if provided
    if (options?.metadata) {
      Object.assign(headers, options.metadata);
    }

    const controller = new AbortController();
    const timeoutId = options?.timeout 
      ? setTimeout(() => controller.abort(), options.timeout)
      : null;

    try {
      const response = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        credentials: 'include',
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`gRPC call failed [${response.status}]: ${errorText}`);
      }

      return await response.json();
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Make a GET request (for gRPC methods with no body)
   */
  async get<TResponse>(path: string, options?: GrpcCallOptions): Promise<TResponse> {
    const headers = createMetadata(this.token);
    
    if (options?.metadata) {
      Object.assign(headers, options.metadata);
    }

    const controller = new AbortController();
    const timeoutId = options?.timeout 
      ? setTimeout(() => controller.abort(), options.timeout)
      : null;

    try {
      const response = await fetch(path, {
        method: 'GET',
        headers,
        credentials: 'include',
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`gRPC call failed [${response.status}]: ${errorText}`);
      }

      return await response.json();
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Update the authentication token
   */
  setToken(token: string) {
    this.token = token;
  }

  /**
   * Clear the authentication token
   */
  clearToken() {
    this.token = undefined;
  }
}

/**
 * Create a new gRPC client instance
 */
export function createGrpcClient(token?: string): GrpcClient {
  return new GrpcClient(token);
}

export default GrpcClient;
