# Frontend API Client Guide

Complete guide for using the unified API client in the ITTRI frontend.

## Overview

The frontend now has a **unified API client** that provides:
- ✅ Simple, typed interfaces for all backend services
- ✅ gRPC support via HTTP/JSON transcoding (Envoy)
- ✅ React hooks for easy integration
- ✅ Authentication handled automatically via cookies
- ✅ Consistent error handling

## Quick Start

### 1. Using React Hooks (Recommended)

```tsx
import { useAIService, useAdminService } from '@/hooks/use-api-client';

function MyComponent() {
  const ai = useAIService();
  const admin = useAdminService();

  const handleGenerate = async () => {
    const result = await ai.generateCode({
      prompt: 'Create a landing page for a coffee shop',
      format: 'react',
    });
    console.log(result);
  };

  const fetchOrders = async () => {
    const orders = await admin.getOrders({ limit: 10 });
    console.log(orders);
  };

  return (
    <div>
      <button onClick={handleGenerate}>Generate Code</button>
      <button onClick={fetchOrders}>Get Orders</button>
    </div>
  );
}
```

### 2. Using the API Client Directly

```typescript
import { apiClient } from '@/lib/api-client';

// AI Services
const codeResult = await apiClient.ai.generateCode({
  prompt: 'Create a modern homepage',
  format: 'html',
});

const chatResult = await apiClient.ai.sendChatMessage({
  message: 'Help me write product descriptions',
  sessionId: 'session-123',
});

// Admin Services
const orders = await apiClient.admin.getOrders({ page: 1, limit: 20 });
const order = await apiClient.admin.getOrder('order-id');
const metrics = await apiClient.admin.getMetrics();

// Generic requests
const data = await apiClient.get('/custom/endpoint');
const result = await apiClient.post('/custom/endpoint', { data: 'value' });
```

## Available Services

### AI Service (`ai`)

All endpoints are available at `/api/v1/ai/*`:

#### Code Generation
```typescript
const result = await ai.generateCode({
  prompt: string;              // What to build
  format?: 'html' | 'react';   // Output format (default: html)
  sections?: string[];         // Page sections to include
  brand?: {                    // Brand information
    name?: string;
    primaryColor?: string;
    font?: string;
    logoUrl?: string;
  };
  stream?: boolean;            // Enable streaming
  options?: {
    temperature?: number;
    max_tokens?: number;
  };
});
```

#### Content Creation
```typescript
// Create a content brief
await ai.createBrief({
  topic: 'Best coffee brewing methods',
  audience: 'Coffee enthusiasts',
  tone: 'friendly',
  include_outline: true,
});

// Extract SEO metadata from URL
await ai.extractMeta({
  url: 'https://example.com',
});
```

#### SEO Tools
```typescript
// Enhance a prompt
await ai.enhancePrompt({
  brief: 'Write about coffee',
  tone: 'professional',
  audience: 'Business owners',
  goals: ['educate', 'convert'],
});

// Generate SEO hints
await ai.generateHints({
  topic: 'Coffee shop marketing',
  style: 'concise',
  include_keywords: ['coffee', 'local'],
});
```

#### Chat System
```typescript
// Send message
const response = await ai.sendChatMessage({
  message: 'Help me optimize my product page',
  sessionId: 'optional-session-id',
});

// List all sessions
const sessions = await ai.listSessions();

// Get specific session
const session = await ai.getSession('session-id');

// Delete session
await ai.deleteSession('session-id');

// List messages in session
const messages = await ai.listMessages('session-id');
```

### Admin Service (`admin`)

All endpoints are available at `/api/v1/admin/*`:

```typescript
// Get orders with filters
const orders = await admin.getOrders({
  page: 1,
  limit: 20,
  store_id: 'store-123',
  status: 'pending',
  seller_id: 'seller-456',
});

// Get specific order
const order = await admin.getOrder('order-id');

// Update order
await admin.updateOrder('order-id', {
  status: 'completed',
  notes: 'Shipped via FedEx',
});

// Get configuration
const config = await admin.getConfig();

// Get metrics
const metrics = await admin.getMetrics();

// Get admin actions log
const actions = await admin.getActions();
```

## Custom Hooks

### useAICodegen

Simplified code generation with loading states:

```tsx
import { useAICodegen } from '@/hooks/use-ai-codegen';

function CodeGenerator() {
  const { loading, error, generate } = useAICodegen();

  const handleGenerate = async () => {
    const result = await generate({
      prompt: 'Create a pricing page',
      format: 'react',
    });
    
    if (result) {
      console.log('Generated:', result);
    }
  };

  return (
    <div>
      <button onClick={handleGenerate} disabled={loading}>
        {loading ? 'Generating...' : 'Generate'}
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
```

## Architecture

### HTTP/JSON via Envoy

The frontend uses **HTTP/JSON transcoding** through Envoy proxy instead of pure gRPC-Web. This means:

- ✅ No complex gRPC-Web dependencies needed
- ✅ Works with standard `fetch` API
- ✅ Compatible with existing API infrastructure
- ✅ Easy debugging in browser DevTools
- ✅ Automatic JSON serialization

### Request Flow

```
Frontend Component
    ↓
React Hook (useAIService, useAdminService)
    ↓
API Client (apiClient.ai, apiClient.admin)
    ↓
fetch() with credentials
    ↓
Next.js API Routes (optional proxy)
    ↓
Envoy Proxy (HTTP/JSON ↔ gRPC transcoding)
    ↓
Backend gRPC Server (port 9000)
```

### Authentication

Authentication is handled automatically via **session cookies**. No need to manually pass tokens:

```typescript
// Authentication is automatic!
const result = await api.ai.generateCode({ prompt: 'Hello' });
```

The `credentials: 'include'` option is set automatically in all requests.

## Error Handling

All API methods throw errors that can be caught:

```typescript
try {
  const result = await ai.generateCode({ prompt: 'Test' });
} catch (error) {
  console.error('API error:', error.message);
  // Handle error (show notification, etc.)
}
```

## File Structure

```
src/
├── lib/
│   ├── grpc/
│   │   ├── client.ts           # Core gRPC client
│   │   ├── index.ts            # Main exports
│   │   └── services/
│   │       ├── admin.ts        # Admin service client
│   │       └── ai.ts           # AI service client
│   └── api-client.ts           # Unified API client
├── hooks/
│   ├── use-api-client.ts       # React hooks for API
│   └── use-ai-codegen.ts       # AI code generation hook
```

## Migration from Old Code

### Before (Old useCodegen hook):
```tsx
import { useCodegen } from '@/hooks/use-codegen';

const { loading, error, generate } = useCodegen();
const result = await generate({
  prompt: 'Create a page',
  format: 'html',
});
```

### After (New API client):
```tsx
import { useAICodegen } from '@/hooks/use-ai-codegen';

const { loading, error, generate } = useAICodegen();
const result = await generate({
  prompt: 'Create a page',
  format: 'html',
});
```

Both work the same way! The new version is cleaner and more maintainable.

## Next Steps

1. Replace old API calls with the new unified client
2. Use TypeScript types for better IDE support
3. Add more services as needed (Seller, Orders, etc.)
4. Implement streaming support for long-running operations

## Support

For issues or questions, check:
- Backend gRPC services: `backend/src/grpc-server/services/`
- Proto definitions: `backend/proto/`
- Envoy configuration: `backend/envoy/envoy.yaml`
