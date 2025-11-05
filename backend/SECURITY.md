# Backend Security - Authentication Requirements

This document outlines which routes require authentication and which are intentionally public.

## Authentication Enforced Routes

All routes below require JWT authentication via `requireAuth` preHandler:

### AI Routes (all require authentication)
- `/api/v1/ai/generate` - AI content generation
- `/api/v1/ai/code/gen` - Code generation
- `/api/v1/ai/content/brief` - Content brief creation
- `/api/v1/ai/content/meta` - SEO meta extraction
- `/api/v1/ai/seo/enhance` - Prompt enhancement
- `/api/v1/ai/seo/hints` - SEO hints generation
- `/api/v1/ai/chat/send` - Send chat message
- `/api/v1/ai/sessions` - List/manage chat sessions
- `/api/v1/ai/sessions/:id` - Get/delete specific session
- `/api/v1/ai/sessions/:id/messages` - List messages
- `/api/v1/ai/messages/:id` - Message operations

### Editor Routes (all require authentication)
- `GET /api/v1/editor/files` - List files
- `POST /api/v1/editor/files` - Create file
- `GET /api/v1/editor/files/:id` - Get file
- `PUT /api/v1/editor/files/:id` - Update file
- `GET /api/v1/editor/files/:id/versions` - List versions

### Worker Routes (all require authentication)
- `GET /worker/conversation/queue` - Worker queue status
- `POST /worker/conversation/kick` - Trigger worker jobs
- `GET /api/v1/worker/ingest/health` - Ingest worker health
- `GET /api/v1/worker/ingest/warm` - Warm up worker
- `POST /api/v1/worker/ingest/kick` - Trigger ingest
- `POST /api/v1/worker/ingest/upload` - Upload for ingestion

### Seller Routes (all require authentication)
- `/seller/*` - All seller-specific routes
- `/api/v1/seller/*` - Seller API routes

### Order & Product Routes (all require authentication)
- `/api/v1/orders/*` - Order management
- `/api/v1/products/*` - Product management

### Admin Routes (all require authentication)
- `/api/v1/admin/*` - Admin operations

### Snapshot Route (requires authentication)
- `GET /snapshot` - Get seller snapshot

## Public Routes (NO authentication required)

These routes are intentionally public for specific reasons:

### Service Health & Info
- `GET /` - Basic service information
- `GET /info` - Service metadata
- `GET /healthz` - Health check for load balancers
- `HEAD /healthz` - Health check (HEAD)

### Authentication Endpoints
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/register` - User registration
- `POST /api/v1/auth/refresh` - Refresh JWT token
- `POST /api/v1/auth/logout` - User logout

### Webhooks (authenticated via provider-specific methods)
- `GET /webhooks/whatsapp` - WhatsApp webhook verification (uses verify token)
- `POST /webhooks/whatsapp` - WhatsApp incoming messages (verified by WhatsApp)

### Public API Routes (require API key via X-API-Key header)
- `/api/public/*` - Public seller APIs (use API key authentication, not JWT)

## Security Mechanisms

1. **JWT Authentication**: Most routes use `app.requireAuth` preHandler
2. **API Key Authentication**: Public seller routes use `app.requireApiKey`
3. **Webhook Verification**: External webhooks use provider-specific tokens
4. **Row-Level Security**: Database queries filter by authenticated user's seller_id

## Implementation Pattern

```typescript
// Standard pattern for protected routes
declare module 'fastify' {
  interface FastifyInstance {
    requireAuth?: any;
  }
}

export default fp(async function myRoute(app: FastifyInstance) {
  const routeOpts: any = {};
  if (app.requireAuth) {
    routeOpts.preHandler = app.requireAuth;
  }

  app.get('/my-protected-route', routeOpts, async (req, reply) => {
    const userId = (req as any).user?.id;
    // Route logic
  });
});
```

## Security Review Checklist

- [ ] All new routes default to authenticated unless explicitly public
- [ ] Public routes have clear business justification
- [ ] User context accessed via `(req as any).user`
- [ ] Database queries filtered by seller_id/user_id
- [ ] No sensitive data exposed in public endpoints

## Last Updated
October 19, 2025 - Comprehensive authentication enforcement across all routes
