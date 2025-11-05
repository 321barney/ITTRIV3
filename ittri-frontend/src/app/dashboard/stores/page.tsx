// src/app/dashboard/stores/page.tsx
import StoresClient from "./StoresClient";
import { headers, cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Store = {
  id: string;
  name: string;
  status: "active" | "inactive" | "suspended";
  gsheet_url?: string | null;
  has_gsheet?: boolean;
  created_at?: string;
  updated_at?: string;
};

function getOriginFromHeaders(): string {
  const h = headers();
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host");
  return host ? `${proto}://${host}` : "";
}

async function fetchStores(): Promise<Store[]> {
  try {
    const origin = getOriginFromHeaders();
    const cookieHeader = cookies().toString();

    const res = await fetch(`${origin}/api/dashboard/stores`, {
      method: "GET",
      headers: { accept: "application/json", ...(cookieHeader ? { cookie: cookieHeader } : {}) },
      cache: "no-store",
    });

    const j = await res.json().catch(() => ({}));
    return (j?.stores ?? j ?? []) as Store[];
  } catch {
    return [];
  }
}

export default async function StoresPage() {
  const stores = await fetchStores();
  return <StoresClient initial={stores} />;
}
