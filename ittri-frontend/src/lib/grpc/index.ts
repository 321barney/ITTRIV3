/**
 * gRPC Services Index
 * 
 * Central export point for all gRPC service clients.
 * These clients use HTTP/JSON via Envoy transcoding for browser compatibility.
 */

export { GrpcClient, createGrpcClient, createMetadata } from './client';
export type { GrpcMetadata, GrpcCallOptions } from './client';

export { AdminServiceClient } from './services/admin';
export { AIServiceClient } from './services/ai';

// Re-export types
export type {
  AdminOrder,
  AdminOrdersResponse,
  AdminConfigResponse,
} from './services/admin';

export type {
  CodegenRequest,
  CodegenResponse,
  ChatMessage,
  ChatResponse,
} from './services/ai';

/**
 * Create service clients with authentication
 */
export function createServiceClients(token?: string) {
  return {
    admin: new AdminServiceClient(token),
    ai: new AIServiceClient(token),
  };
}

export default createServiceClients;
