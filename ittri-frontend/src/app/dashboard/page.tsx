"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  TrendingUp, ShoppingCart, DollarSign, Clock, MessageCircle,
  Gauge, RefreshCcw, Table as TableIcon, ShieldAlert, PlusCircle, Info, Code2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/* ====== ROUTES ====== */
const CREATE_STORE_URL = "/dashboard/stores/new";
const OPEN_LANDING_URL = "/dashboard/landing/landing-intro"; // <- updated target
const SHOW_AUTH_DEBUG = false;

/* ====== UI model ====== */
interface OrdersByStatusItem { status: string; count: number; percentage: number; }
interface RevenueByDayItem { date: string; revenue: number; orders: number; }
interface DashboardResp {
  totalOrders: number;
  totalRevenue: number;
  aiConfirmationRate: number; // 0..1
  avgResponseTime: number;    // minutes
  activeConversations: number;
  ordersToday: number;
  revenueToday: number;
  conversionRate: number;     // 0..1
  ordersByStatus: OrdersByStatusItem[];
  revenueByDay: RevenueByDayItem[];
}

/* ====== Backend shapes ====== */
type SellerDashboard = {
  ok: boolean;
  store?: { id: string; name: string };
  kpis?: {
    orders_total: number;
    orders_7d: number;
    orders_by_status: Record<string, number>;
    revenue_7d: number;
  };
  products?: { total: number; active: number; low_stock: number };
  recent_orders?: Array<{ id: string; status: string; created_at: string; total_amount?: number }>;
  recent_conversations?: Array<{ id: string; status: string; updated_at: string }>;
};

type MetricOverview = {
  ok: boolean;
  data?: {
    totals?: { revenue?: number; orders?: number; impressions?: number; conversations?: number; ai_confirmations?: number };
    series?: Array<{ date: string; revenue?: number; orders?: number; impressions?: number; conversations?: number; ai_confirmations?: number }>;
    by_store?: Array<any>;
    range?: { from: string; to: string };
  };
};

/* ====== Helpers ====== */
const toISODate = (d: Date | string) => {
  const dt = typeof d === "string" ? new Date(d) : d;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const daysBack = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
function emptySeries(days = 30): RevenueByDayItem[] {
  const arr: RevenueByDayItem[] = [];
  for (let i = days - 1; i >= 0; i--) arr.push({ date: toISODate(daysBack(i)), revenue: 0, orders: 0 });
  return arr;
}

/** Normalize either backend payload → UI model */
function toDashboardResp(raw: SellerDashboard | MetricOverview): DashboardResp {
  // Seller dashboard shape
  if ((raw as SellerDashboard)?.kpis || (raw as SellerDashboard)?.recent_orders) {
    const b = raw as SellerDashboard;
    const totalOrders = Number(b?.kpis?.orders_total ?? 0);
    const totalRevenue7d = Number(b?.kpis?.revenue_7d ?? 0);
    const byStatus = b?.kpis?.orders_by_status ?? {};
    const totalForPct = totalOrders || Object.values(byStatus).reduce((s, n) => s + Number(n || 0), 0);
    const ordersByStatus: OrdersByStatusItem[] = Object.entries(byStatus).map(([status, count]) => {
      const c = Number(count || 0);
      const pct = totalForPct > 0 ? Math.round((c / totalForPct) * 1000) / 10 : 0;
      return { status, count: c, percentage: pct };
    });

    const base = emptySeries(30);
    const mapOrders = new Map<string, number>(base.map(d => [d.date, 0]));
    const mapRevenue = new Map<string, number>(base.map(d => [d.date, 0]));
    for (const ro of b?.recent_orders ?? []) {
      const dt = toISODate(ro.created_at);
      mapOrders.set(dt, (mapOrders.get(dt) || 0) + 1);
      if (typeof ro.total_amount === "number") {
        mapRevenue.set(dt, (mapRevenue.get(dt) || 0) + Number(ro.total_amount));
      }
    }
    const revenueByDay = base.map(d => ({
      date: d.date,
      orders: mapOrders.get(d.date) || 0,
      revenue: mapRevenue.get(d.date) || 0,
    }));

    const todayISO = toISODate(new Date());
    const ordersToday = revenueByDay.find(d => d.date === todayISO)?.orders || 0;
    const revenueToday = revenueByDay.find(d => d.date === todayISO)?.revenue || 0;

    return {
      totalOrders,
      totalRevenue: totalRevenue7d,
      aiConfirmationRate: 0,
      avgResponseTime: 0,
      activeConversations: (b?.recent_conversations ?? []).length,
      ordersToday,
      revenueToday,
      conversionRate: 0,
      ordersByStatus,
      revenueByDay,
    };
  }

  // /metric/overview shape
  const m = raw as MetricOverview;
  const totals = m?.data?.totals ?? {};
  const series = (m?.data?.series ?? []) as Array<{ date: string; revenue?: number; orders?: number }>;

  const base = emptySeries(30);
  const idx = new Map(base.map((d, i) => [d.date, i]));
  for (const r of series) {
    const d = toISODate(r.date);
    const i = idx.get(d);
    if (i != null) {
      base[i].orders += Number(r.orders || 0);
      base[i].revenue += Number(r.revenue || 0);
    }
  }

  const last7 = base.slice(-7);
  const orders7d = last7.reduce((s, r) => s + r.orders, 0);
  const revenue7d = last7.reduce((s, r) => s + r.revenue, 0);

  const todayISO = toISODate(new Date());
  const ordersToday = base.find(d => d.date === todayISO)?.orders || 0;
  const revenueToday = base.find(d => d.date === todayISO)?.revenue || 0;

  return {
    totalOrders: Number(totals.orders || 0),
    totalRevenue: revenue7d,
    aiConfirmationRate: 0,
    avgResponseTime: 0,
    activeConversations: Number(totals.conversations || 0),
    ordersToday,
    revenueToday,
    conversionRate: 0,
    ordersByStatus: [],
    revenueByDay: base,
  };
}

function useSpotlight() {
  return useCallback((e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
    el.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
  }, []);
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  let cls = "status-badge status-review";
  if (["paid","fulfilled","completed","shipped","delivered","active"].some(k => s.includes(k))) cls = "status-badge status-active";
  else if (["canceled","cancelled","failed","inactive"].some(k => s.includes(k))) cls = "status-badge status-inactive";
  else if (["pending","processing","awaiting","review"].some(k => s.includes(k))) cls = "status-badge status-pending";
  return <span className={cls}>{status}</span>;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [raw, setRaw] = useState<any>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [authPromotedFrom, setAuthPromotedFrom] = useState<string | null>(null);
  const [noStore, setNoStore] = useState(false);

  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const v = typeof window !== "undefined" ? localStorage.getItem("dash.showRaw") : null;
    if (v) setShowRaw(v === "1");
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("dash.showRaw", showRaw ? "1" : "0");
  }, [showRaw]);

  const abortRef = useRef<AbortController | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    if (abortRef.current && !abortRef.current.signal.aborted) {
      try { abortRef.current.abort("refresh"); } catch {}
    }
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setLoading(true);
      setError(null);
      setAuthHint(null);
      setAuthPromotedFrom(null);
      setNoStore(false);

      const res = await fetch(`/api/dashboard/metrics?period=${period}`, {
        headers: { Accept: "application/json" },
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });

      const xPromoted = res.headers.get("x-auth-promoted-from");
      if (xPromoted) setAuthPromotedFrom(xPromoted);

      // 404 → either no store yet OR proxy masked admin-only endpoint
      if (res.status === 404) {
        let j: any = null;
        try { j = await res.json(); } catch {}
        if (j?.error === "store_not_found" || j?.hint === "seller_endpoint_required") {
          setNoStore(true);
          setData(null);
          setRaw(j);
          setLastRefresh(new Date().toLocaleString());
          return;
        }
      }

      if (res.status === 401) {
        setAuthHint("You need to sign in to view analytics (401).");
        setData(null);
        try { setRaw(await res.json()); } catch {}
        return;
      }
      if (res.status === 403) {
        let hint = "This account lacks seller access (403).";
        try {
          const j = await res.json();
          if (j?.hint === "admin_required")
            hint = "Your token looks admin-only. Re-login as a seller or ensure X-Org-Context is set.";
          setRaw(j);
        } catch {}
        setAuthHint(hint);
        setData(null);
        return;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }

      const json = await res.json();
      setRaw(json);
      setData(toDashboardResp(json));
      setLastRefresh(new Date().toLocaleString());
    } catch (e: any) {
      const isAbort =
        e?.name === "AbortError" ||
        e?.code === 20 ||
        e?.message?.toLowerCase?.().includes("abort") ||
        e?.reason === "unmount" || e?.reason === "refresh";
      if (!isAbort) {
        setError(e?.message ?? "Failed to load");
        setData(null);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    setLoading(true);
    void fetchData();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => { void fetchData(); }, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      const c = abortRef.current;
      if (c && !c.signal.aborted) { try { c.abort("unmount"); } catch {} }
    };
  }, [fetchData]);

  // Formatting
  const fmtCurrency = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n ?? 0);
  const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

  const kpis = useMemo(
    () => data ? [
      { label: "Total Revenue (7d)", value: fmtCurrency(data.totalRevenue), icon: DollarSign },
      { label: "Total Orders", value: data.totalOrders.toLocaleString(), icon: ShoppingCart },
      { label: "Conversion Rate", value: fmtPct(data.conversionRate), icon: TrendingUp },
      { label: "AI Confirmation", value: fmtPct(data.aiConfirmationRate), icon: MessageCircle },
      { label: "Avg Response Time", value: `${data.avgResponseTime.toFixed(1)} min`, icon: Clock },
      { label: "Active Chats", value: String(data.activeConversations), icon: MessageCircle },
      { label: "Revenue Today", value: fmtCurrency(data.revenueToday), icon: DollarSign },
      { label: "Orders Today", value: String(data.ordersToday), icon: Gauge },
    ] : [],
    [data]
  );

  const onSpotlight = useSpotlight();

  return (
    <div className="relative min-h-screen p-6 custom-scrollbar">
      <div className="stars pointer-events-none absolute inset-0" aria-hidden />
      <div className="stars stars--sm pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative mx-auto max-w-7xl space-y-6 min-h-0">
        {/* Header */}
        <header className="glass gradient-border flex items-center justify-between gap-3 flex-wrap focus-neon">
          <div className="p-4">
            <h1 className="gradient-text-triple text-2xl font-semibold tracking-tight">Sales Ops Dashboard</h1>
            <p className="text-sm text-slate-300/90">
              Live metrics from <code className="on-dark">/api/dashboard/metrics</code>
              {lastRefresh ? <span className="ml-2 text-xs opacity-80">(last refresh {lastRefresh})</span> : null}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap p-4">
            <div className="flex items-center gap-2">
              <Button
                variant={period === "7d" ? "secondary" : "outline"}
                className="rounded-2xl"
                onClick={() => setPeriod("7d")}
              >
                7d
              </Button>
              <Button
                variant={period === "30d" ? "secondary" : "outline"}
                className="rounded-2xl"
                onClick={() => setPeriod("30d")}
              >
                30d
              </Button>
              <Button
                variant={period === "90d" ? "secondary" : "outline"}
                className="rounded-2xl"
                onClick={() => setPeriod("90d")}
              >
                90d
              </Button>
            </div>
            <Button asChild variant="secondary" className="btn-futuristic focus-neon rounded-2xl whitespace-nowrap">
              <Link href={OPEN_LANDING_URL}>
                <Code2 className="mr-2 h-4 w-4" />Open Landing Studio
              </Link>
            </Button>
            <Button variant="outline" onClick={() => void fetchData()} className="glass gradient-border focus-neon rounded-2xl whitespace-nowrap">
              <RefreshCcw className="mr-2 h-4 w-4" />Refresh
            </Button>
            <Button variant="secondary" onClick={() => setShowRaw((v) => !v)} className="glass gradient-border focus-neon rounded-2xl whitespace-nowrap">
              <TableIcon className="mr-2 h-4 w-4" />{showRaw ? "Hide JSON" : "Show JSON"}
            </Button>
          </div>
        </header>

        {/* Auth / wiring hints */}
        {(authHint || (SHOW_AUTH_DEBUG && authPromotedFrom)) && (
          <Card className="card-futuristic focus-neon border-yellow-200" onMouseMove={onSpotlight}>
            <CardContent className="flex flex-col gap-1 p-4 text-yellow-100">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4" />
                <div className="space-y-1">
                  {authHint && <div>{authHint}</div>}
                  {SHOW_AUTH_DEBUG && authPromotedFrom && (
                    <div className="text-xs opacity-80">Token found via <code className="on-dark">{authPromotedFrom}</code>.</div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty state */}
        {noStore && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="card-futuristic" onMouseMove={onSpotlight}>
              <CardContent className="p-6">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-white/10 p-2"><Info className="h-5 w-5 text-white" /></div>
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold gradient-text-triple">No store yet</h2>
                    <p className="mt-1 text-sm text-slate-200">
                      We couldn’t find any store for your account, so there are no metrics to show.
                      Create your store to start tracking orders, revenue, and trends.
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <Button asChild className="btn-futuristic focus-neon rounded-2xl">
                        <Link href={CREATE_STORE_URL}><PlusCircle className="mr-2 h-4 w-4" />Create your store</Link>
                      </Button>
                      <Button asChild variant="outline" className="glass gradient-border focus-neon rounded-2xl">
                        <Link href="/help/getting-started">Read the quick-start</Link>
                      </Button>
                      <div className="text-xs text-slate-300/80">Already created one? Refresh after finishing onboarding.</div>
                    </div>
                    <div className="mt-6 grid gap-2 text-sm md:grid-cols-2">
                      <div className="glass gradient-border">✅ Store is created as <b>inactive</b></div>
                      <div className="glass gradient-border">✅ Connect <b>Google Sheets</b></div>
                      <div className="glass gradient-border">✅ Connect <b>WhatsApp</b> channel</div>
                      <div className="glass gradient-border">✅ Store becomes <b>active</b> once both are connected</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Loading / Error */}
        {loading && (
          <Card className="card-futuristic" onMouseMove={onSpotlight}>
            <CardContent className="p-6">Loading…</CardContent>
          </Card>
        )}
        {error && !noStore && (
          <Card className="card-futuristic border-red-400/40" onMouseMove={onSpotlight}>
            <CardContent className="p-6 text-red-300">{error}</CardContent>
          </Card>
        )}

        {/* KPI Grid */}
        {!!data && !noStore && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 min-h-0">
            {kpis.map((kpi) => (
              <motion.div key={kpi.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="card-futuristic focus-neon" onMouseMove={onSpotlight}>
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="text-xs uppercase tracking-wider on-dark opacity-80">{kpi.label}</div>
                      <kpi.icon className="h-5 w-5 text-white/60" />
                    </div>
                    <div className="mt-2 text-2xl font-semibold gradient-text-triple">{kpi.value}</div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        {/* Charts */}
        {!!data && !noStore && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 min-h-0">
            <Card className="card-futuristic xl:col-span-2 min-h-0" onMouseMove={onSpotlight}>
              <CardContent className="p-6 min-h-0 flex flex-col">
                <div className="mb-4 text-sm on-dark opacity-80">Revenue by Day</div>
                <div className="h-72 w-full min-h-0">
                  {mounted && (data.revenueByDay.length > 0) ? (
                    <ResponsiveContainer>
                      <LineChart data={data.revenueByDay} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} tickMargin={8} />
                        <YAxis tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`} tickMargin={8} />
                        <Tooltip formatter={(v: any, name) =>
                          name === "revenue"
                            ? new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(v as number)
                            : v
                        }/>
                        <Legend />
                        <Line type="monotone" dataKey="revenue" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="grid h-full place-items-center text-sm text-slate-300/80">No data yet.</div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="card-futuristic min-h-0" onMouseMove={onSpotlight}>
              <CardContent className="p-6 min-h-0 flex flex-col">
                <div className="mb-4 text-sm on-dark opacity-80">Orders by Day</div>
                <div className="h-72 w-full min-h-0">
                  {mounted && (data.revenueByDay.length > 0) ? (
                    <ResponsiveContainer>
                      <BarChart data={data.revenueByDay} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} tickMargin={8} />
                        <YAxis tickMargin={8} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="orders" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="grid h-full place-items-center text-sm text-slate-300/80">No data yet.</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Orders by Status */}
        {!!data && !noStore && (
          <Card className="card-futuristic" onMouseMove={onSpotlight}>
            <CardContent className="p-6 min-h-0 flex flex-col">
              <div className="mb-4 text-sm on-dark opacity-80">Orders by Status</div>
              { (data.ordersByStatus?.length ?? 0) > 0 ? (
                <div className="overflow-x-auto -mx-6 px-6 custom-scrollbar">
                  <table className="min-w-full divide-y divide-white/10">
                    <thead>
                      <tr>
                        <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider on-dark opacity-80">Status</th>
                        <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider on-dark opacity-80">Count</th>
                        <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider on-dark opacity-80">Percentage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {data.ordersByStatus
                        .slice()
                        .sort((a, b) => b.count - a.count)
                        .map((row) => (
                          <tr key={row.status} className="hover:bg-white/5 transition-colors">
                            <td className="px-4 py-2 capitalize"><StatusBadge status={row.status} /></td>
                            <td className="px-4 py-2">{row.count.toLocaleString()}</td>
                            <td className="px-4 py-2">{row.percentage}%</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="grid h-32 place-items-center text-sm text-slate-300/80">No status data yet.</div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Raw JSON */}
        {showRaw && raw && (
          <Card className="card-futuristic" onMouseMove={onSpotlight}>
            <CardContent className="p-6">
              <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-200">
                {JSON.stringify(raw, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
