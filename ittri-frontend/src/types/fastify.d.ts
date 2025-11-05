
// backend/src/types/fastify.d.ts
import 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: any;
    requireRole: (roles: Array<'buyer'|'seller'|'admin'>) => any;
    requireApiKey: any;
  }
  interface FastifyRequest {
    apiKey?: { user_id: number; store_id: number };
    user?: { id: string; role: 'buyer'|'seller'|'admin'; tier: string };
  }
}
