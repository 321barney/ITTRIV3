const API_BASE = (process.env.API_INTERNAL_BASE || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '') as string;
class SecureApiClient {
  private async makeRequest(endpoint: string, options: RequestInit = {}) {
    const timestamp = Date.now().toString();
    const body = options.body as string || '';

    // Don't expose secrets in frontend - signature handled by API routes
    const url = `${API_BASE}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Timestamp': timestamp,
        'X-Request-ID': crypto.randomUUID(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Network error' }));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async login(data: LoginInput) {
    return this.makeRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async register(data: RegisterInput) {
    return this.makeRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async logout() {
    return this.makeRequest('/auth/logout', { method: 'POST' });
  }

  async me() {
    return this.makeRequest('/auth/me', { method: 'GET' });
  }

  async refresh() {
    return this.makeRequest('/auth/refresh', { method: 'POST' });
  }
}

export const api = new SecureApiClient();