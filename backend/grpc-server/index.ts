import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { logger } from "./util/logging.js";

// Service implementations (untyped, work with dynamic service defs)
import { IngestServiceImpl as IngestV1, ConversationServiceImpl as ConvV1 } from "./services/worker.js";
import { MetricsServiceImpl as MetricsV1 } from "./services/metrics.js";
import { IngestServiceImpl as IngestV2, ConversationServiceImpl as ConvV2 } from "./services/worker_v2.js";
import { MetricsServiceImpl as MetricsV2 } from "./services/metrics_v2.js";
import { AdminServiceImpl } from "./services/admin.js";
import { SellerServiceImpl } from "./services/seller.js";
import { OrdersServiceImpl } from "./services/orders.js";
import { AIServiceImpl } from "./services/ai.js";

// Health service  
import { HealthImplementation, service as HealthService } from "grpc-health-check";
const ServingStatus = {
  SERVING: "SERVING" as const,
  NOT_SERVING: "NOT_SERVING" as const,
  UNKNOWN: "UNKNOWN" as const,
};

const PORT = process.env.GRPC_PORT || "9000";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");

async function loadProto(paths: string[]) {
  const def = await protoLoader.load(paths, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [
      path.join(ROOT_DIR, "proto"),
      path.join(ROOT_DIR, "node_modules/protobufjs/google"),
      path.join(ROOT_DIR, "node_modules/@grpc/grpc-js/proto"),
    ],
  });
  return grpc.loadPackageDefinition(def) as any;
}

async function main() {
  const server = new grpc.Server({});

  // Load v1 + v2 protos dynamically
  const protos = await loadProto([
    path.join(ROOT_DIR, "proto/worker/v1/worker.proto"),
    path.join(ROOT_DIR, "proto/worker/v2/worker.proto"),
    path.join(ROOT_DIR, "proto/metrics/v1/metrics.proto"),
    path.join(ROOT_DIR, "proto/metrics/v2/metrics.proto"),
    path.join(ROOT_DIR, "proto/admin/v1/admin.proto"),
    path.join(ROOT_DIR, "proto/seller/v1/seller.proto"),
    path.join(ROOT_DIR, "proto/orders/v1/orders.proto"),
    path.join(ROOT_DIR, "proto/ai/v1/ai.proto"),
  ]);

  // Register health
  const healthImpl = new HealthImplementation({
    "": ServingStatus.SERVING,
  });
  healthImpl.addToServer(server);

  // Resolve service defs
  const wv1 = protos.worker?.v1;
  const wv2 = protos.worker?.v2;
  const mv1 = protos.metrics?.v1;
  const mv2 = protos.metrics?.v2;
  const adminV1 = protos.admin?.v1;
  const sellerV1 = protos.seller?.v1;
  const ordersV1 = protos.orders?.v1;
  const aiV1 = protos.ai?.v1;

  if (!wv1 || !wv2 || !mv1 || !mv2 || !adminV1 || !sellerV1 || !ordersV1 || !aiV1) {
    throw new Error("Failed to load protobuf services. Check proto paths.");
  }

  // Add services (names must match RPC names in .proto)
  server.addService(wv1.IngestService.service, IngestV1 as any);
  server.addService(wv1.ConversationService.service, ConvV1 as any);
  server.addService(mv1.MetricsService.service, MetricsV1 as any);

  server.addService(wv2.IngestService.service, IngestV2 as any);
  server.addService(wv2.ConversationService.service, ConvV2 as any);
  server.addService(mv2.MetricsService.service, MetricsV2 as any);
  
  // Add new services
  server.addService(adminV1.AdminService.service, AdminServiceImpl as any);
  server.addService(sellerV1.SellerService.service, SellerServiceImpl as any);
  server.addService(ordersV1.OrdersService.service, OrdersServiceImpl as any);
  server.addService(aiV1.AIService.service, AIServiceImpl as any);

  server.bindAsync(
    `0.0.0.0:${PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err: Error | null, boundPort: number) => {
      if (err) {
        logger.error({ err }, "Failed to bind gRPC server");
        process.exit(1);
      }
      server.start();
      logger.info({ port: boundPort }, "gRPC server (dynamic proto) started");
    }
  );
}

main().catch((err) => {
  logger.error({ err }, "Fatal error starting server");
  process.exit(1);
});
