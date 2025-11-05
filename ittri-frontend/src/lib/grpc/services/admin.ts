/**
 * Admin Service gRPC Client
 * 
 * Provides methods to interact with the Admin service via gRPC.
 * Uses HTTP/JSON transcoding through Envoy proxy.
 */

import { GrpcClient } from '../client';

export interface AdminOrder {
  id: string;
  store_id: string;
  customer_id?: string;
  total: number;
  status: string;
  created_at: string;
  store_name?: string;
  seller_id?: string;
}

export interface AdminOrdersResponse {
  ok: boolean;
  orders: AdminOrder[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface AdminConfigResponse {
  ok: boolean;
  config: Record<string, any>;
}

/**
 * Admin Service Client
 */
export class AdminServiceClient {
  private token?: string;

  constructor(token?: string) {
    this.token = token;
  }

  /**
   * Get admin orders with pagination
   */
  async getOrders(params: {
    page?: number;
    limit?: number;
    store_id?: string;
    status?: string;
    seller_id?: string;
  } = {}): Promise<AdminOrdersResponse> {
    // Using HTTP/JSON endpoint through Envoy transcoding
    const url = new URL('/api/v1/admin/orders', window.location.origin);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) url.searchParams.set(key, String(value));
    });

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': this.token ? `Bearer ${this.token}` : '',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch orders: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Get a specific order by ID
   */
  async getOrder(id: string): Promise<any> {
    const response = await fetch(`/api/v1/admin/orders/${id}`, {
      headers: {
        'Authorization': this.token ? `Bearer ${this.token}` : '',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch order: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Update order status
   */
  async updateOrder(id: string, updates: Record<string, any>): Promise<any> {
    const response = await fetch(`/api/v1/admin/orders/${id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': this.token ? `Bearer ${this.token}` : '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error(`Failed to update order: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Get admin configuration
   */
  async getConfig(): Promise<AdminConfigResponse> {
    const response = await fetch('/api/v1/admin/config', {
      headers: {
        'Authorization': this.token ? `Bearer ${this.token}` : '',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch config: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Get admin metrics
   */
  async getMetrics(): Promise<any> {
    const response = await fetch('/api/v1/admin/metrics', {
      headers: {
        'Authorization': this.token ? `Bearer ${this.token}` : '',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch metrics: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Get admin actions log
   */
  async getActions(): Promise<any> {
    const response = await fetch('/api/v1/admin/actions', {
      headers: {
        'Authorization': this.token ? `Bearer ${this.token}` : '',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch actions: ${response.statusText}`);
    }

    return await response.json();
  }
}

export default AdminServiceClient;
