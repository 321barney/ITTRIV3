import { ServerWritableStream } from "@grpc/grpc-js";
import { logger } from "../util/logging.js";

export const MetricsServiceImpl = {
  async GetOverview(call: any, callback: any) {
    try {
      const req = call.request;
      const now = Date.now();
      const resp = {
        kpis: [
          { name: "orders", value: 123 },
          { name: "revenue", value: 4567.89 },
          { name: "conversion_rate", value: 2.34 },
        ],
        from_ts: now - 7 * 24 * 3600 * 1000,
        to_ts: now,
      };
      logger.info({ method: "MetricsService.GetOverview.v2", period: req.period || "7d" });
      callback(null, resp);
    } catch (e) {
      callback(e as Error, null as any);
    }
  },
  async StreamDashboard(call: ServerWritableStream<any, any>) {
    const req = call.request;
    logger.info({
      method: "MetricsService.StreamDashboard.v2",
      seller: req.seller_id,
      period: req.period,
    });
    let i = 0;
    const interval = setInterval(() => {
      const update = {
        tile: "orders",
        payload: Buffer.from(JSON.stringify({ value: ++i })),
      };
      call.write(update);
      if (i >= 5) {
        clearInterval(interval);
        call.end();
      }
    }, 500);
    call.on("cancelled", () => {
      clearInterval(interval);
    });
  },
};
