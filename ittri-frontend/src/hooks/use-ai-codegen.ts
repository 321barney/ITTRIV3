/**
 * AI Code Generation Hook
 * 
 * Simplified hook using the unified API client.
 * Compatible with the existing useCodegen hook but cleaner.
 */

import { useState, useCallback } from 'react';
import { useAIService } from './use-api-client';
import type { CodegenRequest, CodegenResponse } from '@/lib/grpc';

export interface UseAICodegenResult {
  loading: boolean;
  error: string | null;
  generate: (request: CodegenRequest) => Promise<CodegenResponse | null>;
}

/**
 * Hook for AI code generation
 */
export function useAICodegen(): UseAICodegenResult {
  const aiService = useAIService();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (request: CodegenRequest): Promise<CodegenResponse | null> => {
    setLoading(true);
    setError(null);

    try {
      const response = await aiService.generateCode(request);
      return response;
    } catch (err: any) {
      const errorMessage = err?.message || 'Code generation failed';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, [aiService]);

  return { loading, error, generate };
}

export default useAICodegen;
