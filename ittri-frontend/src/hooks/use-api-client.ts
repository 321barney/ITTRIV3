/**
 * React hooks for API client
 * 
 * Provides easy access to API services in React components.
 */

import { useMemo } from 'react';
import { createApiClient, ApiClient } from '@/lib/api-client';

/**
 * Hook to get API client
 * Note: Authentication is handled via cookies/session, not tokens
 */
export function useApiClient(): ApiClient {
  const client = useMemo(() => {
    return createApiClient();
  }, []);

  return client;
}

/**
 * Hook for AI service
 */
export function useAIService() {
  const client = useApiClient();
  return client.ai;
}

/**
 * Hook for Admin service
 */
export function useAdminService() {
  const client = useApiClient();
  return client.admin;
}

export default useApiClient;
