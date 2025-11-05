
// smoketests/test_orders_smoke.ts
import { getDb } from '../src/db/index.js';
import { markOrderStatus } from '../src/services/orders.js';

async function run() {
  const db = getDb();
  // insert dummy order
  const [order] = await db('orders')
    .insert({
      id: db.raw('gen_random_uuid()'),
      store_id: db.raw('gen_random_uuid()'),
      status: 'pending_confirmation',
    })
    .returning('*');

  console.log('Inserted order', order.id, 'initial status', order.status);

  // run markOrderStatus
  await markOrderStatus(db, order.id, 'confirmed');
  const updated = await db('orders').where({ id: order.id }).first();
  console.log('Updated order', updated.id, 'new status', updated.status, 'confirmed_at', updated.confirmed_at);

  // cleanup
  await db('orders').where({ id: order.id }).delete();
  console.log('Smoke test passed!');
  process.exit(0);
}

run().catch(err => {
  console.error('Smoke test failed', err);
  process.exit(1);
});
