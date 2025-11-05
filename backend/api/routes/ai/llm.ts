// src/api/routes/ai/llm.ts
//
// NOTE: This file has been superseded by src/ai/llm.ts and is left here only
// for backward compatibility. All route files should import getClient()
// from '../../../ai/llm' instead of this module. The implementation here
// simply re-exports from the shared LLM module to avoid duplicate logic.

export { getClient, getProviderName, resetLLMClientCache, ensureReady } from '../../../ai/llm';
export * from '../../../ai/types';
