import { Metadata } from "@grpc/grpc-js";
import { logger } from "../util/logging.js";
import { requireBearer } from "../util/auth.js";
import { ERR } from "../util/errors.js";

// Import database and shared utilities from main app
// For now, we'll create stub implementations
// In production, you'd import these from your shared modules

function maskPII(input: string): string {
  if (!input) return input;
  let s = input;
  s = s.replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+)\.([A-Za-z]{2,})/g, (_, a, b, c) => `${a}***@${b}.${c}`);
  s = s.replace(/\bhttps?:\/\/[^\s)]+/g, (m) => m.replace(/([^:\/]{3})[^\/]*/g, '$1***'));
  s = s.replace(/\b\d{6,}\b/g, (m) => m.slice(0, 3) + '***' + m.slice(-2));
  return s;
}

function isUuid(s?: string | null): boolean {
  return !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export const AdminServiceImpl = {
  async GetAdminOrders(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      const page = Math.max(1, parseInt(params.page || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(params.limit || '20', 10)));
      
      logger.info({ method: "AdminService.GetAdminOrders", subject, page, limit });
      
      // TODO: Implement actual database query
      // This is a stub implementation
      const response = {
        body: {
          ok: true,
          orders: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0,
          },
        },
      };
      
      callback(null, response);
    } catch (e) {
      logger.error({ error: e, method: "AdminService.GetAdminOrders" });
      callback(e as Error, null);
    }
  },

  async GetAdminOrdersId(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      const orderId = params.id;
      
      if (!orderId || !isUuid(orderId)) {
        throw ERR.invalidArgument("Invalid order ID");
      }
      
      logger.info({ method: "AdminService.GetAdminOrdersId", subject, orderId });
      
      // TODO: Implement actual database query
      const response = {
        body: {
          ok: true,
          order: {
            id: orderId,
            status: "new",
            created_at: new Date().toISOString(),
          },
        },
      };
      
      callback(null, response);
    } catch (e) {
      logger.error({ error: e, method: "AdminService.GetAdminOrdersId" });
      callback(e as Error, null);
    }
  },

  async PatchAdminOrdersId(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      const orderId = params.id;
      const status = params.status;
      const decisionReason = params.decision_reason;
      
      if (!orderId || !isUuid(orderId)) {
        throw ERR.invalidArgument("Invalid order ID");
      }
      
      const allowed = new Set(['new', 'processing', 'completed', 'cancelled', 'refunded']);
      if (!status || !allowed.has(status)) {
        throw ERR.invalidArgument("Invalid status");
      }
      
      logger.info({ method: "AdminService.PatchAdminOrdersId", subject, orderId, status });
      
      // TODO: Implement actual database update
      const response = {
        body: {
          ok: true,
          order: {
            id: orderId,
            status,
            decision_reason: decisionReason ? maskPII(decisionReason) : null,
            updated_at: new Date().toISOString(),
          },
        },
      };
      
      callback(null, response);
    } catch (e) {
      logger.error({ error: e, method: "AdminService.PatchAdminOrdersId" });
      callback(e as Error, null);
    }
  },

  async GetAdminConfig(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      logger.info({ method: "AdminService.GetAdminConfig", subject });
      
      // TODO: Implement actual config fetch
      const response = {
        body: {
          ok: true,
          config: {},
        },
      };
      
      callback(null, response);
    } catch (e) {
      logger.error({ error: e, method: "AdminService.GetAdminConfig" });
      callback(e as Error, null);
    }
  },

  async PutAdminConfigKey(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      const key = params.key;
      const value = params.value;
      
      const allowedKeys = ['google_sheets_url', 'system_settings', 'notification_settings', 'ai_settings'];
      if (!key || value === undefined) {
        throw ERR.invalidArgument("key and value are required");
      }
      if (!allowedKeys.includes(key)) {
        throw ERR.invalidArgument("invalid config key");
      }
      
      logger.info({ method: "AdminService.PutAdminConfigKey", subject, key });
      
      // TODO: Implement actual config update
      const response = {
        body: {
          ok: true,
          message: "Config updated successfully",
        },
      };
      
      callback(null, response);
    } catch (e) {
      logger.error({ error: e, method: "AdminService.PutAdminConfigKey" });
      callback(e as Error, null);
    }
  },

  async GetAdminMetrics(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      const period = params.period || '1h';
      
      logger.info({ method: "AdminService.GetAdminMetrics", subject, period });
      
      // TODO: Implement actual metrics fetch
      const response = {
        body: {
          ok: true,
          metrics: {
            errors: [],
            performance: [],
            period,
          },
        },
      };
      
      callback(null, response);
    } catch (e) {
      logger.error({ error: e, method: "AdminService.GetAdminMetrics" });
      callback(e as Error, null);
    }
  },

  async GetAdminActions(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      const page = Math.max(1, parseInt(params.page || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(params.limit || '20', 10)));
      
      logger.info({ method: "AdminService.GetAdminActions", subject, page, limit });
      
      // TODO: Implement actual actions fetch
      const response = {
        body: {
          ok: true,
          actions: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0,
          },
        },
      };
      
      callback(null, response);
    } catch (e) {
      logger.error({ error: e, method: "AdminService.GetAdminActions" });
      callback(e as Error, null);
    }
  },

  async PostAdminSubscriptionSet(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      
      logger.info({ method: "AdminService.PostAdminSubscriptionSet", subject });
      
      // TODO: Implement actual subscription update
      const response = {
        body: {
          ok: true,
          message: "Subscription updated",
        },
      };
      
      callback(null, response);
    } catch (e) {
      logger.error({ error: e, method: "AdminService.PostAdminSubscriptionSet" });
      callback(e as Error, null);
    }
  },

  async GetAdminSubscriptionState(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      logger.info({ method: "AdminService.GetAdminSubscriptionState", subject });
      
      // TODO: Implement actual subscription state fetch
      const response = {
        body: {
          ok: true,
          subscription: {
            active: true,
            plan: "free",
          },
        },
      };
      
      callback(null, response);
    } catch (e) {
      logger.error({ error: e, method: "AdminService.GetAdminSubscriptionState" });
      callback(e as Error, null);
    }
  },
};
