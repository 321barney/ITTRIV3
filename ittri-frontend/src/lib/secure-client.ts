// src/lib/secure-client.ts - Frontend MUST EARN access
import { config, generateClientFingerprint } from './config/env';

export class StrictSecureClient {
  private apiKey: string | null = null;
  private token: string | null = null;

  // Frontend must authenticate to get API access
  async authenticate(username: string, password: string): Promise<boolean> {
    try {
      const fingerprint = generateClientFingerprint();

      const response = await fetch(`${config.api.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin
        },
        credentials: 'include',
        body: JSON.stringify({ 
          username, 
          password, 
          clientFingerprint: fingerprint 
        })
      });

      if (response.ok) {
        const data = await response.json();
        this.token = data.token;
        this.apiKey = data.apiKey; // EARNED through authentication

        sessionStorage.setItem('auth_token', this.token);
        sessionStorage.setItem('api_key', this.apiKey);

        return true;
      }

      return false;
    } catch (error) {
      console.error('Authentication failed:', error);
      return false;
    }
  }

  // All API calls MUST include API key
  async secureRequest(url: string, options: RequestInit = {}) {
    if (!this.apiKey || !this.token) {
      throw new Error('Must authenticate before making API calls');
    }

    return fetch(`${config.api.baseUrl}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        'X-API-Key': this.apiKey, // REQUIRED for all API calls
        'Origin': window.location.origin,
        ...options.headers
      },
      credentials: 'include'
    });
  }
}