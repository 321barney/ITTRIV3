"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

type Store = {
  id: string;
  name: string;
  status: "active" | "inactive";
  gsheet_url?: string | null;
  has_gsheet?: boolean;
  created_at?: string;
  updated_at?: string;
};

export default function StoreView({ id }: { id: string }) {
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const r = await fetch(`/api/dashboard/stores/${encodeURIComponent(id)}`, {
        credentials: "include",
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.error || `Load failed: ${r.status}`);
      setStore(j.store);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load store");
      setStore(null);
    } finally {
      setLoading(false);
    }
  }

  async function save(next: Partial<Pick<Store, "name" | "status" | "gsheet_url">>) {
    try {
      setSaving(true);
      const r = await fetch(`/api/dashboard/stores/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json", accept: "application/json" },
        credentials: "include",
        body: JSON.stringify(next),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) {
        if (r.status === 409 && j?.error === "integrations_missing") {
          throw new Error(j?.message || "Activation requires a valid Google Sheet and one enabled sheet row.");
        }
        throw new Error(j?.error || `Save failed: ${r.status}`);
      }
      setStore(j.store);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 space-y-4">
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Link href="/dashboard/stores">
          <Button variant="outline">Back to stores</Button>
        </Link>
      </div>
    );
  }

  if (!store) return null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Store: {store.name}</h1>
        <Link href="/dashboard/stores">
          <Button variant="outline">Back</Button>
        </Link>
      </div>

      <Card className="card-futuristic">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Name */}
            <div className="space-y-1">
              <Label htmlFor="store-name">Name</Label>
              <Input
                id="store-name"
                defaultValue={store.name}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  if (v && v !== store.name) save({ name: v });
                }}
              />
            </div>

            {/* Status */}
            <div className="space-y-1">
              <Label>Status</Label>
              <Select defaultValue={store.status} onValueChange={(v) => save({ status: v as Store["status"] })}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inactive">inactive</SelectItem>
                  <SelectItem value="active">active</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Sheet URL */}
            <div className="md:col-span-2 space-y-1">
              <Label htmlFor="gsheet">Google Sheet URL</Label>
              <Input
                id="gsheet"
                defaultValue={store.gsheet_url ?? ""}
                placeholder="https://docs.google.com/spreadsheets/..."
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  if ((v || null) !== (store.gsheet_url ?? null)) save({ gsheet_url: v || null });
                }}
              />
              <p className="text-xs text-muted-foreground">
                Activation requires a valid Google Sheet and exactly one enabled sheet row.
              </p>
            </div>
          </div>

          {saving && (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving…
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
