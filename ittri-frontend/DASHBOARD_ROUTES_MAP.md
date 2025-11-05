# Dashboard Routes Map

Complete mapping of frontend dashboard routes to backend endpoints.

## Architecture

```
Frontend Component
    ↓
/api/dashboard/* (Next.js API Route - Proxy Layer)
    ↓
Backend /api/v1/* (gRPC or REST)
```

## Current Dashboard Routes

### AI & Code Generation

| Frontend Route | Backend Endpoint | Purpose |
|---------------|------------------|---------|
| `POST /api/dashboard/generate` | `/api/v1/ai/code/gen` | Generate HTML/React code |
| `POST /api/dashboard/generate/brief` | `/api/v1/ai/content/brief` | Create content brief |
| `POST /api/dashboard/generate/meta` | `/api/v1/ai/content/meta` | Extract SEO metadata |
| `POST /api/dashboard/generate/prompt/enhance` | `/api/v1/ai/seo/enhance` | Enhance user prompt |
| `POST /api/dashboard/generate/prompt/hint` | `/api/v1/ai/seo/hints` | Generate SEO hints |

### Chat & Sessions

| Frontend Route | Backend Endpoint | Purpose |
|---------------|------------------|---------|
| `GET /api/dashboard/sessions` | `/api/v1/ai/sessions` | List chat sessions |
| `GET /api/dashboard/sessions/:id` | `/api/v1/ai/sessions/:id` | Get session details |
| `DELETE /api/dashboard/sessions/:id` | `/api/v1/ai/sessions/:id` | Delete session |
| `GET /api/dashboard/messages/:sessionId` | `/api/v1/ai/sessions/:sessionId/messages` | Get session messages |
| `POST /api/dashboard/chat/send` | `/api/v1/ai/chat/send` | Send chat message |

### Stores

| Frontend Route | Backend Endpoint | Purpose |
|---------------|------------------|---------|
| `GET /api/dashboard/stores` | `/api/v1/seller/stores` | List user stores |
| `POST /api/dashboard/stores` | `/api/v1/seller/stores` | Create new store |
| `GET /api/dashboard/stores/:id` | `/api/v1/seller/stores/:id` | Get store details |
| `PATCH /api/dashboard/stores/:id` | `/api/v1/seller/stores/:id` | Update store |
| `DELETE /api/dashboard/stores/:id` | `/api/v1/seller/stores/:id` | Delete store |

### Products

| Frontend Route | Backend Endpoint | Purpose |
|---------------|------------------|---------|
| `GET /api/dashboard/product` | `/api/v1/seller/products` | List products |
| `POST /api/dashboard/product` | `/api/v1/seller/products` | Create product |
| `GET /api/dashboard/product/:id` | `/api/v1/seller/products/:id` | Get product |
| `PATCH /api/dashboard/product/:id` | `/api/v1/seller/products/:id` | Update product |

### Orders

| Frontend Route | Backend Endpoint | Purpose |
|---------------|------------------|---------|
| `GET /api/dashboard/orders` | `/api/v1/seller/orders` | List orders |
| `GET /api/dashboard/orders?orderId=:id` | `/api/v1/seller/orders/:id` | Get order details |
| `PATCH /api/dashboard/orders/:id` | `/api/v1/seller/orders/:id` | Update order |

### Metrics & Analytics

| Frontend Route | Backend Endpoint | Purpose |
|---------------|------------------|---------|
| `GET /api/dashboard/metrics` | `/api/v1/seller/metrics` | Get dashboard metrics |
| `GET /api/dashboard/metrics?period=:period` | `/api/v1/seller/metrics?period=:period` | Get period metrics |

### Authentication

| Frontend Route | Backend Endpoint | Purpose |
|---------------|------------------|---------|
| `GET /api/auth/me` | `/api/v1/auth/me` | Get current user |
| `POST /api/auth/register` | `/api/v1/auth/register` | Register new user |
| `POST /api/auth/logout` | `/api/v1/auth/logout` | Logout user |
| `POST /api/auth/refresh` | `/api/v1/auth/refresh` | Refresh token |

## Status Summary

✅ **All routes use correct paths**
✅ **No "dashbaord" typos remaining**
✅ **Proxy layer working correctly**
✅ **Backend v1 API endpoints active**

## Implementation Details

### Frontend Components Using Routes

| Component | Routes Used |
|-----------|-------------|
| `products/page.tsx` | `/api/dashboard/product` |
| `conversations/page.tsx` | `/api/dashboard/orders` |
| `orders/page.tsx` | `/api/dashboard/orders` |
| `analytics/page.tsx` | `/api/dashboard/metrics` |
| `page.tsx` (main dashboard) | `/api/dashboard/metrics` |
| `stores/page.tsx` | `/api/dashboard/stores` |
| `stores/[id]/store-view.tsx` | `/api/dashboard/stores/:id` |

### Hooks Using Routes

| Hook | Routes Used |
|------|-------------|
| `use-codegen.ts` | `/api/dashboard/generate` |
| `use-chat-sessions.ts` | `/api/dashboard` or `/api/v1/ai` |

## Migration to gRPC Client (Optional)

You can now use the new gRPC client instead of direct fetch calls:

### Before (Direct fetch):
```tsx
const res = await fetch('/api/dashboard/orders', {
  credentials: 'include',
});
```

### After (gRPC Client):
```tsx
import { useAdminService } from '@/hooks/use-api-client';

const admin = useAdminService();
const orders = await admin.getOrders({ limit: 20 });
```

## Next Steps

1. ✅ All typos fixed
2. ✅ All routes properly mapped
3. 📝 Optional: Migrate components to use new gRPC client
4. 📝 Optional: Add TypeScript types for all responses
5. 📝 Optional: Implement caching layer

---

**Last Updated**: October 19, 2025
**Status**: All dashboard routes working correctly
