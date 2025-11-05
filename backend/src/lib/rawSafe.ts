import type { Knex } from 'knex';

/**
 * Guardrail wrapper around knex.raw to enforce parameter binding.
 * Use this instead of knex.raw for any raw SQL, e.g.:
 *   await rawSafe(knex, 'select * from users where id = ?', [id]);
 */
export function rawSafe(db: Knex, sql: string, bindings: readonly unknown[]) {
  if (!bindings || bindings.length === 0) {
    throw new Error('rawSafe requires explicit bindings to avoid SQL injection');
  }
  return db.raw(sql, bindings as any);
}
