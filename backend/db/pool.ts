import { Pool, PoolClient, QueryResult } from "pg";
import { getDatabaseConfig } from "../db/config.js";

const cfg = getDatabaseConfig();

export const pool = new Pool({
  connectionString: cfg.url,
  ssl: cfg.ssl,                   // your config already handles neon.tech etc.
  max: cfg.pool.max || 10,
  idleTimeoutMillis: cfg.pool.idleTimeoutMillis || 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  allowExitOnIdle: false,
});

pool.on("error", (err) => {
  // happens when an idle client errors — don't crash the process
  console.error("[pg] idle client error", err);
});

export const query = <T = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> => pool.query<T>(text, params);

export const withTransaction = async <T>(fn: (c: PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
};
