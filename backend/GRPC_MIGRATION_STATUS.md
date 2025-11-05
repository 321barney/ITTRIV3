# gRPC Migration Status

## ✅ Completed

### Backend
1. **gRPC Server Setup** - Running on port 9000
   - Dynamic proto loading with `@grpc/proto-loader`
   - Health check service integrated
   - Fixed TypeScript configuration and module resolution
   
2. **Service Implementations**
   - ✅ Worker v1 & v2 (IngestService, ConversationService)
   - ✅ Metrics v1 & v2 (MetricsService)
   - ✅ Admin Service (8 RPC methods implemented as stubs)
   - ✅ Seller Service (14 RPC methods implemented as stubs)
   - ✅ Orders Service (4 RPC methods implemented as stubs)
   
3. **Dependencies Installed**
   - `@grpc/grpc-js` - gRPC runtime for Node.js
   - `@grpc/proto-loader` - Dynamic proto loading
   - `grpc-health-check` - Health check service
   - `ts-proto` - TypeScript code generation from protos
   - Frontend: `grpc-web`, `google-protobuf`, `@improbable-eng/grpc-web`

4. **Proto Files**
   - All proto files using `google.protobuf.Struct` for flexible JSON payloads
   - HTTP annotations for Envoy transcoding
   - Google API proto dependencies copied to `proto/google/`

## 🚧 Next Steps

### Frontend Setup

1. **Generate TypeScript Client Code**
   ```bash
   cd ITTRI/backend
   # Option 1: Use protoc with grpc-web plugin (requires protoc binary)
   npm run generate:clients
   
   # Option 2: Use grpc-web without protoc
   # The frontend can use Envoy JSON transcoding and continue using fetch API
   ```

2. **Create gRPC-Web Client Wrapper**
   - Create `ittri-frontend/src/lib/grpc-client.ts`
   - Wrapper for admin, seller, orders services
   - Handle authentication (Bearer tokens via metadata)
   
3. **Envoy Proxy Setup**
   - Update `backend/envoy/envoy.yaml` for grpc-web support
   - Add HTTP/1.1 to HTTP/2 translation
   - Add gRPC-Web filter for browser compatibility
   
4. **Update Frontend API Calls**
   - Migrate from `fetch` to gRPC-Web clients
   - Or continue using HTTP through Envoy JSON transcoding
   - Update authentication headers

### Production Database Integration

The current service implementations are **stubs**. To make them functional:

1. Import database connection from `src/db/pool.ts`
2. Replace stub responses with actual database queries
3. Implement authentication/authorization checks
4. Add proper error handling

**Example for AdminService.GetAdminOrders**:
```typescript
import { db } from "../../db/pool.js";

async GetAdminOrders(call: any, callback: any) {
  try {
    const subject = requireBearer(call.metadata as Metadata);
    const params = call.request?.body || {};
    
    // Use the database connection
    const result = await db.transaction(async (trx) => {
      const orders = await trx.withSchema('app')('orders')
        .select('*')
        .limit(parseInt(params.limit || '20'));
      
      return { ok: true, orders };
    });
    
    callback(null, { body: result });
  } catch (e) {
    callback(e as Error, null);
  }
}
```

### Envoy Configuration

Current `backend/envoy/envoy.yaml` needs:

1. **gRPC-Web Filter** for browser support
2. **CORS Configuration** for frontend requests
3. **JSON Transcoding** configuration (already partially set up)
4. **Health Check** routing

### Workflow Configuration

- ✅ gRPC Server workflow created (port 9000)
- ⚠️ Backend API workflow needs fixing (Python path issue)
- ⚠️ Frontend workflow needs fixing (wrong directory path)

## Testing the gRPC Server

```bash
# Test with grpcurl (if installed)
grpcurl -plaintext localhost:9000 list

# Test health check
grpcurl -plaintext localhost:9000 grpc.health.v1.Health/Check

# Test a service method
grpcurl -plaintext \
  -H "Authorization: Bearer test-token" \
  localhost:9000 \
  admin.v1.AdminService/GetAdminConfig
```

## Architecture Notes

- **Hybrid Approach**: The system can support both pure gRPC clients and HTTP/JSON through Envoy transcoding
- **Authentication**: Uses Bearer tokens passed via gRPC metadata
- **Error Handling**: gRPC status codes mapped to HTTP status codes via Envoy
- **Versioning**: Supports v1 and v2 services for backwards compatibility

## Files Modified

### Backend
- `src/grpc-server/index.ts` - Main gRPC server
- `src/grpc-server/services/*.ts` - Service implementations
- `tsconfig.json` - Fixed module resolution
- `proto/google/` - Added Google API proto dependencies

### Frontend
- `package.json` - Added grpc-web dependencies

## Known Issues

1. Some existing TypeScript errors in `src/api/routes/` (pre-existing)
2. Proto client generation needs protoc binary (can use alternative methods)
3. Envoy configuration not yet tested with gRPC-Web clients
