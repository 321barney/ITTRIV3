import { getDb } from '../db';
import type { Knex } from 'knex';

export async function getKPIs(params: { storeId?: string; start?: string | null; end?: string | null }) {
  const { storeId, start, end } = params;
  const db: Knex | null = getDb();
  if (!db) {
    return {
      storeId: storeId ?? null,
      period: { start: start ?? null, end: end ?? null },
      gmv: 0,
      orders: 0,
      aov: 0,
      conversionRate: 0,
      ctr: 0,
      refunds: 0,
      topSkus: [],
      insights: ['Database not available'],
    };
  }

  // Build WHERE clauses dynamically based on provided filters
  const whereClauses: string[] = [];
  const values: any[] = [];
  if (storeId) {
    whereClauses.push('o.store_id = ?');
    values.push(storeId);
  }
  if (start) {
    whereClauses.push('o.created_at >= ?');
    values.push(start);
  }
  if (end) {
    whereClauses.push('o.created_at <= ?');
    values.push(end);
  }
  const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Aggregate orders table for GMV (gross merchandise value) and counts
  const ordersAgg = await db.raw(
    `SELECT
        COUNT(*)::bigint AS orders,
        COALESCE(SUM(o.total_amount), 0)::numeric AS gmv,
        COALESCE(AVG(o.total_amount), 0)::numeric AS aov
     FROM orders o
     ${where}`,
    values
  );
  const { orders, gmv, aov } = ordersAgg.rows[0] || { orders: 0, gmv: 0, aov: 0 };

  // Top SKUs by quantity sold
  const topSkusRes = await db.raw(
    `SELECT oi.sku, SUM(oi.quantity) AS qty
       FROM order_items oi
       JOIN orders o ON oi.store_id = o.store_id AND oi.external_id = o.external_id
       ${where}
      GROUP BY oi.sku
      ORDER BY qty DESC
      LIMIT 5`,
    values
  );
  const topSkus = topSkusRes.rows.map((r: any) => ({ sku: r.sku, quantity: Number(r.qty) }));

  // Refunds count: count orders with status 'refunded' or 'refund'
  const refundsRes = await db.raw(
    `SELECT COUNT(*)::bigint AS refunds
       FROM orders o
       ${where}
       AND LOWER(o.status) LIKE 'refund%'`,
    values
  );
  const refunds = Number(refundsRes.rows[0]?.refunds || 0);

  // For CTR and conversion rate you would need visit/session data; placeholder for now
  const ctr = 0;
  const conversionRate = orders > 0 ? 1 : 0;

  return {
    storeId: storeId ?? null,
    period: { start: start ?? null, end: end ?? null },
    gmv: Number(gmv),
    orders: Number(orders),
    aov: Number(aov),
    conversionRate,
    ctr,
    refunds,
    topSkus,
    insights: [],
  };
}
