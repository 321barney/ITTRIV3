import { Metadata } from "@grpc/grpc-js";
import { logger } from "../util/logging.js";
import { requireBearer, getRequestId } from "../util/auth.js";
import { ERR } from "../util/errors.js";

const queue: any[] = [];

export const IngestServiceImpl = {
  async Health(call: any, callback: any) {
    try {
      const rid = getRequestId(call.metadata as Metadata);
      logger.info({ method: "IngestService.Health", rid });
      const resp = { status: "SERVING", version: "v0.1.0" };
      callback(null, resp);
    } catch (e) {
      callback(e as Error, null as any);
    }
  },
  async Warm(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata);
      logger.info({ method: "IngestService.Warm", subject });
      callback(null, {});
    } catch (e) {
      callback(e as Error, null as any);
    }
  },
  async KickIngest(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata);
      const req = call.request;
      if (!req.label) throw ERR.invalidArgument("label is required");
      const jobId = `job_${Date.now()}`;
      queue.push({ id: jobId, label: req.label, enqueued_at: Date.now() });
      logger.info({ method: "IngestService.KickIngest", subject, jobId, label: req.label });
      callback(null, { accepted: true, job_id: jobId });
    } catch (e) {
      callback(e as Error, null as any);
    }
  },
  async Upload(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata);
      let fileName = "";
      let size = 0;
      await new Promise<void>((resolve, reject) => {
        call.on("data", (chunk: any) => {
          fileName = chunk.file_name || fileName;
          size += chunk.data?.length || 0;
        });
        call.on("end", () => resolve());
        call.on("error", (err: any) => reject(err));
      });
      logger.info({ method: "IngestService.Upload", subject, fileName, size });
      callback(null, { file_name: fileName || "unnamed", job_id: `upload_${Date.now()}` });
    } catch (e) {
      callback(e as Error, null as any);
    }
  },
};

export const ConversationServiceImpl = {
  async Queue(call: any, callback: any) {
    try {
      callback(null, { items: queue.slice(-10) });
    } catch (e) {
      callback(e as Error, null as any);
    }
  },
  async Kick(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata);
      const req = call.request;
      if (!req.label) throw ERR.invalidArgument("label is required");
      logger.info({ method: "ConversationService.Kick", subject, label: req.label });
      callback(null, { accepted: true });
    } catch (e) {
      callback(e as Error, null as any);
    }
  },
};
