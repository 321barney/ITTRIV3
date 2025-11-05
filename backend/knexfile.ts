// knexfile.ts
import { getDatabaseConfig } from './db/config.js';

const dbConfig = getDatabaseConfig();

const config = {
  development: {
    client: 'pg',
    connection: dbConfig.url,
    ssl: dbConfig.ssl,
    pool: dbConfig.pool,
    migrations: {
      directory: './src/db/migrations',
      extension: 'ts'
    },
    seeds: {
      directory: './db/seeds'
    }
  },
  production: {
    client: 'pg',
    connection: dbConfig.url,
    ssl: dbConfig.ssl,
    pool: dbConfig.pool,
    migrations: {
      directory: './src/db/migrations',
      extension: 'ts'
    }
  }
};

export default config;