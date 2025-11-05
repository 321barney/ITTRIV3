import 'dotenv/config';

/** @type {import('knex').Knex.Config} */
const config = {
  client: 'pg',
  connection: process.env.DATABASE_URL,
  pool: { min: 2, max: 10 },
  migrations: { directory: './src/db/migrations', tableName: 'knex_migrations', extension: 'sql' }
};
export default config;
