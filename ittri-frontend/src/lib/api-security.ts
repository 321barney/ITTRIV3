import { NextRequest } from 'next/server';

export class BackendProxy {
  private static readonly BACKEND_URL = process.env.BACKEND_URL || process.env.API_INTERNAL_BASE;
  private static readonly TIMEOUT = 15000;

  static async call(
    endpoint: string,
    options: RequestInit = {},
    originalReq?: NextRequest
  ): Promise<{ success: boolean; data?: any; error?: string; status: number; headers?: Headers }> {

    if (!this.BACKEND_URL) {
      return {
        success: false,
        error: 'Backend URL not configured',
        status: 500
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT);

    try {
      const url = `${this.BACKEND_URL}${endpoint}`;

      // Prepare headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'NextJS-Proxy/1.0',
        ...(options.headers as Record<string, string> || {}),
      };

      // Forward authentication cookies
      if (originalReq?.headers.get('cookie')) {
        headers['Cookie'] = originalReq.headers.get('cookie')!;
      }

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      let responseData;
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }

      return {
        success: response.ok,
        data: responseData,
        error: response.ok ? undefined : (responseData?.error || responseData?.message || `HTTP ${response.status}`),
        status: response.status,
        headers: response.headers,
      };

    } catch (error: any) {
      clearTimeout(timeoutId);

      let errorMessage = 'Backend communication failed';
      let status = 500;

      if (error.name === 'AbortError') {
        errorMessage = 'Backend request timeout';
        status = 504;
      } else if (error.code === 'ECONNREFUSED') {
        errorMessage = 'Backend service unavailable';
        status = 503;
      } else {
        errorMessage = error.message || errorMessage;
      }

      return {
        success: false,
        error: errorMessage,
        status,
      };
    }
  }

  // Transform frontend data to backend format
  static transformRequestData(operation: string, data: any): any {
    switch (operation) {
      case 'register':
        // Transform to match your backend's expected format
        return {
          email: data.email,
          companyName: data.companyName,
          planCode: data.planCode || 'starter',
          // Add other fields as needed
        };

      case 'login':
        return {
          email: data.email,
          password: data.password,
          adminKey: data.adminKey,
        };

      default:
        return data;
    }
  }
}
