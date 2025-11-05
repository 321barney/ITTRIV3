// src/db/index.ts — database middleware (ESM-safe)

import knex, { Knex } from 'knex';
import { getDatabaseConfig } from './config.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Singleton handle
let db: Knex | null = null;

/** Build a proper Knex connection object (pg) */
function buildPgConnection(dbUrl: string, ssl?: any) {
  const conn: any = { connectionString: dbUrl };
  if (ssl) conn.ssl = ssl; // <-- SSL must be nested under connection for pg
  return conn;
}

/** Return the shared Knex instance if it has been initialized */
export function getDb(): Knex | null {
  if (db) return db;

  try {
    const dbConfig = getDatabaseConfig();
    console.log('Initializing database connection...');
    console.log('Database URL hostname:', new URL(dbConfig.url).hostname);

    db = knex({
      client: 'pg',
      connection: buildPgConnection(dbConfig.url, dbConfig.ssl),
      pool: dbConfig.pool ?? { min: 0, max: parseInt(process.env.DB_POOL_MAX || '5', 10) },
      migrations: {
        directory: './src/db/migrations',
        extension: 'ts',
      },
      // NOTE: no top-level "ssl" here; it belongs inside "connection"
    });

    console.log('✅ Database connection initialized');
    return db;
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    return null;
  }
}

/** Create a fresh connection (used during initializeDatabase) */
function createDbConnection(): Knex {
  const dbConfig = getDatabaseConfig();

  return knex({
    client: 'pg',
    connection: buildPgConnection(dbConfig.url, dbConfig.ssl),
    pool: {
      min: 0,
      max: parseInt(process.env.DB_POOL_MAX || '5', 10),
    },
    // NOTE: no top-level "ssl" here
  });
}

/** Validate DATABASE_URL and enforce expected host unless overridden */
function verifyDatabaseUrl(dbUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(dbUrl);
  } catch (e) {
    throw new Error(
      `Invalid DATABASE_URL: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const expectedSubstr =
    (process.env.EXPECTED_DB_HOST_SUBSTR &&
      process.env.EXPECTED_DB_HOST_SUBSTR.trim()) ||
    'ep-royal-forest';
  const allowMismatch = (process.env.ALLOW_NON_PROD_DB ?? '0') === '1';

  const host = parsed.hostname;

  if (process.env.DEBUG_DB === '1') {
    console.log('=== Database Configuration Debug ===');
    console.log({
      protocol: parsed.protocol,
      host,
      port: parsed.port || '(default)',
      database: parsed.pathname,
      user: parsed.username,
      hasPassword: Boolean(parsed.password),
      expectedHostContains: expectedSubstr,
    });
  }

  if (!host.includes(expectedSubstr) && !allowMismatch) {
    throw new Error(
      `DATABASE_URL host "${host}" does not include expected substring "${expectedSubstr}". ` +
        `To override, set ALLOW_NON_PROD_DB=1 or adjust EXPECTED_DB_HOST_SUBSTR.`
    );
  }
}

/** Quick connectivity probe */
async function testConnection(database: Knex, logger?: any): Promise<void> {
  try {
    await database.raw('select 1 as ok');
    if (process.env.DEBUG_DB === '1' && logger?.info) {
      logger.info('✅ DB connection test succeeded');
    } else if (process.env.DEBUG_DB === '1') {
      console.log('✅ DB connection test succeeded');
    }
  } catch (err) {
    if (logger?.error) logger.error('❌ DB connection test failed:', err);
    else console.error('❌ DB connection test failed:', err);
    throw err;
  }
}

/** Optional schema sync (tolerant to module presence & export names) */
async function runSchemaSync(database: Knex, logger?: any): Promise<void> {
  const enableSync = (process.env.SCHEMA_SYNC ?? '1') === '1';
  if (!enableSync) {
    if (logger?.info) logger.info('Schema sync skipped (SCHEMA_SYNC=0).');
    else console.log('Schema sync skipped (SCHEMA_SYNC=0).');
    return;
  }

  if (logger?.info) logger.info('Running schema sync…');
  else console.log('Running schema sync…');

  try {
    // ESM requires .js in the specifier; TS may not find this file in dev.
    // @ts-ignore optional module (may not exist at build time)
    const mod = await import('../utils/schemaSync.js').catch(() => null);

    const run =
      (mod && (mod as any).syncSchema) ||
      (mod && (mod as any).schemaSync) ||
      (mod && (mod as any).default) ||
      (mod && (mod as any).run);

    if (typeof run === 'function') {
      await run(database, {
        tighten: (process.env.SCHEMA_TIGHTENING ?? '0') === '1',
        schemaFile: process.env.SCHEMA_FILE,
        logger,
      });
      if (logger?.info) logger.info('Schema sync complete.');
      else console.log('Schema sync complete.');
    } else {
      if (logger?.warn) logger.warn('Schema sync module not found/invalid; skipping.');
      else console.warn('Schema sync module not found/invalid; skipping.');
    }
  } catch (error) {
    if (logger?.warn) logger.warn('Schema sync failed, continuing...', error);
    else console.warn('Schema sync failed, continuing...', error);
  }
}

/** Migrations runner: use ITTRI/backend/src/db/migrations/schema_fresh.sql explicitly */
async function runMigrations(logger?: any): Promise<void> {
  const logI = logger?.info?.bind(logger) ?? console.log;
  const logW = logger?.warn?.bind(logger) ?? console.warn;
  const logE = logger?.error?.bind(logger) ?? console.error;

  try {
    logI('Running migrations…');

    // Prefer your scripted migrator if present (keeps compatibility)
    // @ts-ignore optional module (may not exist at build time)
    const migMod = await import('./scripts/migrate.js').catch(() => null);
    const applyFreshSchema =
      (migMod && (migMod as any).applyFreshSchema) ||
      (migMod && (migMod as any).default);

    if (typeof applyFreshSchema === 'function') {
      await applyFreshSchema();
      logI('Migrations complete.');
      return;
    }

    const repoRoot = process.cwd();
    const sqlPath = path.resolve(
      repoRoot,
      'src',
      'db',
      'migrations',
      'schema_fresh.sql'
    );

    if (fs.existsSync(sqlPath)) {
      logI(`Using schema file: ${sqlPath}`);
      const sql = fs.readFileSync(sqlPath, 'utf8');

      const kx = db;
      if (!kx) throw new Error('DB not initialized before migrations');

      await kx.raw(sql);
      logI('✅ Schema migration completed successfully!');
      logI('Migrations complete.');
      return;
    }

    logW(`Schema file not found at ${sqlPath}. Skipping SQL migration.`);
    logI('Migrations complete.');
  } catch (error: any) {
    logE('Migration failed:', error);
    if ((process.env.NODE_ENV ?? 'development') !== 'production') {
      throw error;
    }
  }
}

/** One-shot full initialization: verify → connect → test → sync → migrate */
export async function initializeDatabase(logger?: any): Promise<Knex> {
  const connection = process.env.DATABASE_URL;
  if (!connection) throw new Error('DATABASE_URL is not set');

  if (logger?.info) logger.info('Initializing database...');
  else console.log('Initializing database...');

  // Step 1: Verify URL and create connection
  verifyDatabaseUrl(connection);
  const database = createDbConnection();

  // Step 2: Test connection
  await testConnection(database, logger);
  if (logger?.info) logger.info('Database connection established');
  else console.log('Database connection established');

  // Make shared
  db = database;

  // Step 3: Schema sync (optional)
  await runSchemaSync(database, logger);

  // Step 4: Migrations (explicit *.sql path)
  await runMigrations(logger);

  return database;
}

/** Simple connectivity probe for external callers */
export async function testDbConnection(database?: Knex): Promise<boolean> {
  const dbInstance = database || getDb();
  if (!dbInstance) throw new Error('Database not configured');

  try {
    await dbInstance.raw('SELECT 1');
    console.log('✅ Database connection test successful');
    return true;
  } catch (error) {
    console.error('❌ Database connection test failed:', error);
    throw error;
  }
}

/** Graceful shutdown */
export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy();
    db = null;
    console.log('Database connection closed');
  }
}
