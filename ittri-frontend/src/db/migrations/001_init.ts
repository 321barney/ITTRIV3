
/* knex migration: users, stores, products, api_keys */
export async function up(knex: any) {
  await knex.schema.createTable('users', (t: any) => {
    t.increments('id').primary();
    t.string('email').notNullable().unique();
    t.string('password_hash').notNullable();
    t.enu('role', ['buyer','seller','admin']).notNullable().defaultTo('buyer');
    t.enu('tier', ['starter','pro','enterprise']).notNullable().defaultTo('starter');
    t.integer('token_ver').notNullable().defaultTo(1);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('stores', (t: any) => {
    t.increments('id').primary();
    t.integer('owner_id').unsigned().references('users.id').onDelete('CASCADE');
    t.string('name').notNullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('products', (t: any) => {
    t.increments('id').primary();
    t.integer('store_id').unsigned().references('stores.id').onDelete('CASCADE');
    t.string('sku').notNullable();
    t.string('name').notNullable();
    t.decimal('price', 12, 2).notNullable();
    t.jsonb('metadata').defaultTo('{}');
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('api_keys', (t: any) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('users.id').onDelete('CASCADE');
    t.integer('store_id').unsigned().references('stores.id').onDelete('CASCADE');
    t.string('key_hash').notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });
}

export async function down(knex: any) {
  await knex.schema.dropTableIfExists('api_keys');
  await knex.schema.dropTableIfExists('products');
  await knex.schema.dropTableIfExists('stores');
  await knex.schema.dropTableIfExists('users');
}
