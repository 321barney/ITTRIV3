// src/app/dashboard/stores/new/create-store-form.tsx
'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type CreateStoreResponse =
  | { ok: true; data?: any; store?: any; id?: string }
  | { id?: string; name?: string }
  | any;

export default function CreateStoreForm() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    gsheet_url: '',
    category: '',
    description: '',
  });

  const withSession: RequestInit = { credentials: 'include', cache: 'no-store' };

  const isSheet = (url: string) =>
    /^https:\/\/docs\.google\.com\/spreadsheets\//i.test(url.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const name = formData.name.trim();
    if (!name) {
      setError('Store name is required');
      return;
    }

    const sheet = formData.gsheet_url.trim();
    if (sheet && !isSheet(sheet)) {
      setError('Google Sheet must be a docs.google.com/spreadsheets URL');
      return;
    }

    try {
      // Stash optional fields locally for later use
      localStorage.setItem(
        'store.create.meta',
        JSON.stringify(
          { category: formData.category, description: formData.description },
          null,
          2
        )
      );
    } catch {}

    try {
      setCreating(true);
      const payload = sheet ? { name, gsheet_url: sheet } : { name };

      const res = await fetch('/api/dashboard/stores', {
        ...withSession,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        setError('Please sign in to create a store (401).');
        return;
      }
      if (res.status === 403) {
        let msg = 'This account lacks seller access (403).';
        try {
          const j = await res.clone().json();
          if (j?.hint === 'admin_required') msg = 'Your token looks admin-only. Re-login as a seller.';
        } catch {}
        setError(msg);
        return;
      }

      const data: CreateStoreResponse = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = Array.isArray((data as any)?.details)
          ? (data as any).details.join(', ')
          : (data as any)?.details;
        throw new Error(details || (data as any)?.error || `Failed to create store: ${res.status}`);
      }

      const id =
        (data as any)?.id ??
        (data as any)?.data?.id ??
        (data as any)?.store?.id ??
        (data as any)?.data?.store?.id ??
        null;

      router.replace(id ? `/dashboard/stores/${encodeURIComponent(id)}` : '/dashboard/stores');
    } catch (e: any) {
      setError(e?.message || 'Failed to create store');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black gradient-text-triple">Create New Store</h1>
          <p className="text-sm text-muted-foreground">
            New stores start as inactive. Connect WhatsApp and Google Sheets to activate.
          </p>
        </div>
      </div>

      {/* Form Card */}
      <div className="card-futuristic rounded-2xl p-6 max-w-xl">
        <form onSubmit={submit} className="space-y-5">
          {/* Store name */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-foreground">
              Store Name <span className="opacity-70">*</span>
            </label>
            <Input
              placeholder="Enter store name"
              value={formData.name}
              onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
              disabled={creating}
              required
              aria-required
            />
          </div>

          {/* Google Sheet */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-foreground">
              Google Sheet (optional)
            </label>
            <Input
              type="url"
              placeholder="https://docs.google.com/spreadsheets/…"
              value={formData.gsheet_url}
              onChange={(e) => setFormData((p) => ({ ...p, gsheet_url: e.target.value }))}
              disabled={creating}
              aria-invalid={!!formData.gsheet_url && !isSheet(formData.gsheet_url)}
            />
            {!!formData.gsheet_url && !isSheet(formData.gsheet_url) && (
              <p className="mt-1 text-xs" style={{ color: 'rgba(var(--destructive-rgb), 1)' }}>
                Must be a Google Sheets URL.
              </p>
            )}
          </div>

          {/* Category */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-foreground">
              Category
            </label>
            <Select
              value={formData.category}
              onChange={(e) => setFormData((p) => ({ ...p, category: e.target.value }))}
              disabled={creating}
              size="default"
            >
              <option value="">Select category</option>
              <option value="electronics">Electronics</option>
              <option value="fashion">Fashion</option>
              <option value="home">Home &amp; Garden</option>
              <option value="sports">Sports &amp; Outdoors</option>
              <option value="books">Books &amp; Media</option>
              <option value="other">Other</option>
            </Select>
          </div>

          {/* Description */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-foreground">
              Description
            </label>
            <Textarea
              placeholder="Brief description of your store"
              value={formData.description}
              onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
              disabled={creating}
              className="h-24 resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="text-sm" style={{ color: 'rgba(var(--destructive-rgb), 1)' }} role="alert">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="mt-6 flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1 rounded-xl"
              onClick={() => router.back()}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="btn-futuristic flex-1 rounded-xl inline-flex items-center justify-center gap-2"
              disabled={creating}
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              {creating ? 'Creating…' : 'Create Store'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
