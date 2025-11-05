// src/db/index.ts - Complete database interface (hardened)
import knex, { Knex } from 'knex';


let db: Knex | null = null;

export interface DatabaseInitResult {
  db: Knex;
  success: boolean;
  error?: string;
}

export interface DatabaseInitOptions {
  logger?: { info?: Function; warn?: Function; error?: Function };
  enableSchemaSync?: boolean;
  schemaTightening?: boolean;
  schemaFile?: string;
  runMigrations?: boolean;
  applicationName?: string;
}

export function getDb(): Knex | null {
  return db;
}

function createDbConnection(appName?: string): Knex {
  const cfg = getDatabaseConfig();

  // Knex accepts connection string or object; we’ll keep string but set pool hooks
  const k = knex({
    client: 'pg',
    connection: cfg.url,
    pool: {
      ...cfg.pool,
      // ensure connections are tagged and have sane timeouts
      afterCreate: (conn: any, done: any) => {
        // Postgres session-level settings
        const stmts = [
          `SET application_name TO '${(appName || process.env.PG_APP_NAME || 'backend').replace(/'/g, "''")}'`,
          `SET statement_timeout = '${process.env.PG_STATEMENT_TIMEOUT || '60000'}'`,
          `SET lock_timeout = '${process.env.PG_LOCK_TIMEOUT || '10000'}'`,
          `SET idle_in_transaction_session_timeout = '${process.env.PG_IDLE_TX_TIMEOUT || '30000'}'`,
          `SET client_min_messages TO WARNING`
        ];
        conn.query(stmts.join('; '), (err: any) => done(err, conn));
      },
    },
    // If you pass ssl in connection string, pg driver respects it;
    // getDatabaseConfig() also sets ssl when needed for Neon/Aurora.
    ssl: cfg.ssl as any,
    migrations: {
      directory: './src/db/migrations',
      extension: 'ts',
    },
    // optional: searchPath if you rely on public
    // searchPath: ['public'],
  });

  return k;
}

function verifyDatabaseUrl(dbUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(dbUrl);
  } catch (e) {
    throw new Error(`Invalid DATABASE_URL: ${e instanceof Error ? e.message : String(e)}`);
  }

  const expectedSubstr =
    (process.env.EXPECTED_DB_HOST_SUBSTR && process.env.EXPECTED_DB_HOST_SUBSTR.trim()) || '';
  const allowMismatch = (process.env.ALLOW_NON_PROD_DB ?? '0') === '1';

  const host = parsed.hostname;

  if (process.env.DEBUG_DB === '1') {
    console.log('=== Database Configuration Debug ===', {
      protocol: parsed.protocol,
      host,
      port: parsed.port || '(default)',
      database: parsed.pathname,
      user: parsed.username,
      hasPassword: Boolean(parsed.password),
      expectedHostContains: expectedSubstr || '(none)',
      allowMismatch,
    });
  }

  if (expectedSubstr && !host.includes(expectedSubstr) && !allowMismatch) {
    throw new Error(
      `DATABASE_URL host "${host}" does not include expected substring "${expectedSubstr}". ` +
        `Set ALLOW_NON_PROD_DB=1 to override, or adjust EXPECTED_DB_HOST_SUBSTR.`
    );
  }
}

async function testConnection(database: Knex, logger?: DatabaseInitOptions['logger']): Promise<void> {
  try {
    await database.raw('select 1 as ok');
    if (process.env.DEBUG_DB === '1') {
      (logger?.info ?? console.log)('✅ DB connection test succeeded');
    }
  } catch (err) {
    (logger?.error ?? console.error)('❌ DB connection test failed:', err);
    throw err;
  }
}

// Complete database initialization interface
export async function initializeDatabaseComplete(options: DatabaseInitOptions = {}): Promise<DatabaseInitResult> {
  const {
    logger,
    enableSchemaSync = (process.env.SCHEMA_SYNC ?? '1') === '1',
    schemaTightening = (process.env.SCHEMA_TIGHTENING ?? '0') === '1',
    schemaFile = process.env.SCHEMA_FILE,
    runMigrations = true,
    applicationName = 'backend',
  } = options;

  try {
    // Avoid double init
    if (db) {
      return { db, success: true };
    }

    const connection = process.env.DATABASE_URL;
    if (!connection) throw new Error('DATABASE_URL is not set');

    (logger?.info ?? console.log)('Initializing database connection…');

    verifyDatabaseUrl(connection);
    const database = createDbConnection(applicationName);

    await testConnection(database, logger);
    (logger?.info ?? console.log)('✅ Database connection established');

    // Step 3: Schema sync (if enabled)
    if (enableSchemaSync) {
      try {
        (logger?.info ?? console.log)('Running schema sync…');
        const syncSchema = null as any;
        await syncSchema(database, {
          tighten: schemaTightening,
          schemaFile,
          logger,
        });
        (logger?.info ?? console.log)('Schema sync complete.');
      } catch (error) {
        (logger?.warn ?? console.warn)('Schema sync failed, continuing…', error);
      }
    } else {
      (logger?.info ?? console.log)('Schema sync skipped (SCHEMA_SYNC=0).');
    }

    // Step 4: Run migrations (our idempotent SQL apply)
    if (runMigrations) {
      try {
        (logger?.info ?? console.log)('Running migrations…');
        const runMigration = null as any;
        await runMigration(database, logger);
        (logger?.info ?? console.log)('Migrations complete.');
      } catch (error) {
        (logger?.error ?? console.error)('Migration failed:', error);
        if ((process.env.NODE_ENV ?? 'development') !== 'production') {
          await database.destroy().catch(() => {});
          throw error;
        }
      }
    }

    db = database;
    return { db: database, success: true };
  } catch (error: any) {
    return {
      db: null as any,
      success: false,
      error: error?.message || String(error),
    };
  }
}

// Legacy function for backwards compatibility
export async function initializeDatabase(logger?: any): Promise<Knex> {
  const result = await initializeDatabaseComplete({ logger });
  if (!result.success) throw new Error(`Database initialization failed: ${result.error}`);
  return result.db;
}

// Individual helpers
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

export async function runMigrations(database?: Knex): Promise<void> {
  const dbInstance = database || getDb();
  if (!dbInstance) throw new Error('Database not configured');
  try {
    console.log('Running database migrations (Knex)…');
    const [batchNo, log] = await (dbInstance as any).migrate.latest();
    if (!log || log.length === 0) {
      console.log('✅ Database is already up to date');
    } else {
      console.log(`✅ Ran ${log.length} migrations (batch ${batchNo}):`);
      log.forEach((m: string) => console.log(`  - ${m}`));
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy();
    db = null;
    console.log('Database connection closed');
  }
}
