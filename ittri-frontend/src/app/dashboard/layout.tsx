// src/app/dashboard/layout.tsx
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/components/layout/sidebar";
import Topbar from "@/components/layout/topbar";
import { useUserStore } from "@/stores";

type Props = { children: React.ReactNode };
type LinkStatus = "connected" | "disconnected" | "checking";

export default function DashboardLayout({ children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, setUser, ...maybeStoreFns } = useUserStore() as any;

  const [checking, setChecking] = useState(true);
  const [linkStatus, setLinkStatus] = useState<LinkStatus>("checking");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const setCurrentStore =
    typeof (maybeStoreFns as any)?.setCurrentStore === "function"
      ? (maybeStoreFns as any).setCurrentStore
      : null;
  
  const currentStore = (maybeStoreFns as any)?.currentStore || null;

  // Bootstrap user from /api/auth/me
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (user) {
          if (!cancelled) setChecking(false);
          return;
        }

        const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
        if (!res.ok) throw new Error("unauthorized");

        const me = await res.json();
        const rawUser = me?.user ?? me ?? {};
        const ds = me?.default_store ?? null;

        const id = String(rawUser.id ?? rawUser.user_id ?? "");
        const email = String(rawUser.email ?? rawUser.user_email ?? "");
        const role = (rawUser.role ?? "seller") as string;

        const companyName = rawUser.companyName ?? rawUser.company_name ?? null;
        const planCode = rawUser.planCode ?? rawUser.plan_code ?? rawUser.plan ?? "starter";
        const billingCycleStart = rawUser.billingCycleStart ?? rawUser.billing_cycle_start ?? null;

        const createdAt = rawUser.createdAt ?? rawUser.created_at ?? null;
        const updatedAt = rawUser.updatedAt ?? rawUser.updated_at ?? null;

        if (!id || !email) throw new Error("bad_profile");

        if (!cancelled) {
          setUser({
            id,
            email,
            role,
            companyName,
            planCode,
            billingCycleStart: billingCycleStart ? new Date(billingCycleStart) : new Date(),
            createdAt: createdAt ? new Date(createdAt) : new Date(),
            updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
          });

          if (setCurrentStore && ds) {
            setCurrentStore({
              id: String(ds.id),
              name: String(ds.name),
              sellerId: String(ds.seller_id ?? rawUser.id ?? ""),
              status: (ds.status as "active" | "inactive") ?? "active",
              createdAt: ds.created_at ? new Date(ds.created_at) : new Date(),
              updatedAt: ds.updated_at ? new Date(ds.updated_at) : new Date(),
            });
          }

          setChecking(false);
        }
      } catch {
        if (!cancelled) {
          setChecking(false);
          router.replace("/login?next=" + encodeURIComponent(pathname || "/dashboard"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Link-status heartbeat
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        setLinkStatus("checking");
        const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
        if (!cancelled) setLinkStatus(res.ok ? "connected" : "disconnected");
      } catch {
        if (!cancelled) setLinkStatus("disconnected");
      }
    };
    ping();
    const id = setInterval(ping, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (checking) {
    return (
      <div className="relative min-h-screen grid place-items-center custom-scrollbar">
        {/* starfield backdrop */}
        <div className="space-backdrop" aria-hidden>
          <div className="stars" />
          <div className="stars stars--sm" />
        </div>

        <div
          className="glass rounded-2xl px-8 py-6 text-center border focus-neon"
          role="status"
          aria-live="polite"
        >
          <div className="mx-auto mb-4 h-16 w-16 rounded-full border-4 border-[rgba(var(--ring-rgb),1)] border-t-transparent animate-spin" />
          <p className="text-muted-foreground">Verifying access…</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="relative min-h-screen text-foreground bg-transparent overflow-hidden">
      {/* global top aurora + starfield */}
      {/* Hide the animated backdrop on landing pages (e.g., /dashboard/landing/landing-intro, /dashboard/landing/studio) to better integrate with their bespoke gradients. */}
      {!(pathname?.includes('/dashboard/landing/landing')) && (
        <>
          <div className="top-aurora" aria-hidden />
          <div className="space-backdrop" aria-hidden>
            <div className="stars" />
            <div className="stars stars--sm" />
          </div>
        </>
      )}

      {/* Topbar */}
      <Topbar status={linkStatus} onToggleSidebar={() => setSidebarOpen((v) => !v)} />

      {/* Main grid: sidebar + content */}
      <div className="grid grid-cols-[auto,1fr]">
        {sidebarOpen ? (
          <aside className="sticky top-[64px] h-[calc(100vh-64px)]">
            <Sidebar data-id="sidebar" />
          </aside>
        ) : (
          <aside className="sticky top-[64px] h-[calc(100vh-64px)] flex items-start">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="m-3 glass rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-foreground/10 focus-neon transition-all duration-200 border"
              aria-label="Show sidebar"
            >
              Show Sidebar
            </button>
          </aside>
        )}

        <main className="min-h-[calc(100vh-64px)] overflow-auto p-6 custom-scrollbar">
          {children}
        </main>
      </div>
    </div>
  );
}
