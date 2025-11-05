// src/db/config.ts
import { config } from "dotenv";
config();

/** Centralized DB config shape used by runtime and migrations. */
export interface DatabaseConfig {
  url: string;
  ssl: boolean | { rejectUnauthorized: boolean };
  pool: {
    min: number;
    max: number;
    acquireTimeoutMillis: number;
    createTimeoutMillis: number;
    destroyTimeoutMillis: number;
    idleTimeoutMillis: number;
    reapIntervalMillis: number;
    createRetryIntervalMillis: number;
  };
}

/* ----------------------------- helpers ----------------------------- */

const toInt = (v: string | undefined, def: number) =>
  Number.isFinite(parseInt(String(v ?? ""))) ? parseInt(String(v!)) : def;

const toBool = (v: string | undefined, def = false) => {
  if (v == null) return def;
  const s = v.trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(s)
    ? true
    : ["0", "false", "no", "n", "off"].includes(s)
    ? false
    : def;
};

/** Decide whether SSL is required and how strict it should be. */
function resolveSSL(url: string): boolean | { rejectUnauthorized: boolean } {
  // explicit env override wins
  const envForce = process.env.DB_SSL?.trim().toLowerCase();
  if (envForce === "require" || envForce === "true" || envForce === "1") {
    return { rejectUnauthorized: false };
  }
  if (envForce === "disable" || envForce === "false" || envForce === "0") {
    return false;
  }

  // url params (sslmode=require|verify-ca|verify-full)
  const hasSslParam =
    /[?&]sslmode=(require|verify-ca|verify-full)\b/i.test(url) ||
    /[?&]ssl=true\b/i.test(url);

  // common hosted DBs that need SSL
  const hostNeedsSSL =
    /neon\.tech|heroku\.com|render\.com|supabase\.co|amazonaws\.com|azure\.com|googleapis\.com/i.test(
      url
    );

  if (hasSslParam || hostNeedsSSL) {
    // default to relaxed CA (works in most managed envs)
    return { rejectUnauthorized: false };
  }
  return false;
}

/** Build the pool section from env with safe defaults. */
function poolBlock() {
  return {
    min: toInt(process.env.DB_POOL_MIN, 0),
    max: toInt(process.env.DB_POOL_MAX, 10),
    acquireTimeoutMillis: toInt(process.env.DB_ACQUIRE_TIMEOUT_MS, 30000),
    createTimeoutMillis: toInt(process.env.DB_CREATE_TIMEOUT_MS, 30000),
    destroyTimeoutMillis: toInt(process.env.DB_DESTROY_TIMEOUT_MS, 5000),
    idleTimeoutMillis: toInt(process.env.DB_IDLE_TIMEOUT_MS, 30000),
    reapIntervalMillis: toInt(process.env.DB_REAP_INTERVAL_MS, 1000),
    createRetryIntervalMillis: toInt(process.env.DB_CREATE_RETRY_INTERVAL_MS, 100),
  };
}

/** Ensure we have a usable URL. */
function requireUrl(...candidates: Array<string | undefined>): string {
  const url = candidates.find(Boolean)?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL (or NEON_DATABASE_URL) is required. Optionally set DATABASE_OWNER_URL/DB_MIGRATOR_URL for migrations."
    );
  }
  return url;
}

/* ----------------------------- exports ----------------------------- */

/**
 * Runtime connection (what most of the app should use).
 * Picks DATABASE_URL, falling back to NEON_DATABASE_URL.
 */
export const getDatabaseConfig = (): DatabaseConfig => {
  const runtimeUrl = requireUrl(process.env.DATABASE_URL, process.env.NEON_DATABASE_URL);
  return {
    url: runtimeUrl,
    ssl: resolveSSL(runtimeUrl),
    pool: poolBlock(),
  };
};

/**
 * Migration/owner connection (for schema changes).
 * Uses DATABASE_OWNER_URL or DB_MIGRATOR_URL if set, else falls back to the runtime URL.
 * This lets you run migrations with a higher-privileged role while the app uses a safer role.
 */
export const getMigrationDatabaseConfig = (): DatabaseConfig => {
  const ownerUrl = requireUrl(
    process.env.DATABASE_OWNER_URL,
    process.env.DB_MIGRATOR_URL,
    process.env.DATABASE_URL,
    process.env.NEON_DATABASE_URL
  );

  // Migrations often run a lot of DDL; give them a slightly bigger pool unless overridden.
  const pool = poolBlock();
  if (process.env.DB_POOL_MAX == null) pool.max = 15;

  return {
    url: ownerUrl,
    ssl: resolveSSL(ownerUrl),
    pool,
  };
};

/**
 * Convenience: expose the two URLs (useful for diagnostics).
 */
export const DB_URLS = {
  runtime: process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "",
  owner:
    process.env.DATABASE_OWNER_URL ??
    process.env.DB_MIGRATOR_URL ??
    process.env.DATABASE_URL ??
    process.env.NEON_DATABASE_URL ??
    "",
};

/**
 * Optional flag you can use elsewhere to tweak behavior (e.g., statement_timeout).
 */
export const IS_NEON =
  /neon\.tech/i.test(DB_URLS.runtime) || /neon\.tech/i.test(DB_URLS.owner);

/**
 * Optional: allow forcing the migration path to use the owner URL without touching callers.
 * If you set USE_OWNER_FOR_MIGRATIONS=1, code that (still) imports getDatabaseConfig()
 * in the migration script can flip to the owner DSN automatically.
 */
export const getDatabaseConfigForMigrationsMaybeOwner = (): DatabaseConfig => {
  return toBool(process.env.USE_OWNER_FOR_MIGRATIONS, false)
    ? getMigrationDatabaseConfig()
    : getDatabaseConfig();
};
