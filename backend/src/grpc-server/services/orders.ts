import { Metadata } from "@grpc/grpc-js";
import { logger } from "../util/logging.js";
import { requireBearer } from "../util/auth.js";
import { ERR } from "../util/errors.js";

function isUuid(s?: string | null): boolean {
  return !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export const OrdersServiceImpl = {
  async GetOrders(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      logger.info({ method: "OrdersService.GetOrders", subject });
      
      const response = {
        body: {
          ok: true,
          orders: [],
          pagination: {
            page: parseInt(params.page || '1', 10),
            limit: parseInt(params.limit || '20', 10),
            total: 0,
            pages: 0,
          },
        },
      };
      
      callback(null, response);
    } catch (e) {
      logger.error({ error: e, method: "OrdersService.GetOrders" });
      callback(e as Error, null);
    }
  },

  async GetOrdersId(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      const orderId = params.id;
      
      if (!orderId || !isUuid(orderId)) {
        throw ERR.invalidArgument("Invalid order ID");
      }
      
      logger.info({ method: "OrdersService.GetOrdersId", subject, orderId });
      
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
      logger.error({ error: e, method: "OrdersService.GetOrdersId" });
      callback(e as Error, null);
    }
  },

  async PostOrdersIdAi(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      const orderId = params.id;
      
      if (!orderId || !isUuid(orderId)) {
        throw ERR.invalidArgument("Invalid order ID");
      }
      
      logger.info({ method: "OrdersService.PostOrdersIdAi", subject, orderId });
      
      const response = {
        body: {
          ok: true,
          suggestions: [],
        },
      };
      
      callback(null, response);
    } catch (e) {
      logger.error({ error: e, method: "OrdersService.PostOrdersIdAi" });
      callback(e as Error, null);
    }
  },

  async PostOrdersIdOutbound(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      const orderId = params.id;
      
      if (!orderId || !isUuid(orderId)) {
        throw ERR.invalidArgument("Invalid order ID");
      }
      
      logger.info({ method: "OrdersService.PostOrdersIdOutbound", subject, orderId });
      
      const response = {
        body: {
          ok: true,
          message: "Outbound message sent",
        },
      };
      
      callback(null, response);
    } catch (e) {
      logger.error({ error: e, method: "OrdersService.PostOrdersIdOutbound" });
      callback(e as Error, null);
    }
  },
};
