"use client";

import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCcw, Table as TableIcon, TrendingUp, DollarSign, ShoppingCart } from 'lucide-react';

/* ================= Types ================= */
type BackendDashboard = {
  ok: boolean;
  store?: { id: string; name: string };
  kpis?: {
    orders_total: number;
    orders_7d: number;
    orders_by_status: Record<string, number>;
    revenue_7d: number;
  };
  recent_orders?: Array<{ id: string; created_at: string }>;
};

type MetricOverview = {
  ok: boolean;
  data?: {
    totals?: { revenue?: number; orders?: number };
    series?: Array<{ date: string; orders?: number; revenue?: number }>;
    by_store?: Array<any>;
  };
};

type SeriesItem = { date: string; orders: number };

/* ================ Helpers ================ */
const toISO = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);
const daysBack = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const emptyOrdersSeries = (n = 30): SeriesItem[] =>
  Array.from({ length: n }, (_, i) => ({ date: toISO(daysBack(n - 1 - i)), orders: 0 }));

/** Normalize either backend shape to the dashboard view model your UI expects. */
function normalizeToDashboardShape(anyRaw: any): BackendDashboard {
  // Case A: already the seller dashboard shape → return as-is
  if (anyRaw?.kpis || anyRaw?.recent_orders) return anyRaw as BackendDashboard;

  // Case B: metric/overview shape → synthesize minimal fields
  const m = anyRaw as MetricOverview;
  const totals = m?.data?.totals ?? {};
  const series = (m?.data?.series ?? []) as Array<{ date: string; orders?: number; revenue?: number }>;

  const last7 = series.slice(-7);
  const orders_7d = last7.reduce((s, r) => s + Number(r.orders || 0), 0);
  const orders_total = Number(totals.orders || 0);
  const revenue_7d = last7.reduce((s, r) => s + Number(r.revenue || 0), 0);

  const recent_orders = series
    .slice(-30)
    .flatMap(r =>
      Array.from({ length: Number(r.orders || 0) }, () => ({
        id: `fake-${r.date}-${Math.random().toString(36).slice(2, 8)}`,
        created_at: r.date,
      }))
    );

  return {
    ok: Boolean(anyRaw?.ok ?? true),
    kpis: {
      orders_total,
      orders_7d,
      orders_by_status: {}, // not available from overview
      revenue_7d,
    },
    recent_orders,
  };
}

/* ================= Page ================= */
export default function AnalyticsPage() {
  const [raw, setRaw] = useState<BackendDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const [status, setStatus] = useState<number | null>(null);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');

  const fetchData = async () => {
    try {
      setLoading(true);
      setErr(null);
      setStatus(null);

      const r = await fetch(`/api/dashboard/metrics?period=${period}`, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });

      setStatus(r.status);

      if (r.status === 401) throw new Error('You need to sign in to view analytics (401).');
      if (r.status === 403) throw new Error('This account lacks seller access (403).');

      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const json = await r.json();
      setRaw(normalizeToDashboardShape(json));
    } catch (e: any) {
      setErr(e?.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const kpis = useMemo(() => {
    const k = raw?.kpis;
    return [
      {
        label: 'Revenue (7d)',
        value: k
          ? new Intl.NumberFormat(undefined, {
              style: 'currency',
              currency: 'USD',
              maximumFractionDigits: 0,
            }).format(k.revenue_7d || 0)
          : '—',
        icon: DollarSign,
      },
      {
        label: 'Orders (total)',
        value: k ? (k.orders_total || 0).toLocaleString() : '—',
        icon: ShoppingCart,
      },
      {
        label: 'Orders (7d)',
        value: k ? (k.orders_7d || 0).toLocaleString() : '—',
        icon: TrendingUp,
      },
    ];
  }, [raw]);

  const ordersSeries: SeriesItem[] = useMemo(() => {
    const base = emptyOrdersSeries(30);
    const map = new Map(base.map((r) => [r.date, 0]));
    (raw?.recent_orders || []).forEach((o) => {
      const d = toISO(o.created_at);
      map.set(d, (map.get(d) || 0) + 1);
    });
    return base.map((r) => ({ date: r.date, orders: map.get(r.date) || 0 }));
  }, [raw]);

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-gray-500">
            Store performance from <code>/api/dashboard/metrics</code>
          </p>
        </div>
        <div className="flex gap-2">
          <select
            className="rounded-xl border px-3 py-2 text-sm"
            value={period}
            onChange={(e) => setPeriod(e.target.value as '7d' | '30d' | '90d')}
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>

          <Button variant="outline" onClick={fetchData} className="rounded-2xl">
            <RefreshCcw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button variant="secondary" onClick={() => setShowRaw((v) => !v)} className="rounded-2xl">
            <TableIcon className="mr-2 h-4 w-4" /> {showRaw ? 'Hide JSON' : 'Show JSON'}
          </Button>
        </div>
      </header>

      {loading && (
        <Card>
          <CardContent className="p-6">Loading…</CardContent>
        </Card>
      )}

      {err && (
        <Card>
          <CardContent className="p-6">
            <div className="font-medium text-red-600">{err}</div>
            {status ? <div className="mt-1 text-sm text-gray-500">Status: {status}</div> : null}
          </CardContent>
        </Card>
      )}

      {!loading && !err && raw && (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {kpis.map((k) => (
              <Card key={k.label} className="rounded-2xl shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-500">{k.label}</div>
                    <k.icon className="h-5 w-5 text-gray-400" />
                  </div>
                  <div className="mt-2 text-2xl font-semibold">{k.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Orders by day */}
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-6">
              <div className="mb-4 text-sm text-gray-500">Orders (last 30 days)</div>
              <div className="h-80 w-full">
                <ResponsiveContainer>
                  <BarChart data={ordersSeries} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="orders" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Orders by status */}
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-6">
              <div className="mb-4 text-sm text-gray-500">Orders by Status</div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead>
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Status
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Count
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {Object.entries(raw.kpis?.orders_by_status || {}).map(([status, count]) => (
                      <tr key={status}>
                        <td className="px-4 py-2 capitalize">{status}</td>
                        <td className="px-4 py-2">{Number(count || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                    {!raw.kpis?.orders_by_status ||
                    Object.keys(raw.kpis?.orders_by_status || {}).length === 0 ? (
                      <tr>
                        <td className="px-4 py-3 text-gray-500" colSpan={2}>
                          No status breakdown available for this period.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Raw JSON */}
          {showRaw && (
            <Card>
              <CardContent className="p-6">
                <pre className="whitespace-pre-wrap break-words text-xs">
                  {JSON.stringify(raw, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
