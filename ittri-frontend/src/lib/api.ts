const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

async function apiCall(endpoint: string, options: RequestInit = {}) {
  const url = `${BACKEND_URL}${endpoint}`;

  console.log(`API Call: ${options.method || 'GET'} ${url}`);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return await response.json();
    }
    return await response.text();
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

export const auth = {
  async login(email: string, password?: string, adminKey?: string) {
    return apiCall('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, adminKey }),
    });
  },

  async register(email: string, companyName: string, planCode: string = 'starter') {
    return apiCall('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, companyName, planCode }),
    });
  },

  async logout() {
    return apiCall('/auth/logout', { method: 'POST' });
  },

  async me() {
    return apiCall('/auth/me', { method: 'GET' });
  },

  async refresh() {
    return apiCall('/auth/refresh', { method: 'POST' });
  },
};

export const login = auth.login;
export const register = auth.register;
export const logout = auth.logout;
export const me = auth.me;
export const refresh = auth.refresh;

export type LoginInput = {
  email: string;
  password?: string;
  adminKey?: string;
};

export type RegisterInput = {
  email: string;
  companyName: string;
  planCode?: string;
};