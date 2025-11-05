"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUserStore, useUIStore } from "@/stores";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";

type Store = {
  id: string;
  name: string;
  status: "active" | "inactive" | "suspended";
  gsheet_url?: string | null;
  has_gsheet?: boolean;
  created_at?: string;
  updated_at?: string;
};

function toArray(payload: any): Store[] {
  const v = payload?.stores ?? payload;
  if (Array.isArray(v)) return v as Store[];
  if (v && typeof v === "object") return [v as Store];
  return [];
}

export default function StoresClient({ initial }: { initial: any }) {
  const router = useRouter();
  const { setCurrentStore } = useUserStore();
  const { addNotification } = useUIStore();
  const [rows, setRows] = useState<Store[]>(toArray(initial));
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success" | "warning"; text: string } | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/stores", {
        headers: { accept: "application/json" },
        cache: "no-store",
        credentials: "include",
      });
      const j = await res.json().catch(() => ({}));
      setRows(toArray(j));
    } finally {
      setLoading(false);
    }
  }

  async function put(id: string, body: any) {
    setMsg(null);
    const res = await fetch(`/api/dashboard/stores/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "include",
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j?.ok === false) {
      const text = j?.message || j?.error || `HTTP ${res.status}`;
      const err: any = new Error(text);
      (err.status = res.status), (err.j = j);
      throw err;
    }
    const updated: Store = j?.store ?? j;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...updated } : r)));
    return updated;
  }

  async function rename(id: string, name: string) {
    if (!name.trim()) return;
    try {
      await put(id, { name: name.trim() });
      setMsg({ tone: "success", text: "Name updated." });
    } catch (e: any) {
      setMsg({ tone: "error", text: String(e?.message || e) });
      await refresh();
    }
  }

  async function activate(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    let url = (row.gsheet_url || "").trim();
    if (!url) {
      // eslint-disable-next-line no-alert
      const entered = window.prompt(
        "Enter Google Sheet URL required to activate this store:",
        "https://docs.google.com/spreadsheets/..."
      );
      if (!entered) return;
      url = entered.trim();
    }
    try {
      await put(id, { status: "active", gsheet_url: url });
      setMsg({ tone: "success", text: "Store activated." });
    } catch (e: any) {
      if (e?.status === 409 && e?.j?.error === "integrations_missing") {
        setMsg({
          tone: "warning",
          text:
            e?.j?.message ||
            "Activation requires a valid Google Sheet URL and one enabled sheet. Please add a Sheet URL and try again.",
        });
      } else {
        setMsg({ tone: "error", text: String(e?.message || e) });
      }
      await refresh();
    }
  }

  async function deactivate(id: string) {
    try {
      await put(id, { status: "inactive" });
      setMsg({ tone: "success", text: "Store deactivated." });
    } catch (e: any) {
      setMsg({ tone: "error", text: String(e?.message || e) });
      await refresh();
    }
  }

  async function toggleSheet(id: string, nextEnabled: boolean) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;

    if (nextEnabled) {
      let url = (row.gsheet_url || "").trim();
      if (!url) {
        // eslint-disable-next-line no-alert
        const entered = window.prompt(
          "Enter Google Sheet URL to enable Sheets for this store:",
          "https://docs.google.com/spreadsheets/..."
        );
        if (!entered) return;
        url = entered.trim();
      }
      try {
        await put(id, { gsheet_url: url });
        setMsg({ tone: "success", text: "Sheet enabled." });
      } catch (e: any) {
        setMsg({ tone: "error", text: String(e?.message || e) });
        await refresh();
      }
    } else {
      try {
        await put(id, { gsheet_url: null, status: "inactive" });
        setMsg({ tone: "success", text: "Sheet disabled and store set to inactive." });
      } catch (e: any) {
        setMsg({ tone: "error", text: String(e?.message || e) });
        await refresh();
      }
    }
  }

  useEffect(() => {
    const vis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stores</h1>
          <p className="text-sm text-muted-foreground">Manage activation and Google Sheets from here.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
          <Link href="/dashboard/stores/new">
            <Button>New store</Button>
          </Link>
        </div>
      </div>

      {msg && (
        <Alert variant={msg.tone === "success" ? "default" : msg.tone === "warning" ? "warning" : "destructive"}>
          <AlertTitle>
            {msg.tone === "success" ? "Success" : msg.tone === "warning" ? "Heads up" : "Error"}
          </AlertTitle>
          <AlertDescription>{msg.text}</AlertDescription>
        </Alert>
      )}

      <Card className="card-futuristic overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Your stores</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[36ch]">Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sheet</TableHead>
                <TableHead className="w-[320px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((r) => {
                const isActive = r.status === "active";
                const sheetEnabled = !!(r.gsheet_url && r.gsheet_url.trim().length > 0);
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <EditableName value={r.name} onSave={(v) => rename(r.id, v)} />
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <Badge variant="secondary">id: {r.id}</Badge>
                        <Badge variant={sheetEnabled ? "secondary" : "outline"}>
                          {sheetEnabled ? "sheet: enabled" : "sheet: disabled"}
                        </Badge>
                      </div>
                    </TableCell>

                    <TableCell>
                      <Badge variant={isActive ? "default" : "outline"}>
                        {isActive ? "active" : "inactive"}
                      </Badge>
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={sheetEnabled}
                          onCheckedChange={(v) => toggleSheet(r.id, v)}
                          aria-label="Toggle Google Sheet"
                        />
                        <span>Google Sheet</span>
                      </div>
                      {sheetEnabled && r.gsheet_url && (
                        <div className="mt-1 text-[11px] text-muted-foreground truncate max-w-[48ch]" title={r.gsheet_url}>
                          {r.gsheet_url}
                        </div>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button 
                          size="sm" 
                          variant="default"
                          onClick={() => {
                            setCurrentStore({
                              id: r.id,
                              name: r.name,
                              sellerId: '', // Will be filled by backend
                              status: r.status,
                              createdAt: r.created_at ? new Date(r.created_at) : new Date(),
                              updatedAt: r.updated_at ? new Date(r.updated_at) : new Date(),
                            });
                            addNotification({ title: 'Store Selected', description: `Now viewing ${r.name}`, type: 'success' });
                            router.push('/dashboard');
                          }}
                        >
                          Select Store
                        </Button>
                        {!isActive ? (
                          <Button size="sm" variant="outline" onClick={() => activate(r.id)}>Activate</Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => deactivate(r.id)}>Deactivate</Button>
                        )}
                        <Link href={`/dashboard/stores/${encodeURIComponent(r.id)}`}>
                          <Button size="sm" variant="ghost">Manage</Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-10">
                    No stores yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Tip: toggle the “Google Sheet” switch to attach/clear a Sheet without opening the store page. Activation still
        requires a valid Sheet.
      </p>
    </div>
  );
}

/* ---------- inline editable input ---------- */
function EditableName({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => Promise<void> | void;
}) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);

  useEffect(() => setV(value), [value]);

  async function commit() {
    const nv = v.trim();
    if (!nv || nv === value) return;
    setBusy(true);
    try {
      await onSave(nv);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Input
      value={v}
      disabled={busy}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        else if (e.key === "Escape") {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder="Store name"
    />
  );
}
