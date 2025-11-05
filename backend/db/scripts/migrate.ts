// src/db/scripts/migrate.ts
import { Client } from "pg";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import * as cfg from "../config.js";

function here(...p: string[]) { return path.resolve(process.cwd(), ...p); }

function resolveSchemaPath(): string {
  const explicit = process.env.SCHEMA_FILE?.trim();
  if (explicit) {
    const p = path.isAbsolute(explicit) ? explicit : here(explicit);
    if (!existsSync(p)) throw new Error(`Schema file not found: ${p}`);
    return p;
  }
  const base = process.env.SCHEMA_DIR?.trim() || "src/db/migrations";
  const candidates = [ "2025-10-16-editor-files.sql" ]
    .map(f => here(base, f));
  const found = candidates.find(existsSync);
  if (!found) throw new Error(`Schema file not found. Looked for:\n- ${candidates.join("\n- ")}`);
  return found;
}

function pickDbConfig() {
  // Prefer any “owner/migrator” getter if your config exports it
  const ownerGetter =
    (cfg as any).getMigrationDatabaseConfig ||
    (cfg as any).getDatabaseConfigForMigrationsMaybeOwner ||
    (cfg as any).getDatabaseConfig;
  return ownerGetter();
}

export async function applyAutoSchema(): Promise<void> {
  const dbConfig = pickDbConfig();
  const client = new Client({ connectionString: dbConfig.url, ssl: dbConfig.ssl });

  const schemaPath = resolveSchemaPath();
  const sql = readFileSync(schemaPath, "utf8");

  try {
    await client.connect();

    // Reset role & ensure search_path before probing
    try { await client.query("RESET ROLE"); } catch {}

    // Ensure app schema exists and is first on path for this session
    await client.query(`CREATE SCHEMA IF NOT EXISTS app`);
    await client.query(`SET search_path = app, public`);

    const who = await client.query(
      "SELECT current_user, session_user, current_database() AS db"
    );
    console.log("Connected to database ✅", JSON.stringify(who.rows?.[0] ?? {}));
    console.log(`Using schema file: ${schemaPath}`);

    // Probe privileges against app schema
    const priv = await client.query(
      "SELECT has_schema_privilege(current_user,'app','CREATE') AS can_create"
    );
    const canCreate: boolean = !!priv.rows?.[0]?.can_create;

    if (!canCreate) {
      // If we can't create, but the main tables already exist in app, skip quietly (worker scenario)
      const key = await client.query(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema='app'
            AND table_name = ANY($1)`,
        [[ "sellers", "stores", "orders" ]]
      );

      if (key.rowCount && key.rowCount > 0) {
        console.log(
          `[migrate] No CREATE privilege on schema app for current_user; ` +
          `detected existing tables (${key.rows.map(r => r.table_name).join(", ")}). Skipping migration.`
        );
        return;
      }

      // Otherwise, we truly can't bootstrap — fail with a clear message.
      throw new Error(
        `Insufficient privileges to bootstrap schema: ` +
        `current_user cannot CREATE in schema app. Use a DB owner URL or grant privileges.`
      );
    }

    console.log("Applying schema (single batch)...");
    await client.query(sql);
    console.log("\n✅ Schema migration completed successfully!");
  } catch (err: any) {
    console.error("❌ Migration failed:", err?.message || err);
    throw err;
  } finally {
    try { await client.end(); } catch {}
  }
}

export async function applyFreshSchema(): Promise<void> {
  return applyAutoSchema();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  applyAutoSchema()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
