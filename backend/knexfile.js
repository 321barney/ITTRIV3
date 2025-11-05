"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// knexfile.ts
var config_js_1 = require("./db/config.js");
var dbConfig = (0, config_js_1.getDatabaseConfig)();
var config = {
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
exports.default = config;
