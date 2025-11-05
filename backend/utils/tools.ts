import type { Knex } from 'knex';

export function buildToolSchemas() {
  return [
    {
      type: 'function',
      function: {
        name: 'get_store_overview',
        description: 'Get store overview for the current seller, including status and product counts',
        parameters: { type: 'object', properties: { store_id: { type: 'string' } }, required: ['store_id'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_recent_products',
        description: 'List recent products for the store',
        parameters: { type: 'object', properties: { store_id: { type: 'string' }, limit: { type: 'integer' } }, required: ['store_id'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_product',
        description: 'Create a simple product with SKU, title and price',
        parameters: {
          type: 'object',
          properties: {
            store_id: { type: 'string' },
            sku: { type: 'string' },
            title: { type: 'string' },
            price: { type: 'number' },
            currency: { type: 'string' }
          },
          required: ['store_id','sku','title','price']
        }
      }
    }
  ];
}

// Execute a tool call; return JSON-serializable result.
export async function executeTool(knex: Knex, name: string, args: any) {
  switch (name) {
    case 'get_store_overview': {
      const store = await knex('stores').where({ id: args.store_id }).first();
      if (!store) return { ok: false, error: 'store_not_found' };

      const [{ count: totalProducts }] = await knex('products').where({ store_id: store.id }).count('* as count');
      const [{ count: activeProducts }] = await knex('products').where({ store_id: store.id, status: 'active' }).count('* as count');
      return { ok: true, store: { id: store.id, name: store.name, status: store.status }, products: { total: Number(totalProducts||0), active: Number(activeProducts||0) } };
    }
    case 'list_recent_products': {
      const limit = Math.max(1, Math.min(100, Number(args.limit ?? 10)));
      const items = await knex('products').where({ store_id: args.store_id }).orderBy('created_at','desc').limit(limit);
      return { ok: true, items };
    }
    case 'create_product': {
      const now = new Date();
      const [store] = await knex('stores').where({ id: args.store_id }).limit(1);
      if (!store) return { ok: false, error: 'store_not_found' };

      const [product] = await knex('products')
        .insert({
          store_id: store.id,
          seller_id: store.seller_id,
          sku: args.sku,
          title: args.title,
          price: args.price,
          currency: args.currency ?? 'USD',
          status: 'active',
          created_at: now,
          updated_at: now
        })
        .returning('*');
      return { ok: true, product };
    }
    default:
      return { ok: false, error: `unknown_tool:${name}` };
  }
}
