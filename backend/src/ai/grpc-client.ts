// AI gRPC Client - calls gRPC AI service with fallback to legacy implementation
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");

// Environment configuration
const GRPC_HOST = process.env.GRPC_HOST || "0.0.0.0";
const GRPC_PORT = process.env.GRPC_PORT || "9000";
const GRPC_DEADLINE_MS = parseInt(process.env.GRPC_DEADLINE_MS || "30000", 10);
const GRPC_ENABLED = process.env.GRPC_ENABLED !== "false";

let aiServiceClient: any = null;
let grpcAvailable = false;

// Initialize gRPC client
async function initClient() {
  if (!GRPC_ENABLED) {
    console.log("[grpc-client] gRPC disabled via GRPC_ENABLED=false");
    return null;
  }

  try {
    const protoPath = path.join(ROOT_DIR, "proto/ai/v1/ai.proto");
    const packageDef = await protoLoader.load(protoPath, {
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

    const proto = grpc.loadPackageDefinition(packageDef) as any;
    const AIService = proto.ai?.v1?.AIService;

    if (!AIService) {
      console.error("[grpc-client] Failed to load AIService from proto");
      return null;
    }

    const client = new AIService(
      `${GRPC_HOST}:${GRPC_PORT}`,
      grpc.credentials.createInsecure()
    );

    // Test connection
    await new Promise((resolve, reject) => {
      const deadline = new Date(Date.now() + 5000);
      client.waitForReady(deadline, (err: Error | undefined) => {
        if (err) reject(err);
        else resolve(true);
      });
    });

    grpcAvailable = true;
    console.log(`[grpc-client] Connected to AI service at ${GRPC_HOST}:${GRPC_PORT}`);
    return client;
  } catch (err: any) {
    console.error(`[grpc-client] Failed to initialize: ${err.message}`);
    grpcAvailable = false;
    return null;
  }
}

// Get or initialize client
async function getClient() {
  if (!aiServiceClient && GRPC_ENABLED) {
    aiServiceClient = await initClient();
  }
  return aiServiceClient;
}

// Call gRPC method with deadline and error handling
async function callGrpc<T = any>(
  methodName: string,
  params: any,
  metadata?: grpc.Metadata
): Promise<T | null> {
  const client = await getClient();
  
  if (!client) {
    return null; // Signal to use fallback
  }

  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);
    const meta = metadata || new grpc.Metadata();
    
    const request = { body: params };

    client[methodName](
      request,
      meta,
      { deadline },
      (err: grpc.ServiceError | null, response: any) => {
        if (err) {
          // Log error and return null to trigger fallback
          console.error(`[grpc-client] ${methodName} error:`, {
            code: err.code,
            message: err.message,
            details: err.details,
          });
          
          // Mark as unavailable if connection issues
          if (
            err.code === grpc.status.UNAVAILABLE ||
            err.code === grpc.status.DEADLINE_EXCEEDED ||
            err.code === grpc.status.UNIMPLEMENTED
          ) {
            grpcAvailable = false;
          }
          
          resolve(null); // Return null to trigger fallback
        } else {
          grpcAvailable = true;
          resolve(response?.body || response);
        }
      }
    );
  });
}

// AI Service Methods

/**
 * Generate content using AI (code, landing pages, etc.)
 */
export async function generateViaGrpc(params: {
  prompt: string;
  seed?: string;
  input?: string;
  model?: string;
  stream?: boolean;
  format?: string;
  sections?: string[];
  brand?: any;
  options?: any;
}, authToken?: string): Promise<any> {
  const meta = new grpc.Metadata();
  if (authToken) {
    meta.set("authorization", authToken);
  }
  
  return await callGrpc("GenerateCode", params, meta);
}

/**
 * Create content brief
 */
export async function createBriefViaGrpc(params: {
  topic: string;
  audience?: string;
  tone?: string;
}, authToken?: string): Promise<any> {
  const meta = new grpc.Metadata();
  if (authToken) {
    meta.set("authorization", authToken);
  }
  
  return await callGrpc("CreateBrief", params, meta);
}

/**
 * Extract SEO meta
 */
export async function extractMetaViaGrpc(params: {
  content: string;
}, authToken?: string): Promise<any> {
  const meta = new grpc.Metadata();
  if (authToken) {
    meta.set("authorization", authToken);
  }
  
  return await callGrpc("ExtractMeta", params, meta);
}

/**
 * Enhance SEO prompt
 */
export async function enhancePromptViaGrpc(params: {
  prompt: string;
}, authToken?: string): Promise<any> {
  const meta = new grpc.Metadata();
  if (authToken) {
    meta.set("authorization", authToken);
  }
  
  return await callGrpc("EnhancePrompt", params, meta);
}

/**
 * Generate SEO hints
 */
export async function generateHintsViaGrpc(params: {
  topic: string;
  keywords?: string[];
}, authToken?: string): Promise<any> {
  const meta = new grpc.Metadata();
  if (authToken) {
    meta.set("authorization", authToken);
  }
  
  return await callGrpc("GenerateHints", params, meta);
}

/**
 * Send chat message
 */
export async function sendChatViaGrpc(params: {
  sessionId?: string;
  storeId?: string;
  message: string;
  updateNeed?: string;
  stream?: boolean;
}, authToken?: string): Promise<any> {
  const meta = new grpc.Metadata();
  if (authToken) {
    meta.set("authorization", authToken);
  }
  
  return await callGrpc("SendChatMessage", params, meta);
}

/**
 * List chat sessions
 */
export async function listSessionsViaGrpc(authToken?: string): Promise<any> {
  const meta = new grpc.Metadata();
  if (authToken) {
    meta.set("authorization", authToken);
  }
  
  return await callGrpc("ListSessions", {}, meta);
}

/**
 * Check if gRPC is available
 */
export function isGrpcAvailable(): boolean {
  return grpcAvailable;
}

/**
 * Get health status
 */
export function getGrpcStatus() {
  return {
    enabled: GRPC_ENABLED,
    available: grpcAvailable,
    host: GRPC_HOST,
    port: GRPC_PORT,
  };
}
