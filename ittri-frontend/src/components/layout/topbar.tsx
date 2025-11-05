// src/components/navigation/topbar.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useUserStore, useUIStore } from '@/stores';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Bell, User, LogOut, Database, Package, ShoppingCart, Zap, Menu, MapPin, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type StoreStats = {
  products?: number;
  lowStock?: number;
  ordersOpen?: number;
  revenueTodayUSD?: number;
};

type TopbarProps = {
  status?: 'connected' | 'disconnected' | 'checking';
  onToggleSidebar?: () => void;
  storeStats?: StoreStats;
};

function routeLabel(pathname: string) {
  const parts = pathname.split('/').filter(Boolean).slice(1);
  if (parts.length === 0) return 'Dashboard';
  const nice = parts
    .map((p) => p.replace(/[-_]/g, ' '))
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return nice.join(' / ');
}

export default function Topbar({
  status = 'checking',
  onToggleSidebar,
  storeStats,
}: TopbarProps) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { user, clearUser, currentStore, stores, setStores, setCurrentStore } = useUserStore();
  const { notifications } = useUIStore();
  const [showStoreSelector, setShowStoreSelector] = useState(false);
  const [loadingStores, setLoadingStores] = useState(false);
  const [liveStats, setLiveStats] = useState<StoreStats>({});

  const notifCount = notifications?.length ?? 0;
  const userInitial = user?.name?.charAt(0) || user?.email?.charAt(0) || 'U';

  // Fetch stores on mount
  useEffect(() => {
    if (user && stores.length === 0 && !loadingStores) {
      setLoadingStores(true);
      fetch('/api/dashboard/stores', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        credentials: 'include',
      })
        .then(res => res.json())
        .then(data => {
          const storeList = Array.isArray(data?.stores) ? data.stores : Array.isArray(data) ? data : [];
          setStores(storeList);
          // Auto-select first store if none selected
          if (!currentStore && storeList.length > 0) {
            setCurrentStore(storeList[0]);
          }
        })
        .catch(err => console.error('Failed to fetch stores:', err))
        .finally(() => setLoadingStores(false));
    }
  }, [user, stores.length, currentStore, setStores, setCurrentStore, loadingStores]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showStoreSelector) return;
    const handler = () => setShowStoreSelector(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showStoreSelector]);

  // Fetch live stats when store changes
  useEffect(() => {
    if (!currentStore?.id) return;
    
    fetch(`/api/dashboard/metrics?period=30d&storeId=${currentStore.id}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      credentials: 'include',
    })
      .then(res => res.json())
      .then(data => {
        setLiveStats({
          products: data?.products?.total ?? 0,
          lowStock: data?.products?.low_stock ?? 0,
          ordersOpen: data?.orders?.open ?? 0,
          revenueTodayUSD: data?.revenue?.today ?? 0,
        });
      })
      .catch(err => console.error('Failed to fetch store stats:', err));
  }, [currentStore?.id]);

  const products = storeStats?.products ?? liveStats.products ?? 0;
  const lowStock = storeStats?.lowStock ?? liveStats.lowStock ?? 0;
  const ordersOpen = storeStats?.ordersOpen ?? liveStats.ordersOpen ?? 0;
  const revenueTodayUSD = storeStats?.revenueTodayUSD ?? liveStats.revenueTodayUSD ?? 0;

  const onLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', cache: 'no-store' });
    } catch {}
    clearUser();
    router.replace('/auth/login');
  };

  const statusBadge = (() => {
    if (status === 'connected') return <Badge variant="success">Neural Link Active</Badge>;
    if (status === 'checking') return <Badge variant="info">Establishing Connection</Badge>;
    return <Badge variant="destructive">Neural Link Offline</Badge>;
  })();

  const isLanding = pathname.includes('/dashboard/landing/landing');
  return (
    <header className={cn(
      'relative glass border-b px-4 md:px-6 py-4',
      // Lighten the topbar for landing pages to integrate with their softer gradients.
      isLanding && 'bg-white/60 dark:bg-neutral-900/70 backdrop-blur-lg border-gray-200 dark:border-neutral-700'
    )}>
      <div className="flex items-center justify-between">
        {/* Left: burger + context */}
        <div className="flex items-center gap-3 min-w-0">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onToggleSidebar}
            className="rounded-lg"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-4 w-4" />
          </Button>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold gradient-text-triple truncate">
                {routeLabel(pathname)}
              </h2>
              <span className="hidden md:inline-flex">{statusBadge}</span>
            </div>
            <p className="text-sm text-muted-foreground truncate">
              Operator: {user?.name || user?.email || 'Unknown Agent'}
            </p>
          </div>
        </div>

        {/* Right: quick actions */}
        <div className="flex items-center gap-3">
          {/* Store chips */}
          <div className="hidden lg:flex items-center gap-2 mr-2">
            {/* Store Selector */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowStoreSelector(!showStoreSelector);
                }}
                className="flex items-center gap-2 px-3 py-1 glass rounded-full hover:bg-foreground/5 transition-colors cursor-pointer"
              >
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: `rgba(var(--ring-rgb), .8)` }}
                  aria-hidden
                />
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-foreground/90 font-medium">
                  {currentStore?.name || 'Select Store'}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
              
              {/* Dropdown */}
              {showStoreSelector && (
                <div 
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-full mt-2 left-0 min-w-[200px] glass border rounded-lg shadow-lg z-50 max-h-[300px] overflow-y-auto"
                >
                  {stores.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-muted-foreground">
                      No stores found. <a href="/dashboard/stores/new" className="text-primary underline">Create one</a>
                    </div>
                  ) : (
                    stores.map((store: any) => (
                      <button
                        key={store.id}
                        onClick={() => {
                          setCurrentStore(store);
                          setShowStoreSelector(false);
                        }}
                        className={cn(
                          "w-full px-4 py-2 text-left text-sm hover:bg-foreground/5 transition-colors",
                          currentStore?.id === store.id && "bg-foreground/10 font-medium"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span>{store.name}</span>
                          {currentStore?.id === store.id && (
                            <Badge variant="secondary" className="text-xs">Active</Badge>
                          )}
                        </div>
                        {store.status && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Status: {store.status}
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            
            <Chip icon={Database} label={`Products: ${products}`} />
            <Chip icon={Package} label={`Low Stock: ${lowStock}`} />
            <Chip icon={ShoppingCart} label={`Open Orders: ${ordersOpen}`} />
            {revenueTodayUSD > 0 && (
              <Chip icon={Zap} label={`Revenue: $${Math.round(revenueTodayUSD).toLocaleString()}`} />
            )}
          </div>

          {/* Notifications */}
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            {notifCount > 0 && (
              <Badge className="absolute -top-1 -right-1 min-w-[1rem] h-5 px-1 flex items-center justify-center">
                {notifCount}
              </Badge>
            )}
          </Button>

          {/* AI status pill */}
          <div className="hidden md:flex items-center gap-2 px-3 py-2 glass rounded-lg">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-foreground font-medium">AI Online</span>
            <div className="w-2 h-2 rounded-full bg-foreground/40 animate-pulse" />
          </div>

          {/* Account */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Account">
              <User className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onLogout}
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>

          {/* Avatar */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full glass grid place-items-center font-semibold">
              {userInitial}
            </div>
            <div className="hidden md:block">
              <div className="text-sm font-medium text-foreground">{user?.name || 'Neural Agent'}</div>
              <div className="text-xs text-muted-foreground">Level 7 Clearance</div>
            </div>
          </div>
        </div>
      </div>

      {/* Subtle streaming indicator using your gradient-progress utility */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground/10 overflow-hidden">
        <div className="gradient-progress h-full w-1/3" />
      </div>
    </header>
  );
}

/* ── small helpers (token-only) ───────────────────────── */

function Chip({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 glass rounded-full">
      <div
        className="w-2.5 h-2.5 rounded-full"
        style={{ background: `rgba(var(--ring-rgb), .8)` }}
        aria-hidden
      />
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs text-foreground/90 font-medium">{label}</span>
    </div>
  );
}
