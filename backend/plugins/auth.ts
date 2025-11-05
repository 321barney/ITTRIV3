
// backend/src/plugins/auth.ts
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';

type Role = 'buyer' | 'seller' | 'admin';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; role: Role; tier: string };
  }
}

export default fp(async function authPlugin(app: FastifyInstance) {
  const JWT_SECRET = process.env.JWT_SECRET || 'dev';

  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) return reply.code(401).send({ ok: false, error: 'missing_bearer' });
    try {
      const token = auth.replace('Bearer ', '');
      const payload = jwt.verify(token, JWT_SECRET) as any;
      req.user = { id: payload.sub, role: payload.role, tier: payload.tier };
    } catch {
      return reply.code(401).send({ ok: false, error: 'invalid_token' });
    }
  });

  app.decorate('requireRole', (roles: string | string[]) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.user) return reply.code(401).send({ ok: false, error: 'unauthenticated' });
      if (!roles.includes(req.user.role as Role)) return reply.code(403).send({ ok: false, error: 'forbidden' });
    };
  });
});
