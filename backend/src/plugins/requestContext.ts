// src/plugins/requestContext.ts
import { FastifyPluginCallback } from 'fastify';
import { getDb } from '../db/index.js';

// JWT validation utilities.  We use jsonwebtoken for verifying
// seller/admin tokens.  Worker tokens are validated against a
// pre-shared key in the environment.  To rotate keys, simply update
// the environment variables JWT_SELLER_SECRET, JWT_ADMIN_SECRET or
// WORKER_KEY.  Ensure dotenv is loaded at app startup.
import jwt from 'jsonwebtoken';
import { config as loadEnv } from 'dotenv';

loadEnv();

export type SessionKind =
  | { kind: 'seller'; sellerId: string; userId: string }
  | { kind: 'admin'; userId: string; actAsSeller?: string }
  | { kind: 'worker'; workerId: string; actAsSeller?: string };

async function verifySellerJwt(token: string): Promise<{ sub: string; seller_id: string }> {
  const secret = process.env.JWT_SELLER_SECRET || process.env.JWT_SECRET || 'change-me-seller';
  try {
    const decoded: any = jwt.verify(token, secret);
    if (!decoded || !decoded.sub || !decoded.seller_id) {
      throw new Error('Missing subject or seller_id');
    }
    return { sub: String(decoded.sub), seller_id: String(decoded.seller_id) };
  } catch (e) {
    // Rethrow with a generic message so we don't leak internals
    throw new Error('Invalid seller token');
  }
}

async function verifyAdminJwt(token: string): Promise<{ sub: string }> {
  const secret = process.env.JWT_ADMIN_SECRET || process.env.JWT_SECRET || 'change-me-admin';
  try {
    const decoded: any = jwt.verify(token, secret);
    if (!decoded || !decoded.sub) throw new Error('Missing subject');
    return { sub: String(decoded.sub) };
  } catch (e) {
    throw new Error('Invalid admin token');
  }
}

async function verifyWorkerToken(key: string): Promise<{ id: string }> {
  // Simple token match against environment variable.  For more complex
  // validation, integrate with your key management system or OAuth.
  const expected = process.env.WORKER_KEY || '';
  if (expected && key && key === expected) {
    return { id: key };
  }
  throw new Error('Invalid worker token');
}

const requestContextPlugin: FastifyPluginCallback = (app, _opts, done) => {
  app.addHook('preHandler', async (req, reply) => {
    const db = getDb();
    const auth = req.headers.authorization || '';
    const workerKey = req.headers['x-worker-key'] as string | undefined;

    let session: SessionKind | null = null;

    if (workerKey) {
      const worker = await verifyWorkerToken(workerKey);
      session = { kind: 'worker', workerId: worker.id, actAsSeller: req.headers['x-seller-id'] as string | undefined };
    } else if (auth.startsWith('Bearer ')) {
      const token = auth.slice(7);
      try {
        const claim = await verifySellerJwt(token);
        session = { kind: 'seller', sellerId: claim.seller_id, userId: claim.sub };
      } catch {
        const claim = await verifyAdminJwt(token);
        const actAs = (req.headers['x-seller-id'] as string | undefined) || undefined;
        session = { kind: 'admin', userId: claim.sub, actAsSeller: actAs };
      }
    }

    // unauthenticated routes may proceed; others can reject in route
    (req as any).session = session;

    const sellerToSet =
      session?.kind === 'seller' ? session.sellerId :
      session?.kind === 'admin'  ? session.actAsSeller :
      session?.kind === 'worker' ? session.actAsSeller : undefined;

    if (sellerToSet) {
      await db.raw('SELECT app.set_current_seller(?::uuid)', [sellerToSet]);
    }

    (req as any).elevateToAdmin = async () => {
      if (session?.kind !== 'admin') throw app.httpErrors.forbidden('Admin only');
      await db.raw('SET ROLE app_admin');
    };
  });

  done();
};

export default requestContextPlugin;
