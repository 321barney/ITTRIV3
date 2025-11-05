'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUserStore } from '@/stores';
import { LogOut, RefreshCcw } from 'lucide-react';

type MeResp = {
  user?: any;
  default_store?: any;
  // tolerate flat user payloads too
  id?: string;
  email?: string;
  role?: string;
  company_name?: string;
  companyName?: string;
  plan_code?: string;
  planCode?: string;
  plan?: string;
  created_at?: string;
  updated_at?: string;
};

export default function SettingsPage() {
  const { user, setUser } = useUserStore();
  const [me, setMe] = useState<MeResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // LLM provider display (optional)
  // Expose the currently configured LLM provider via NEXT_PUBLIC_LLM_PROVIDER. Fallback to "openai".
  const llmProvider = process.env.NEXT_PUBLIC_LLM_PROVIDER?.toLowerCase() ?? 'openai';
  const llmEnvProvided = typeof process.env.NEXT_PUBLIC_LLM_PROVIDER === 'string';

  const load = async () => {
    try {
      setErr(null);
      const r = await fetch('/api/auth/me', {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json: MeResp = await r.json();
      setMe(json);

      // Optionally sync user store if fields changed
      const u = json.user ?? json;
      if (u?.id && u?.email) {
        setUser({
          id: String(u.id),
          email: String(u.email),
          role: u.role ?? 'seller',
          companyName: u.companyName ?? u.company_name ?? null,
          planCode: u.planCode ?? u.plan_code ?? u.plan ?? 'starter',
          billingCycleStart: u.billingCycleStart ?? u.billing_cycle_start ?? new Date(),
          createdAt: u.createdAt ?? u.created_at ?? new Date(),
          updatedAt: u.updatedAt ?? u.updated_at ?? new Date(),
        });
      }
    } catch (e: any) {
      setErr(e?.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    } finally {
      // simple client redirect
      window.location.href = '/auth/login';
    }
  };

  const u = me?.user ?? me ?? {};
  const store = me?.default_store;

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-gray-500">Account & store information from <code>/api/auth/me</code></p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} className="rounded-2xl">
            <RefreshCcw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button variant="destructive" onClick={logout} className="rounded-2xl">
            <LogOut className="mr-2 h-4 w-4" /> Logout
          </Button>
        </div>
      </header>

      {loading && (<Card><CardContent className="p-6">Loading…</CardContent></Card>)}
      {err && (<Card><CardContent className="p-6 text-red-600">{err}</CardContent></Card>)}

      {!loading && !err && (
        <>
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-6">
              <div className="mb-4 text-sm text-gray-500">Account</div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="User ID" value={String(u.id ?? '—')} />
                <Field label="Email" value={String(u.email ?? '—')} />
                <Field label="Role" value={String(u.role ?? 'seller')} />
                <Field label="Company" value={String(u.companyName ?? u.company_name ?? '—')} />
                <Field label="Plan" value={String(u.planCode ?? u.plan_code ?? u.plan ?? 'starter')} />
                <Field label="Created" value={String(u.createdAt ?? u.created_at ?? '—')} />
                <Field label="Updated" value={String(u.updatedAt ?? u.updated_at ?? '—')} />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-6">
              <div className="mb-4 text-sm text-gray-500">Default Store</div>
              {store ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label="Store ID" value={String(store.id)} />
                  <Field label="Name" value={String(store.name)} />
                  <Field label="Status" value={String(store.status ?? 'active')} />
                  <Field label="Created" value={String(store.created_at ?? '—')} />
                  <Field label="Updated" value={String(store.updated_at ?? '—')} />
                </div>
              ) : (
                <div className="text-sm text-gray-500">No default store found.</div>
              )}
            </CardContent>
          </Card>

          {/* AI provider information */}
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-6">
              <div className="mb-4 text-sm text-gray-500">AI Model Provider</div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Provider" value={llmProvider === 'ollama' ? 'Ollama (Local)' : 'OpenAI'} />
                <Field label="Environment" value={llmEnvProvided ? 'Custom' : 'Default'} />
              </div>
              <div className="mt-2 text-xs text-gray-500">
                This value is set via <code>NEXT_PUBLIC_LLM_PROVIDER</code>.
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium text-gray-900 truncate">{value}</div>
    </div>
  );
}
